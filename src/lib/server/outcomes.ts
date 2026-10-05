// Outcome loop: measure what actually happened after each decision, then simulate time (demo).
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { addDays, diffDays, weekdayOf } from "@/lib/dates";
import { poisson, rng, WEEKDAY_DEMAND } from "@/lib/demo-data";
import type { LedgerEvent } from "@/lib/ledger";
import { getAsOf } from "./engine";
import { appendEvents } from "./ledger";
import { relearn } from "./memory";

export type OutcomeVerdict = "close" | "overestimated" | "underestimated" | "avoided_risk" | "risk_realised" | "reasonable";

const u = (n: number) => `${n} unit${n === 1 ? "" : "s"}`;

export async function measureOutcomes(): Promise<{ measured: number; pending: number }> {
  const asOf = await getAsOf();
  const [decs, existing, prods] = await Promise.all([
    db.select().from(s.decisions),
    db.select({ id: s.outcomes.decisionId }).from(s.outcomes),
    db.select({ id: s.products.id, name: s.products.name }).from(s.products),
  ]);
  const done = new Set(existing.map((e) => e.id));
  const names = new Map(prods.map((p) => [p.id, p.name]));
  let measured = 0, pending = 0;

  for (const d of decs) {
    if (done.has(d.id) || !d.productId) continue;
    if (d.recommendedQty === null) continue; // only quantity decisions are measurable
    const window = d.outcomeWindowDays;
    const elapsed = diffDays(asOf, d.decisionDate);
    if (elapsed < window) { pending++; continue; }
    const from = d.decisionDate;
    const to = addDays(d.decisionDate, window);
    const r = await db
      .select({ q: sql<number>`coalesce(sum(${s.sales.quantity}),0)::int` })
      .from(s.sales)
      .where(and(eq(s.sales.productId, d.productId), gt(s.sales.saleDate, from), lte(s.sales.saleDate, to)));
    const actual = Number(r[0]?.q ?? 0);
    const forecast = Math.round((d.forecastDailyRate ?? 0) * window * 10) / 10;
    const err = forecast > 0 ? (actual - forecast) / forecast : 0;
    const name = names.get(d.productId) ?? d.productId;
    const stockAtDecision = d.stockAtDecision ?? 0;
    const rec = d.recommendedQty ?? 0;
    const appr = d.approvedQty;

    let verdict: OutcomeVerdict;
    const parts: string[] = [];
    parts.push(`Actual demand over ${window} days: ${u(actual)} (forecast ${forecast}, ${err >= 0 ? "+" : ""}${Math.round(err * 100)}%).`);

    if (d.kind === "rejected") {
      const short = actual - stockAtDecision;
      if (short > 0) {
        verdict = "risk_realised";
        parts.push(`You declined the order. On-hand stock was ${stockAtDecision}, so demand exceeded stock by ${u(short)} — the stockout risk was real.`);
      } else {
        verdict = "avoided_risk";
        parts.push(`You declined the order. On-hand stock was ${stockAtDecision}, which covered the ${u(actual)} sold — rejecting looks reasonable.`);
      }
    } else {
      const ordered = appr ?? rec;
      const needed = Math.max(0, actual - stockAtDecision);
      if (Math.abs(err) <= 0.2) verdict = "close";
      else verdict = err < 0 ? "overestimated" : "underestimated";
      if (d.kind === "modified" && appr !== null && appr !== rec) {
        const closerYou = Math.abs(ordered - needed) <= Math.abs(rec - needed);
        parts.push(`You changed the order from ${rec} to ${appr}. The net units actually needed in this window were about ${needed}. ${closerYou ? "Your adjustment was closer to what was needed." : "My original suggestion was closer to what was needed."}`);
        if (closerYou && verdict !== "close") verdict = "reasonable";
      } else {
        parts.push(`You ordered ${ordered}; about ${needed} net unit(s) were needed in the window.`);
      }
      if (verdict === "close") parts.push("✓ The demand estimate was close.");
      else if (verdict === "overestimated") parts.push("⚠ The forecast overestimated demand.");
      else if (verdict === "underestimated") parts.push("⚠ The forecast underestimated demand.");
    }
    await db.insert(s.outcomes).values({
      decisionId: d.id, recommendationId: d.recommendationId, productId: d.productId,
      actualDemand: actual, forecastDemand: forecast, windowDays: window, verdict,
      note: `${name}: ${parts.join(" ")}`,
      details: { from, to, errorPct: Math.round(err * 100), recommended: rec, approved: appr, stockAtDecision },
    });
    const [recRow] = await db.select().from(s.recommendations).where(eq(s.recommendations.id, d.recommendationId));
    if (recRow && !recRow.lifecycle.some((l) => l.stage === "OUTCOME_RECORDED"))
      await db.update(s.recommendations).set({ lifecycle: [...recRow.lifecycle, { stage: "OUTCOME_RECORDED", at: new Date().toISOString(), note: verdict }] }).where(eq(s.recommendations.id, d.recommendationId));
    measured++;
  }
  if (measured) await relearn();
  return { measured, pending };
}

