// Loads the demo shop through the SAME ingestion + analysis path as real uploads,
// then seeds a short, honest decision history so the Memory/Outcome loop is visible.
import { db } from "@/db";
import * as s from "@/db/schema";
import { sql } from "drizzle-orm";
import { analyzeProduct } from "@/lib/analysis";
import { addDays, weekdayOf } from "@/lib/dates";
import { generateDemoCsvs } from "@/lib/demo-data";
import { explainTemplate } from "@/lib/explain";
import { historyDaysOf, HORIZON, localForecast } from "@/lib/forecast-core";
import type { ForecastResult } from "@/lib/types";
import { initialLifecycle, loadInputs, newRecId, runAnalysis } from "./engine";
import { HttpError } from "./http";
import { ingestCsv, type IngestReport } from "./ingest";
import { relearn } from "./memory";
import { measureOutcomes } from "./outcomes";
import { Tracer } from "./observability";

const HISTORY = [
  { productId: "white-shirt-l", daysAgo: 12, kind: "modified" as const, factor: 0.67, stock: 0, reason: "Expected weekend demand lower" },
  { productId: "blue-shirt-l", daysAgo: 13, kind: "modified" as const, factor: 0.6, stock: 0, reason: "Expected weekend demand lower" },
  { productId: "polo-tee-l", daysAgo: 14, kind: "modified" as const, factor: 0.75, stock: 0, reason: "Cash is tight this week" },
  { productId: "cotton-kurta-m", daysAgo: 13, kind: "approved" as const, factor: 1, stock: 0, reason: null },
  { productId: "checked-shirt-m", daysAgo: 12, kind: "approved" as const, factor: 1, stock: 0, reason: null },
  { productId: "blue-jeans-34", daysAgo: 12, kind: "rejected" as const, factor: 1, stock: 2, reason: "I still have stock arriving from last month" },
];

export async function resetAll(opts: { confirm?: boolean } = {}) {
  const [events, salesRows] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(s.ledgerEvents),
    db.select({ n: sql<number>`count(*)::int` }).from(s.sales),
  ]);
  const atRisk = (events[0]?.n ?? 0) + (salesRows[0]?.n ?? 0);
  if (atRisk > 0 && !opts.confirm && process.env.ALLOW_DEMO_RESET !== "1") {
    // ledger_events is append-only business truth; truncating it cannot be undone.
    throw new HttpError(
      409,
      `Loading the demo shop would erase ${atRisk} record(s) already in this database. The ledger has no undo.`,
      { needsConfirmation: true, recordsAtRisk: atRisk },
    );
  }
  await db.execute(sql`truncate table ledger_events, captures, sales, inventory, supplier_offers, suppliers, products, imports, data_quality_issues, forecasts, signals, recommendations, decisions, outcomes, preferences, workflow_runs, agent_runs restart identity`);
}

