// Forecasting service. Prediction ≠ recommendation: this module only predicts.
// TabPFN (service) is used when TABPFN_URL is set; otherwise (or on failure) the local engine runs.
import { buildTrainingRows, confidenceOf, featureRow, historyDaysOf, HORIZON, localForecast, round1, round2, trendPct } from "@/lib/forecast-core";
import { weekdayOf } from "@/lib/dates";
import type { ForecastResult, ProductFacts } from "@/lib/types";
import { captureException, type Tracer } from "./observability";

export const tabpfnConfigured = () => !!process.env.TABPFN_URL;

function localAll(facts: ProductFacts[], asOf: string): Map<string, ForecastResult> {
  const wd = weekdayOf(asOf);
  const out = new Map<string, ForecastResult>();
  for (const f of facts) {
    const c = localForecast(f.series, wd);
    out.set(f.id, { productId: f.id, horizonDays: HORIZON, model: "local-ensemble", ...c });
  }
  return out;
}

async function tabpfnAll(facts: ProductFacts[], asOf: string): Promise<Map<string, ForecastResult>> {
  const base = process.env.TABPFN_URL!.replace(/\/$/, "");
  const train = buildTrainingRows(facts.map((f) => f.series).filter((s) => s.length >= 42));
  if (train.X.length < 20) throw new Error("Not enough history to build a TabPFN training set");
  const res = await fetch(`${base}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(process.env.TABPFN_API_KEY ? { Authorization: `Bearer ${process.env.TABPFN_API_KEY}` } : {}) },
    body: JSON.stringify({ train, predict: { X: facts.map((f) => featureRow(f.series)) }, quantiles: [0.1, 0.5, 0.9] }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`TabPFN HTTP ${res.status}`);
  const j = (await res.json()) as { mean: number[]; q10: number[]; q90: number[] };
  const wd = weekdayOf(asOf);
  const out = new Map<string, ForecastResult>();
  facts.forEach((f, i) => {
    const expected = Math.max(0, j.mean[i]);
    const low = Math.max(0, Math.min(j.q10[i], expected));
    const high = Math.max(j.q90[i], expected);
    const hd = historyDaysOf(f.series);
    const sdH = (high - low) / 2.563;
    // zero-history items: TabPFN extrapolates from the pool; keep the conservative local estimate
    if (hd === 0) {
      const c = localForecast(f.series, wd);
      out.set(f.id, { productId: f.id, horizonDays: HORIZON, model: "local-ensemble", ...c });
      return;
    }
    out.set(f.id, {
      productId: f.id, horizonDays: HORIZON, model: "tabpfn",
      expected: round1(expected), low: round1(low), high: round1(high),
      dailyRate: round2(expected / HORIZON), dailySd: round2(sdH / Math.sqrt(HORIZON)),
      trendPct: round2(trendPct(f.series)), confidence: round2(confidenceOf(expected, low, high, hd)), historyDays: hd,
    });
  });
  return out;
}

export async function forecastAll(
  facts: ProductFacts[],
  asOf: string,
  tracer?: Tracer,
): Promise<{ results: Map<string, ForecastResult>; model: string; note?: string }> {
  if (tabpfnConfigured()) {
    try {
      const run = (set: (a: Record<string, unknown>) => void) => {
        set({ products: facts.length, service: "tabpfn" });
        return tabpfnAll(facts, asOf);
      };
      const results = tracer ? await tracer.span("tabpfn.predict", run) : await run(() => undefined);
      return { results, model: "tabpfn" };
    } catch (e) {
      await captureException(e, { kind: "forecast", fallback: "local-ensemble" });
      const run = (set: (a: Record<string, unknown>) => void) => {
        set({ products: facts.length, fallback: true });
        return localAll(facts, asOf);
      };
      const results = tracer ? await tracer.span("forecast.local_fallback", run) : await run(() => undefined);
      return { results, model: "local-ensemble", note: `TabPFN unavailable (${e instanceof Error ? e.message : "error"}); used local engine.` };
    }
  }
  const run = (set: (a: Record<string, unknown>) => void) => {
    set({ products: facts.length });
    return localAll(facts, asOf);
  };
  const results = tracer ? await tracer.span("forecast.local", run) : await run(() => undefined);
  return { results, model: "local-ensemble" };
}
