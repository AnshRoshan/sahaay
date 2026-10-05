// Orchestrates: load → forecast → risk → recommend → validate → persist.
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { analyzeProduct, supplierOpportunities, type AnalysisContext, type PrevDecision, type ProductAnalysis } from "@/lib/analysis";
import { addDays, diffDays, todayStr } from "@/lib/dates";
import { explainTemplate } from "@/lib/explain";
import { historyDaysOf } from "@/lib/forecast-core";
import type { ProductFacts, RecDraft, RuleSet, SupplierOffer } from "@/lib/types";
import { forecastAll } from "./forecast-service";
import { derivedStock } from "./ledger";
import { Tracer } from "./observability";
import { loadRules } from "./rules";

export const WINDOW_DAYS = 120;

export async function getAsOf(): Promise<string> {
  const r = await db.select({ m: sql<string | null>`max(${s.sales.saleDate})` }).from(s.sales);
  return r[0]?.m ?? todayStr();
}

export type Inputs = {
  asOf: string;
  facts: ProductFacts[];
  rules: RuleSet;
  supplierNames: Record<string, string>;
  memory: AnalysisContext["memory"];
  totalStockUnits: number;
  /** Derived from the event ledger — provenance for the inventory number used in analysis. */
  ledgerStock: Record<string, { quantity: number; events: number }>;
};

export async function loadInputs(): Promise<Inputs> {
  const asOf = await getAsOf();
  const start = addDays(asOf, -(WINDOW_DAYS - 1));
  const [prods, inv, offers, sup, rules, saleRows, prefs, decs] = await Promise.all([
    db.select().from(s.products),
    db.select().from(s.inventory),
    db.select().from(s.supplierOffers),
    db.select().from(s.suppliers),
    loadRules(),
    db
      .select({ productId: s.sales.productId, d: s.sales.saleDate, q: sql<number>`sum(${s.sales.quantity})::int` })
      .from(s.sales)
      .groupBy(s.sales.productId, s.sales.saleDate),
    db.select().from(s.preferences),
    db.select().from(s.decisions).orderBy(s.decisions.id),
  ]);

  const series = new Map<string, number[]>();
  for (const r of saleRows) {
    const idx = diffDays(r.d, start);
    if (idx < 0 || idx >= WINDOW_DAYS) continue;
    const arr = series.get(r.productId) ?? Array(WINDOW_DAYS).fill(0);
    arr[idx] += Number(r.q);
    series.set(r.productId, arr);
  }
  const invMap = new Map(inv.map((i) => [i.productId, i]));
  const offerMap = new Map<string, SupplierOffer[]>();
  for (const o of offers) offerMap.set(o.productId, [...(offerMap.get(o.productId) ?? []), o]);

  const inbound = new Map<string, number>();
  const previous: Record<string, PrevDecision> = {};
  for (const d of decs) {
    if (!d.productId) continue;
    previous[d.productId] = { kind: d.kind, recommended: d.recommendedQty, approved: d.approvedQty, reason: d.reason, date: d.decisionDate };
    if (d.kind !== "rejected" && (d.approvedQty ?? 0) > 0 && !d.arrivedAt)
      inbound.set(d.productId, (inbound.get(d.productId) ?? 0) + (d.approvedQty ?? 0));
  }

  const facts: ProductFacts[] = prods.map((p) => {
    const ser = series.get(p.id) ?? Array(WINDOW_DAYS).fill(0);
    const i = invMap.get(p.id);
    return {
      id: p.id, name: p.name, category: p.category, unitCost: p.unitCost, sellPrice: p.sellPrice,
      stock: i ? i.currentStock : null, inbound: inbound.get(p.id) ?? 0, reorderLevel: i?.reorderLevel ?? null,
      offers: offerMap.get(p.id) ?? [], series: ser, historyDays: historyDaysOf(ser),
      totalUnits: ser.reduce((a, b) => a + b, 0),
    };
  });
  const pref = (k: string) => prefs.find((p) => p.key === k)?.data as Record<string, number> | undefined;
  const ledgerStock = await derivedStock();
  return {
    asOf, facts, rules,
    supplierNames: Object.fromEntries(sup.map((x) => [x.id, x.name])),
    memory: { orderRatio: pref("order_size_ratio")?.ratio ?? null, forecastBias: pref("forecast_bias")?.bias ?? null, previous },
    totalStockUnits: facts.reduce((a, f) => a + Math.max(0, f.stock ?? 0), 0),
    ledgerStock,
  };
}

export function newRecId() {
  return `rec_${crypto.randomUUID().slice(0, 10)}`;
}

export function initialLifecycle(): { stage: string; at: string; note?: string }[] {
  const at = new Date().toISOString();
  // capture → understand → predict → simulate → verify → awaiting human approval
  return ["DETECTED", "ANALYZED", "RECOMMENDED", "SIMULATED", "VALIDATED", "PENDING_APPROVAL"].map((stage) => ({ stage, at }));
}