async function seedHistory() {
  const inputs = await loadInputs();
  let seeded = 0;
  for (const h of HISTORY) {
    const f = inputs.facts.find((x) => x.id === h.productId);
    if (!f) continue;
    const cutAsOf = addDays(inputs.asOf, -h.daysAgo);
    const hist = f.series.slice(0, f.series.length - h.daysAgo);
    const core = localForecast(hist, weekdayOf(cutAsOf));
    const fc: ForecastResult = { productId: f.id, horizonDays: HORIZON, model: "local-ensemble", ...core };
    const facts = { ...f, series: hist, stock: h.stock, inbound: 0, historyDays: historyDaysOf(hist), totalUnits: hist.reduce((a, b) => a + b, 0) };
    const a = analyzeProduct(facts, fc, {
      asOf: cutAsOf, rules: inputs.rules, totalStockUnits: inputs.totalStockUnits, supplierNames: inputs.supplierNames,
      memory: { orderRatio: null, forecastBias: null, previous: {} },
    });
    const d = a.recs.find((r) => r.type === "reorder" && !r.abstain);
    if (!d) continue;
    d.evidence.push({ source: "memory", label: "Demo seed", value: { stockAssumed: h.stock }, explanation: "This historical decision is seeded for the demo; the stock level at that time is an assumption." });
    const q = d.action.quantity as number;
    const moq = d.calculation?.validationInput?.moq ?? 1;
    const approved = h.kind === "modified" ? Math.max(moq, Math.round(q * h.factor)) : h.kind === "approved" ? q : null;
    if (h.kind === "modified" && approved !== null && approved >= q) continue; // an "adjustment" must actually differ
    const recId = newRecId();
    const at = new Date(Date.now() - h.daysAgo * 86400000).toISOString();
    const status = h.kind;
    await db.insert(s.recommendations).values({
      id: recId, dedupeKey: `seed:${f.id}`, type: d.type, severity: d.severity, title: d.title, summary: d.summary,
      productId: f.id, status, confidence: d.confidence, abstain: false, verdict: d.verdict, needsInfo: [],
      evidence: d.evidence as unknown[], action: d.action as unknown as Record<string, unknown>, risks: d.risks as unknown[],
      alternatives: d.alternatives as unknown[], validation: d.validation as unknown as Record<string, unknown>,
      simulation: (d.simulation ?? null) as unknown as Record<string, unknown> | null,
      calculation: d.calculation as unknown as Record<string, unknown>, explanation: explainTemplate(d), explanationSource: "template",
      lifecycle: [
        ...initialLifecycle(d).map((l) => ({ ...l, at })),
        { stage: h.kind === "rejected" ? "REJECTED" : h.kind === "modified" ? "MODIFIED" : "APPROVED", at, note: h.reason ?? undefined },
        ...(h.kind !== "rejected" ? [{ stage: "MONITORED", at }] : []),
      ],
    });
    const lead = d.action.leadTimeDays ?? 6;
    await db.insert(s.decisions).values({
      recommendationId: recId, productId: f.id, kind: h.kind, recommendedQty: q, approvedQty: approved, reason: h.reason,
      supplierId: d.action.supplierId ?? null, unitPrice: d.action.unitPrice ?? null, stockAtDecision: h.stock,
      forecastDailyRate: fc.dailyRate, leadTimeDays: lead, decisionDate: cutAsOf,
      arrivedAt: h.kind === "rejected" ? null : addDays(cutAsOf, lead),
    });
    seeded++;
  }
  return seeded;
}

export async function loadDemo(opts: { confirm?: boolean } = {}): Promise<{ imports: IngestReport[]; seededDecisions: number; analysisRunId?: string }> {
  const t = new Tracer("analysis", "load demo shop");
  try {
    await t.span("demo.reset", () => resetAll(opts));
    const bundle = generateDemoCsvs();
    const imports: IngestReport[] = [];
    // Order matters: products must exist before anything references them, and sales must be
    // loaded before inventory so the inventory snapshot's event baseline can be dated to the
    // real as-of date. Dated in the future it would clobber real movements.
    for (const [kind, text] of [["products", bundle.products], ["sales", bundle.sales], ["suppliers", bundle.suppliers], ["inventory", bundle.inventory]] as const)
      imports.push(await t.span(`ingest.${kind}`, async (set) => {
        const r = await ingestCsv(text, { kind, filename: `${kind}.csv` });
        set({ rows: r.rowsTotal, ok: r.rowsOk, rejected: r.rowsRejected });
        return r;
      }));
    const seededDecisions = await t.span("demo.seed_history", () => seedHistory());
    await t.span("outcomes.measure", () => measureOutcomes());
    await t.span("memory.relearn", () => relearn());
    const summary = await runAnalysis(t);
    await t.finish("ok", { ...summary, seededDecisions });
    return { imports, seededDecisions, analysisRunId: t.id };
  } catch (e) {
    await t.finish("error", null, e);
    throw e;
  }
}
