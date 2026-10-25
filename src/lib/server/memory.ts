// Decision memory: approve / modify / reject → record → learn preferences.
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { consolidateOffers } from "@/lib/analysis";
import { isBiasUsable } from "@/lib/outcomes-core";
import { validateOrder } from "@/lib/validation";
import { simulateShop, type ShopOutlook, type ShopSimProduct } from "@/lib/shop-sim";
import type { Action, Calculation } from "@/lib/types";
import { getAsOf } from "./engine";
import { HttpError } from "./http";
import { allocateBudget, budgetCandidateOf, type BudgetCandidate } from "./plan";
import { appendEvents } from "./ledger";
import { loadRules } from "./rules";

export type DecideBody = {
  decision: "approved" | "modified" | "rejected";
  quantity?: number;
  supplierId?: string;
  reason?: string;
  confirmWarnings?: boolean;
};

export async function getRecOr404(id: string) {
  const [rec] = await db.select().from(s.recommendations).where(eq(s.recommendations.id, id));
  if (!rec) throw new HttpError(404, "Recommendation not found");
  return rec;
}

/** Live re-validation of an edited quantity against current rules (used by the Modify UI). */
export async function previewValidation(id: string, quantity: number, supplierId?: string) {
  const rec = await getRecOr404(id);
  const calc = rec.calculation as unknown as Calculation | null;
  if (!calc?.validationInput) throw new HttpError(422, "This recommendation has no quantity to validate");
  const vin = { ...calc.validationInput, quantity: Math.round(quantity) };
  if (supplierId && rec.productId) {
    const offers = await db.select().from(s.supplierOffers).where(eq(s.supplierOffers.productId, rec.productId));
    const o = consolidateOffers(offers).find((x) => x.supplierId === supplierId);
    if (o) Object.assign(vin, { supplierId, unitPrice: o.price, moq: o.moq });
  }
  return validateOrder(vin, await loadRules());
}

export async function decide(id: string, body: DecideBody) {
  const rec = await getRecOr404(id);
  if (rec.status !== "pending") throw new HttpError(409, `This recommendation is already ${rec.status}.`);
  if (rec.abstain && body.decision !== "rejected")
    throw new HttpError(422, "Sahaay abstained on this item (not enough reliable data). Dismiss it, or fix the data and re-run analysis.");
  const action = rec.action as unknown as Action;
  const calc = rec.calculation as unknown as Calculation | null;
  let kind = body.decision;
  let approvedQty: number | null = null;
  let supplierId = action.supplierId ?? null;
  let unitPrice = action.unitPrice ?? null;
  let leadTime = action.leadTimeDays ?? null;
  let validation = rec.validation;
  const recommendedQty = action.quantity ?? null;

  if (action.kind === "order" && kind !== "rejected") {
    const vin = calc?.validationInput;
    if (!vin) throw new HttpError(422, "Missing validation context");
    const qty = Math.round(Number(body.quantity ?? action.quantity));
    const input = { ...vin, quantity: qty };
    if (body.supplierId && body.supplierId !== supplierId && rec.productId) {
      const offers = await db.select().from(s.supplierOffers).where(eq(s.supplierOffers.productId, rec.productId));
      const o = consolidateOffers(offers).find((x) => x.supplierId === body.supplierId);
      if (!o) throw new HttpError(422, "That supplier has no usable offer for this product");
      Object.assign(input, { supplierId: o.supplierId, unitPrice: o.price, moq: o.moq });
      supplierId = o.supplierId; unitPrice = o.price; leadTime = o.leadTimeDays;
    }
    const report = validateOrder(input, await loadRules());
    if (report.status === "block") throw new HttpError(422, "Blocked by your safety rules", { validation: report });
    if (report.status === "warn" && !body.confirmWarnings)
      throw new HttpError(409, "This order needs your explicit confirmation", { validation: report, needsConfirmation: true });
    approvedQty = qty;
    if (qty !== recommendedQty || supplierId !== (action.supplierId ?? null)) kind = "modified";
    validation = report as unknown as Record<string, unknown>;
  }

  const asOf = await getAsOf();
  const ctx = (calc?.context ?? {}) as { rate?: number };
  const [decision] = await db
    .insert(s.decisions)
    .values({
      recommendationId: id, productId: rec.productId, kind, recommendedQty, approvedQty,
      reason: body.reason?.trim() || null, supplierId, unitPrice,
      stockAtDecision: calc?.validationInput?.currentStock ?? null,
      forecastDailyRate: ctx.rate ?? null, leadTimeDays: leadTime, decisionDate: asOf,
    })
    .returning();

  const now = new Date().toISOString();
  const lifecycle = [
    ...rec.lifecycle,
    { stage: kind === "rejected" ? "REJECTED" : kind === "modified" ? "MODIFIED" : "APPROVED", at: now, note: body.reason?.trim() || undefined },
    ...(kind !== "rejected" && approvedQty !== null ? [{ stage: "MONITORED", at: now, note: "Outcome will be measured after 7 days of sales data" }] : []),
  ];
  const [updated] = await db
    .update(s.recommendations)
    .set({ status: kind, lifecycle, validation, updatedAt: new Date() })
    .where(eq(s.recommendations.id, id))
    .returning();
  await relearn();
  return { recommendation: updated, decision };
}