/**
 * DEMO TOOL — advances the business clock by `days`: generates sales from each product's
 * forecast rate (Poisson), draws down inventory, and delivers orders whose lead time elapsed.
 * Clearly labelled as simulation in the UI; never used on real uploaded history.
 */
export async function simulateDays(days: number) {
  const n = Math.min(Math.max(Math.round(days), 1), 30);
  const asOf = await getAsOf();
  const [fcs, inv, prods, pendingArrivals] = await Promise.all([
    db.select().from(s.forecasts),
    db.select().from(s.inventory),
    db.select().from(s.products),
    db.select().from(s.decisions),
  ]);
  const rate = new Map(fcs.map((f) => [f.productId, f.dailyRate]));
  const stock = new Map(inv.map((i) => [i.productId, i.currentStock]));
  const price = new Map(prods.map((p) => [p.id, p.sellPrice]));
  const arrivals = pendingArrivals.filter((d) => !d.arrivedAt && (d.approvedQty ?? 0) > 0 && d.kind !== "rejected" && d.productId);
  const rows: { saleDate: string; productId: string; quantity: number; price: number | null }[] = [];
  // Simulated movements are also recorded as ledger events, so the derived quantity and the
  // inventory table cannot drift apart. One event per product per day, not per sale row.
  const ledger: (Omit<LedgerEvent, "id"> & { id?: string })[] = [];
  let sold = 0, delivered = 0;

  for (let i = 1; i <= n; i++) {
    const date = addDays(asOf, i);
    for (const a of arrivals) {
      if (a.arrivedAt) continue;
      if (diffDays(date, a.decisionDate) >= (a.leadTimeDays ?? 0)) {
        stock.set(a.productId!, (stock.get(a.productId!) ?? 0) + (a.approvedQty ?? 0));
        a.arrivedAt = date;
        await db.update(s.decisions).set({ arrivedAt: date }).where(eq(s.decisions.id, a.id));
        ledger.push({ productId: a.productId!, kind: "receipt", qty: a.approvedQty ?? 0, at: date, source: "system", note: `Delivery for decision #${a.id} (SIMULATED)`, ref: `decision_${a.id}` });
        delivered++;
      }
    }
    for (const p of prods) {
      const st = stock.get(p.id);
      const r = rate.get(p.id) ?? 0;
      if (st === undefined || st <= 0 || r <= 0) continue;
      const seed = [...`${date}${p.id}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
      const rnd = rng(seed);
      let want = poisson(r * WEEKDAY_DEMAND[weekdayOf(date)] * (0.9 + 0.2 * rnd()), rnd);
      want = Math.min(want, st);
      stock.set(p.id, st - want);
      if (want > 0) ledger.push({ productId: p.id, kind: "sale", qty: want, at: date, source: "system", note: "Simulated sales (SIMULATED)", ref: `sim_${date}` });
      while (want > 0) {
        const q = want >= 2 && rnd() < 0.2 ? 2 : 1;
        rows.push({ saleDate: date, productId: p.id, quantity: q, price: price.get(p.id) ?? null });
        want -= q; sold += q;
      }
    }
  }
  for (let i = 0; i < rows.length; i += 1000) if (rows.length) await db.insert(s.sales).values(rows.slice(i, i + 1000));
  for (const [productId, currentStock] of stock) await db.update(s.inventory).set({ currentStock, updatedAt: new Date() }).where(eq(s.inventory.productId, productId));
  if (ledger.length) await appendEvents(ledger);
  return { days: n, newAsOf: addDays(asOf, n), unitsSold: sold, ordersDelivered: delivered, ledgerEvents: ledger.length };
}