export async function persistRecs(drafts: RecDraft[]) {
  const pending = await db.select().from(s.recommendations).where(eq(s.recommendations.status, "pending"));
  const byKey = new Map(pending.map((p) => [p.dedupeKey, p]));
  const seen = new Set<string>();
  let created = 0, updated = 0;
  for (const d of drafts) {
    seen.add(d.dedupeKey);
    const explanation = explainTemplate(d);
    const fields = {
      type: d.type, severity: d.severity, title: d.title, summary: d.summary, productId: d.productId,
      confidence: d.confidence, abstain: d.abstain, verdict: d.verdict, needsInfo: d.needsInfo,
      evidence: d.evidence as unknown[], action: d.action as unknown as Record<string, unknown>,
      risks: d.risks as unknown[], alternatives: d.alternatives as unknown[],
      validation: d.validation as unknown as Record<string, unknown> | null,
      calculation: d.calculation as unknown as Record<string, unknown> | null,
      simulation: (d.simulation ?? null) as unknown as Record<string, unknown> | null,
      explanation, explanationSource: "template", updatedAt: new Date(),
    };
    const ex = byKey.get(d.dedupeKey);
    if (ex) {
      await db.update(s.recommendations).set(fields).where(eq(s.recommendations.id, ex.id));
      updated++;
    } else {
      await db.insert(s.recommendations).values({ id: newRecId(), dedupeKey: d.dedupeKey, status: "pending", lifecycle: initialLifecycle(), ...fields });
      created++;
    }
  }
  let expired = 0;
  for (const p of pending) {
    if (seen.has(p.dedupeKey)) continue;
    await db
      .update(s.recommendations)
      .set({ status: "expired", updatedAt: new Date(), lifecycle: [...p.lifecycle, { stage: "EXPIRED", at: new Date().toISOString(), note: "Signal no longer present after re-analysis" }] })
      .where(and(eq(s.recommendations.id, p.id), eq(s.recommendations.status, "pending")));
    expired++;
  }
  return { created, updated, expired };
}

export type AnalysisSummary = {
  asOf: string;
  products: number;
  forecastModel: string;
  note?: string;
  levels: Record<string, number>;
  recs: { created: number; updated: number; expired: number; pending: number };
  runId?: string;
};

export async function runAnalysis(tracer?: Tracer): Promise<AnalysisSummary> {
  const t = tracer ?? new Tracer("analysis", "run analysis");
  try {
    const inputs = await t.span("data.load", async (set) => {
      const i = await loadInputs();
      set({ products: i.facts.length, asOf: i.asOf });
      return i;
    });
    const { results, model, note } = await forecastAll(inputs.facts, inputs.asOf, t);
    const ctx: AnalysisContext = { asOf: inputs.asOf, rules: inputs.rules, totalStockUnits: inputs.totalStockUnits, supplierNames: inputs.supplierNames, memory: inputs.memory, ledgerStock: inputs.ledgerStock };

    const analyses = await t.span("risk.engine+recommend", (set) => {
      const out: { facts: ProductFacts; fc: NonNullable<ReturnType<typeof results.get>>; analysis: ProductAnalysis }[] = [];
      for (const f of inputs.facts) {
        const fc = results.get(f.id)!;
        out.push({ facts: f, fc, analysis: analyzeProduct(f, fc, ctx) });
      }
      set({ analysed: out.length });
      return out;
    });
    const drafts: RecDraft[] = await t.span("validation.engine", (set) => {
      const d = analyses.flatMap((a) => a.analysis.recs);
      d.push(...supplierOpportunities(analyses, ctx));
      set({ drafts: d.length, blocked: d.filter((x) => x.validation?.status === "block").length });
      return d;
    });

    const signals = analyses.flatMap((a) => a.analysis.signals);
    const persisted = await t.span("memory.persist", async () => {
      await db.delete(s.forecasts);
      const fr = [...results.values()].map((f) => ({ ...f, asOf: inputs.asOf }));
      for (let i = 0; i < fr.length; i += 500) if (fr.length) await db.insert(s.forecasts).values(fr.slice(i, i + 500));
      await db.delete(s.signals);
      for (let i = 0; i < signals.length; i += 500) if (signals.length) await db.insert(s.signals).values(signals.slice(i, i + 500));
      return persistRecs(drafts);
    });

    const levels: Record<string, number> = {};
    for (const sg of signals) if (sg.type === "inventory_risk") levels[sg.level] = (levels[sg.level] ?? 0) + 1;
    const pend = await db.select({ n: sql<number>`count(*)::int` }).from(s.recommendations).where(eq(s.recommendations.status, "pending"));
    const summary: AnalysisSummary = {
      asOf: inputs.asOf, products: inputs.facts.length, forecastModel: model, note, levels,
      recs: { ...persisted, pending: pend[0]?.n ?? 0 }, runId: t.id,
    };
    if (!tracer) await t.finish("ok", summary as unknown as Record<string, unknown>);
    return summary;
  } catch (e) {
    if (!tracer) await t.finish("error", null, e);
    throw e;
  }
}
