// Read-side queries for pages and API routes.
import { db } from "@/db";
import * as s from "@/db/schema";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { backtest, weekdayFactors } from "@/lib/forecast-core";
import { weekdayOf } from "@/lib/dates";
import { getAsOf, loadInputs } from "./engine";

export type RecRow = typeof s.recommendations.$inferSelect;

const sevOrder: Record<string, number> = { high: 0, medium: 1, opportunity: 2 };

export async function getDataSummary() {
  const [sales, prods, sup, issues, imps, lastSale] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(s.sales),
    db.select({ n: sql<number>`count(*)::int` }).from(s.products),
    db.select({ n: sql<number>`count(distinct ${s.supplierOffers.supplierId})::int` }).from(s.supplierOffers),
    db.select().from(s.dataQualityIssues).orderBy(s.dataQualityIssues.severity, desc(s.dataQualityIssues.count)),
    db.select().from(s.imports).orderBy(desc(s.imports.id)).limit(8),
    getAsOf(),
  ]);
  return {
    salesRecords: sales[0]?.n ?? 0,
    products: prods[0]?.n ?? 0,
    suppliers: sup[0]?.n ?? 0,
    asOf: lastSale,
    issues,
    imports: imps,
    hasData: (sales[0]?.n ?? 0) > 0 && (prods[0]?.n ?? 0) > 0,
  };
}

export async function listRecs(statuses?: string[]) {
  const rows = statuses?.length
    ? await db.select().from(s.recommendations).where(inArray(s.recommendations.status, statuses))
    : await db.select().from(s.recommendations);
  return rows.sort(
    (a, b) =>
      (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) ||
      (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9) ||
      b.confidence - a.confidence ||
      b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
}

export async function getRecDetail(id: string) {
  const [rec] = await db.select().from(s.recommendations).where(eq(s.recommendations.id, id));
  if (!rec) return null;
  const [decs, outs, product] = await Promise.all([
    db.select().from(s.decisions).where(eq(s.decisions.recommendationId, id)),
    db.select().from(s.outcomes).where(eq(s.outcomes.recommendationId, id)),
    rec.productId ? db.select().from(s.products).where(eq(s.products.id, rec.productId)) : Promise.resolve([]),
  ]);
  return { rec, decision: decs[0] ?? null, outcome: outs[0] ?? null, product: product[0] ?? null };
}

export async function getNorthStar() {
  const [recs, decs, outs] = await Promise.all([
    db.select({ status: s.recommendations.status }).from(s.recommendations),
    db.select().from(s.decisions),
    db.select().from(s.outcomes),
  ]);
  const real = recs.filter((r) => r.status !== "expired");
  const accepted = decs.filter((d) => d.kind !== "rejected").length;
  const positive = outs.filter((o) => ["close", "reasonable", "avoided_risk"].includes(o.verdict)).length;
  return {
    recommendations: real.length,
    decided: decs.length,
    approved: accepted,
    rejected: decs.length - accepted,
    measurable: outs.length,
    positive,
  };
}

export async function getInventoryRows() {
  const [prods, inv, sigs, fcs] = await Promise.all([
    db.select().from(s.products),
    db.select().from(s.inventory),
    db.select().from(s.signals).where(eq(s.signals.type, "inventory_risk")),
    db.select().from(s.forecasts),
  ]);
  const invM = new Map(inv.map((i) => [i.productId, i]));
  const sigM = new Map(sigs.map((x) => [x.productId, x]));
  const fcM = new Map(fcs.map((f) => [f.productId, f]));
  const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, DATA_ERROR: 2, ABSTAIN: 3, WATCH: 4, SAFE: 5 };
  return prods
    .map((p) => {
      const sg = sigM.get(p.id);
      const payload = (sg?.payload ?? {}) as Record<string, unknown>;
      return {
        id: p.id, name: p.name, category: p.category,
        stock: invM.get(p.id)?.currentStock ?? null,
        level: sg?.level ?? "UNKNOWN",
        probability: sg?.score ?? null,
        daysOfCover: (payload.daysOfCover as number | null | undefined) ?? null,
        leadTimeDays: (payload.leadTimeDays as number | undefined) ?? null,
        inbound: (payload.inbound as number | undefined) ?? 0,
        dailyRate: fcM.get(p.id)?.dailyRate ?? null,
        reasons: (payload.reasons as string[] | undefined) ?? [],
      };
    })
    .sort((a, b) => (rank[a.level] ?? 9) - (rank[b.level] ?? 9) || (b.probability ?? 0) - (a.probability ?? 0));
}