export type BatchResult = {
  approved: { id: string; productId: string | null; name: string; quantity: number; downsizedFrom?: number }[];
  skipped: { productId: string | null; name: string; reason: string }[];
  committed: number;
  /** Whole-shop outlook of the funded basket (deferred products included with no order). */
  outlook: ShopOutlook | null;
};

/**
 * Shop-level outlook of the plan: funded orders carry their quantity, deferred ones carry zero,
 * so the unmet demand they add is visible as the cost of deferral. Uses the stored forecast for
 * each product's demand rate/error — a portfolio summary, not a full re-simulation.
 */
async function shopOutlook(
  plan: ReturnType<typeof allocateBudget>,
  recByProduct: Map<string, { calculation: unknown; action: unknown }>,
): Promise<ShopOutlook | null> {
  const items = [
    ...plan.funded.map((f) => ({ productId: f.productId, name: f.name, quantity: f.quantity, unitPrice: f.unitPrice })),
    ...plan.deferred.map((d) => ({ productId: d.productId, name: d.name, quantity: 0, unitPrice: 0 })),
  ];
  const ids = [...new Set(items.map((i) => i.productId))];
  if (!ids.length) return null;
  const fcs = await db.select().from(s.forecasts).where(inArray(s.forecasts.productId, ids));
  const fcM = new Map(fcs.map((f) => [f.productId, f]));
  const prods: ShopSimProduct[] = [];
  for (const item of items) {
    const rec = recByProduct.get(item.productId);
    const calc = rec?.calculation as Calculation | null;
    const vin = calc?.validationInput;
    if (!vin) continue; // no stored validation context → cannot simulate honestly; skip
    const rate = (calc?.context as { rate?: number } | undefined)?.rate ?? fcM.get(item.productId)?.dailyRate;
    if (rate === undefined) continue;
    prods.push({
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      stock: Math.max(0, vin.currentStock ?? 0),
      dailyRate: rate,
      dailySd: fcM.get(item.productId)?.dailySd ?? 0,
      leadTimeDays: (rec?.action as Action | null)?.leadTimeDays ?? 7,
      unitPrice: item.quantity > 0 ? item.unitPrice : ((rec?.action as Action | null)?.unitPrice ?? 0),
      sellPrice: vin.sellPrice ?? null,
    });
  }
  return prods.length ? simulateShop(prods, { runs: 400 }) : null;
}

/**
 * Approve the whole-shop cash plan in one click. This is still one human approval — the owner
 * pressed the button — but each order goes through the same decide() gate as an individual
 * approval: quantities are re-validated against current rules right now, blocked orders are
 * refused, and warnings are never confirmed on the owner's behalf (those are skipped and must
 * be approved individually). Deferred orders are left pending by design.
 */