export async function getForecastRows() {
  const [prods, fcs] = await Promise.all([db.select().from(s.products), db.select().from(s.forecasts)]);
  const pm = new Map(prods.map((p) => [p.id, p]));
  return fcs
    .map((f) => ({ ...f, name: pm.get(f.productId)?.name ?? f.productId, category: pm.get(f.productId)?.category ?? null }))
    .sort((a, b) => b.expected - a.expected);
}

export async function getForecastEvaluation() {
  const inputs = await loadInputs();
  const withHistory = inputs.facts.filter((f) => f.historyDays >= 49);
  if (!withHistory.length) return null;
  const wd = weekdayOf(inputs.asOf);
  const bt = backtest(withHistory.map((f) => f.series), wd);
  const worst = bt.perProduct
    .map((p) => ({ name: withHistory[p.index].name, model: p.model, baseline: p.baseline }))
    .sort((a, b) => b.model - a.model)
    .slice(0, 5);
  const sample = withHistory[0];
  return { ...bt, products: withHistory.length, asOf: inputs.asOf, worst, weekdaySample: sample ? weekdayFactors(sample.series, wd) : [] };
}

export async function getSupplierData() {
  const [sup, offers, prods] = await Promise.all([db.select().from(s.suppliers), db.select().from(s.supplierOffers), db.select().from(s.products)]);
  const pm = new Map(prods.map((p) => [p.id, p.name]));
  const bySup = sup.map((x) => {
    const o = offers.filter((y) => y.supplierId === x.id);
    const leads = o.map((y) => y.leadTimeDays).filter((v): v is number => v !== null);
    return {
      id: x.id, name: x.name, products: new Set(o.map((y) => y.productId)).size,
      avgLead: leads.length ? Math.round((leads.reduce((a, b) => a + b, 0) / leads.length) * 10) / 10 : null,
      missingLead: o.filter((y) => y.leadTimeDays === null).length,
    };
  });
  const byProduct = new Map<string, typeof offers>();
  for (const o of offers) byProduct.set(o.productId, [...(byProduct.get(o.productId) ?? []), o]);
  const comparisons = [...byProduct.entries()]
    .filter(([, v]) => new Set(v.map((x) => x.supplierId)).size > 1)
    .map(([pid, v]) => ({ productId: pid, name: pm.get(pid) ?? pid, offers: v.map((x) => ({ supplierId: x.supplierId, price: x.price, lead: x.leadTimeDays, moq: x.moq })) }))
    .slice(0, 40);
  return { suppliers: bySup, comparisons, names: Object.fromEntries(sup.map((x) => [x.id, x.name])) };
}

export async function getHistory() {
  const [decs, outs, recs, prefs, prods] = await Promise.all([
    db.select().from(s.decisions).orderBy(desc(s.decisions.id)),
    db.select().from(s.outcomes),
    db.select({ id: s.recommendations.id, title: s.recommendations.title, type: s.recommendations.type }).from(s.recommendations),
    db.select().from(s.preferences),
    db.select({ id: s.products.id, name: s.products.name }).from(s.products),
  ]);
  const om = new Map(outs.map((o) => [o.decisionId, o]));
  const rm = new Map(recs.map((r) => [r.id, r]));
  const pm = new Map(prods.map((p) => [p.id, p.name]));
  return {
    decisions: decs.map((d) => ({ ...d, outcome: om.get(d.id) ?? null, rec: rm.get(d.recommendationId) ?? null, productName: d.productId ? (pm.get(d.productId) ?? d.productId) : null })),
    preferences: prefs,
  };
}

export async function getWorkflowData() {
  const [schedules, runs] = await Promise.all([
    db.select().from(s.workflowSchedules),
    db.select().from(s.workflowRuns).orderBy(desc(s.workflowRuns.id)).limit(15),
  ]);
  return { schedules, runs };
}

export async function getRecentRuns(limit = 12) {
  return db.select().from(s.agentRuns).orderBy(desc(s.agentRuns.createdAt)).limit(limit);
}