export async function approveFundedPlan(): Promise<BatchResult> {
  const [recs, rules] = await Promise.all([
    db.select().from(s.recommendations).where(eq(s.recommendations.status, "pending")),
    loadRules(),
  ]);
  const candidates = recs.map(budgetCandidateOf).filter((c): c is BudgetCandidate => c !== null);
  if (!candidates.length) return { approved: [], skipped: [], committed: 0, outlook: null };
  const plan = allocateBudget(candidates, rules.cashLimit);

  // One pending order rec per product (dedupe keys guarantee this), matched back by productId.
  const recByProduct = new Map<string, typeof recs[number]>();
  for (const r of recs) {
    const c = budgetCandidateOf(r);
    if (c && !recByProduct.has(c.productId)) recByProduct.set(c.productId, r);
  }
  const outlook = await shopOutlook(plan, recByProduct);

  const approved: BatchResult["approved"] = [];
  const skipped: BatchResult["skipped"] = [];
  let committed = 0;
  for (const f of plan.funded) {
    const rec = recByProduct.get(f.productId);
    if (!rec) {
      skipped.push({ productId: f.productId, name: f.name, reason: "The pending recommendation changed while planning — approve individually." });
      continue;
    }
    try {
      // A downsized quantity is a modification of the recommendation, not a silent approval of it.
      await decide(rec.id, {
        decision: f.downsizedFrom ? "modified" : "approved",
        quantity: f.quantity,
        reason: f.downsizedFrom
          ? `Approved at ${f.quantity} (down from ${f.downsizedFrom}) to fit the whole-shop cash limit — expected unmet demand rises by about ${f.extraLostUnits ?? "?"} unit(s) per the simulation.`
          : "Approved as part of the funded whole-shop cash plan.",
      });
      approved.push({ id: rec.id, productId: f.productId, name: f.name, quantity: f.quantity, ...(f.downsizedFrom ? { downsizedFrom: f.downsizedFrom } : {}) });
      committed += f.cost;
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) {
        skipped.push({ productId: f.productId, name: f.name, reason: "Needs your explicit confirmation of a warning — approve it individually." });
      } else if (e instanceof HttpError && e.status === 422) {
        skipped.push({ productId: f.productId, name: f.name, reason: e.message });
      } else {
        throw e;
      }
    }
  }
  return { approved, skipped, committed, outlook };
}

/**
 * The owner says they placed the order. This records a purchase order as an event — it moves no
 * stock, because nothing has arrived. Event ids are derived from the decision id so a double click
 * cannot create two orders against the same cash.
 */
export async function markExecuted(id: string, opts: { at?: string } = {}) {
  const rec = await getRecOr404(id);
  if (rec.status !== "approved" && rec.status !== "modified") throw new HttpError(409, "Only approved decisions can be marked as ordered.");
  const [decision] = await db.select().from(s.decisions).where(eq(s.decisions.recommendationId, id));
  if (!decision?.productId) throw new HttpError(422, "This decision has no product to order against.");
  const qty = decision.approvedQty ?? decision.recommendedQty;
  if (qty === null || qty <= 0) throw new HttpError(422, "There is no ordered quantity to record.");
  if (decision.executedAt) throw new HttpError(409, "This order is already marked as placed.");

  const at = opts.at ?? (await getAsOf());
  await appendEvents([
    {
      id: `order_${decision.id}`,
      productId: decision.productId,
      kind: "order_placed",
      qty,
      at,
      source: "owner",
      note: `Purchase order placed${decision.supplierId ? ` with supplier ${decision.supplierId}` : ""} (${qty} units)`,
      ref: `decision_${decision.id}`,
    },
  ]);
  await db.update(s.decisions).set({ executedAt: new Date(), orderedAtDate: at }).where(eq(s.decisions.id, decision.id));
  const [u] = await db
    .update(s.recommendations)
    .set({ status: "executed", updatedAt: new Date(), lifecycle: [...rec.lifecycle, { stage: "EXECUTED", at: new Date().toISOString(), note: `Owner confirmed the order was placed on ${at}` }] })
    .where(eq(s.recommendations.id, id))
    .returning();
  return u;
}

/**
 * The goods arrived. Only here does stock actually move, as a `receipt` event correlated to the
 * purchase order by `ref`. The date matters: the gap between order and receipt is the supplier's
 * real lead time, which is what replaces the "fastest delivery" assumption.
 */
export async function markReceived(id: string, opts: { at?: string; qty?: number } = {}) {
  const rec = await getRecOr404(id);
  const [decision] = await db.select().from(s.decisions).where(eq(s.decisions.recommendationId, id));
  if (!decision?.productId) throw new HttpError(422, "This decision has no product to receive against.");
  if (!decision.executedAt) throw new HttpError(409, "Mark the order as placed first — a receipt has to arrive against a purchase order.");
  if (decision.arrivedAt) throw new HttpError(409, "These goods are already recorded as received.");

  const ordered = decision.approvedQty ?? decision.recommendedQty ?? 0;
  const qty = opts.qty ?? ordered;
  if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(422, "Received quantity must be a positive number of units.");
  const at = opts.at ?? (await getAsOf());
  if (at < (decision.orderedAtDate ?? "")) throw new HttpError(422, `Goods cannot arrive (${at}) before the order was placed (${decision.orderedAtDate}).`);

  const events: Parameters<typeof appendEvents>[0] = [
    {
      id: `receipt_${decision.id}`,
      productId: decision.productId,
      kind: "receipt",
      qty,
      at,
      source: "owner",
      note: qty === ordered ? `Delivery received for order ${decision.id}` : `Partial/over delivery: ordered ${ordered}, received ${qty}`,
      ref: `decision_${decision.id}`,
    },
  ];
  await appendEvents(events);
  await db.update(s.decisions).set({ arrivedAt: at, receivedQty: qty }).where(eq(s.decisions.id, decision.id));
  const [u] = await db
    .update(s.recommendations)
    .set({ updatedAt: new Date(), lifecycle: [...rec.lifecycle, { stage: "RECEIVED", at: new Date().toISOString(), note: `${qty} unit(s) received on ${at}` }] })
    .where(eq(s.recommendations.id, id))
    .returning();
  return { recommendation: u, receivedQty: qty, orderedQty: ordered };
}

// ───────────────────────── Preference learning ─────────────────────────
const THEMES: { key: string; re: RegExp; label: string }[] = [
  { key: "weekend", re: /weekend|saturday|sunday/i, label: "weekend demand" },
  { key: "cash", re: /cash|money|budget|afford/i, label: "cash flow" },
  { key: "stock_arriving", re: /arriving|in transit|already ordered|last month/i, label: "stock already on the way" },
  { key: "festival", re: /festival|season|wedding|diwali|eid/i, label: "seasonal demand" },
  { key: "space", re: /space|storage|room/i, label: "storage space" },
];

async function setPref(key: string, statement: string, data: Record<string, unknown>, n: number) {
  await db
    .insert(s.preferences)
    .values({ key, statement, data, evidenceCount: n })
    .onConflictDoUpdate({ target: s.preferences.key, set: { statement, data, evidenceCount: n, updatedAt: new Date() } });
}

/** Deterministic pattern mining over decisions + outcomes. No LLM involved. */
export async function relearn() {
  const [decs, outs] = await Promise.all([db.select().from(s.decisions), db.select().from(s.outcomes)]);
  const keep = new Set<string>();

  const mods = decs.filter((d) => d.kind === "modified" && d.recommendedQty && d.approvedQty !== null && d.recommendedQty > 0);
  if (mods.length) {
    const ratio = mods.reduce((a, d) => a + (d.approvedQty as number) / (d.recommendedQty as number), 0) / mods.length;
    keep.add("order_size_ratio");
    await setPref(
      "order_size_ratio",
      `You usually adjust my order quantities to about ${Math.round(ratio * 100)}% of the recommendation (${mods.length} adjustment${mods.length > 1 ? "s" : ""}).`,
      { ratio: Math.round(ratio * 100) / 100, n: mods.length },
      mods.length,
    );
  }
  for (const t of THEMES) {
    const hits = decs.filter((d) => d.reason && t.re.test(d.reason));
    if (!hits.length) continue;
    const smaller = hits.filter((d) => d.kind === "modified" && (d.approvedQty ?? 0) < (d.recommendedQty ?? 0)).length;
    const rejected = hits.filter((d) => d.kind === "rejected").length;
    const special = t.key === "weekend" && smaller > 0;
    if (!special && hits.length < 2) continue; // one data point is an anecdote, not a pattern
    const key = `theme:${t.key}`;
    keep.add(key);
    const statement =
      special
        ? "Owner prefers smaller orders when weekend demand is uncertain."
        : `${t.label[0].toUpperCase() + t.label.slice(1)} often shapes your decisions (${hits.length} time${hits.length > 1 ? "s" : ""}; ${smaller} smaller order${smaller === 1 ? "" : "s"}, ${rejected} rejection${rejected === 1 ? "" : "s"}).`;
    await setPref(key, statement, { theme: t.key, smaller, rejected }, hits.length);
  }
  const measurable = outs.filter(isBiasUsable);
  if (measurable.length >= 2) {
    const bias = measurable.reduce((a, o) => a + (o.actualDemand - o.forecastDemand) / o.forecastDemand, 0) / measurable.length;
    keep.add("forecast_bias");
    await setPref(
      "forecast_bias",
      `Across ${measurable.length} measured decisions, actual demand was on average ${Math.abs(Math.round(bias * 100))}% ${bias < 0 ? "below" : "above"} my forecast.`,
      { bias: Math.round(bias * 100) / 100, n: measurable.length },
      measurable.length,
    );
  }
  const all = await db.select({ key: s.preferences.key }).from(s.preferences);
  for (const p of all) if (!keep.has(p.key)) await db.delete(s.preferences).where(eq(s.preferences.key, p.key));
}
