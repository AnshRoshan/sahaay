// Deterministic forecasting math. Pure: operates on number arrays only.
// This is both the built-in fallback engine and the feature builder for TabPFN.

export const HORIZON = 7;

export type CoreForecast = {
  expected: number;
  low: number;
  high: number;
  dailyRate: number;
  dailySd: number;
  trendPct: number;
  confidence: number;
  historyDays: number;
};

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
export const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0);
const variance = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return sum(a.map((x) => (x - m) ** 2)) / (a.length - 1);
};
const tail = (a: number[], n: number) => a.slice(Math.max(0, a.length - n));
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Recent 14-day level vs the 6 weeks before it. */
export function trendPct(series: number[]): number {
  const n = series.length;
  const m14 = mean(tail(series, 14));
  const prior =
    n >= 56 ? mean(series.slice(n - 56, n - 14)) : n >= 28 ? mean(series.slice(0, n - 14)) : 0;
  if (prior < 0.05) return 0;
  return clamp((m14 - prior) / prior, -0.95, 3);
}

export function historyDaysOf(series: number[]): number {
  const first = series.findIndex((x) => x > 0);
  return first === -1 ? 0 : series.length - first;
}

/** Weekday multipliers (index 0=Sun), shrunk toward 1 to avoid overfitting. */
export function weekdayFactors(series: number[], endWeekday: number): number[] {
  const n = series.length;
  const recent = tail(series, 84);
  const off = n - recent.length;
  const overall = mean(recent);
  if (overall <= 0 || recent.length < 28) return Array(7).fill(1);
  const sums = Array(7).fill(0);
  const cnt = Array(7).fill(0);
  recent.forEach((v, j) => {
    const i = off + j;
    const d = (((endWeekday - (n - 1 - i)) % 7) + 7) % 7;
    sums[d] += v;
    cnt[d]++;
  });
  const shrunk = sums.map((s, d) => 1 + 0.5 * ((cnt[d] ? s / cnt[d] / overall : 1) - 1));
  const m = mean(shrunk);
  return shrunk.map((x) => x / m);
}

export function localForecast(
  series: number[],
  endWeekday: number,
  horizon = HORIZON,
): CoreForecast {
  const m7 = mean(tail(series, 7));
  const m14 = mean(tail(series, 14));
  const m28 = mean(tail(series, 28));
  const m90 = mean(tail(series, 90));
  const trend = trendPct(series);
  const level = 0.35 * m14 + 0.3 * m28 + 0.2 * m7 + 0.15 * m90;
  const rate = Math.max(0, level * (1 + 0.3 * clamp(trend, -0.6, 0.6)));
  const f = weekdayFactors(series, endWeekday);
  let expected = 0;
  for (let h = 1; h <= horizon; h++) expected += rate * f[(endWeekday + h) % 7];

  const dailyVar = Math.max(variance(tail(series, 56)) * 1.2, rate);
  const sd = Math.sqrt(horizon * dailyVar + (0.15 * expected) ** 2);
  const low = Math.max(0, expected - 1.28 * sd);
  const high = expected + 1.28 * sd;

  const historyDays = historyDaysOf(series);
  const confidence = confidenceOf(expected, low, high, historyDays);

  return {
    expected: round1(expected),
    low: round1(low),
    high: round1(high),
    dailyRate: round2(rate),
    dailySd: round2(Math.sqrt(dailyVar)),
    trendPct: round2(trend),
    confidence: round2(confidence),
    historyDays,
  };
}

/** 0–1 confidence from interval width relative to the estimate, discounted for short history. */
export function confidenceOf(expected: number, low: number, high: number, historyDays: number): number {
  const dataFactor = Math.min(1, historyDays / 60);
  const relWidth = (high - low) / Math.max(expected, 1);
  const stability = 1 / (1 + relWidth * 0.9);
  return clamp(dataFactor * (0.35 + 0.65 * stability), 0.05, 0.95);
}

export const round1 = (x: number) => Math.round(x * 10) / 10;
export const round2 = (x: number) => Math.round(x * 100) / 100;

/** Feature vector for tabular models (TabPFN). Uses only data up to the end of `series`. */
export function featureRow(series: number[]): number[] {
  const last28 = tail(series, 28);
  return [
    mean(tail(series, 7)),
    mean(tail(series, 14)),
    mean(last28),
    mean(tail(series, 56)),
    trendPct(series),
    last28.filter((x) => x === 0).length / Math.max(1, last28.length),
    Math.max(0, ...tail(series, 7)),
  ].map(round2);
}

/** Builds pooled (X, y) training rows with strictly past-only features. */
export function buildTrainingRows(
  seriesList: number[][],
  horizon = HORIZON,
): { X: number[][]; y: number[] } {
  const X: number[][] = [];
  const y: number[] = [];
  for (const s of seriesList) {
    for (let cut = s.length - horizon; cut >= 35; cut -= 7) {
      X.push(featureRow(s.slice(0, cut)));
      y.push(sum(s.slice(cut, cut + horizon)));
    }
  }
  return { X, y };
}

export type BacktestResult = {
  n: number;
  model: { mae: number; rmse: number };
  baseline: { mae: number; rmse: number };
  improvementPct: number;
  intervalCoverage: number;
  perProduct: { index: number; model: number; baseline: number }[];
};

/**
 * Rolling-origin backtest versus a naive baseline ("next week = last week").
 * `endWeekday` is the weekday of the final element of every series.
 */
export function backtest(
  seriesList: number[][],
  endWeekday: number,
  origins: number[] = [28, 21, 14, 7],
  horizon = HORIZON,
): BacktestResult {
  let n = 0;
  let mAbs = 0, mSq = 0, bAbs = 0, bSq = 0, covered = 0;
  const per: Record<number, { model: number; baseline: number; c: number }> = {};
  seriesList.forEach((s, idx) => {
    for (const o of origins) {
      const cut = s.length - o;
      if (cut < 42 || cut + horizon > s.length) continue;
      const hist = s.slice(0, cut);
      const actual = sum(s.slice(cut, cut + horizon));
      if (sum(hist.slice(-28)) === 0 && actual === 0) continue; // dead item, uninformative
      const cutWeekday = (((endWeekday - o) % 7) + 7) % 7;
      const fc = localForecast(hist, cutWeekday, horizon);
      const base = sum(tail(hist, 7));
      const me = Math.abs(fc.expected - actual);
      const be = Math.abs(base - actual);
      mAbs += me; mSq += me * me; bAbs += be; bSq += be * be;
      if (actual >= fc.low && actual <= fc.high) covered++;
      n++;
      per[idx] ??= { model: 0, baseline: 0, c: 0 };
      per[idx].model += me; per[idx].baseline += be; per[idx].c++;
    }
  });
  const d = Math.max(n, 1);
  const model = { mae: round2(mAbs / d), rmse: round2(Math.sqrt(mSq / d)) };
  const baseline = { mae: round2(bAbs / d), rmse: round2(Math.sqrt(bSq / d)) };
  return {
    n,
    model,
    baseline,
    improvementPct: baseline.mae > 0 ? round1(((baseline.mae - model.mae) / baseline.mae) * 100) : 0,
    intervalCoverage: round2(covered / d),
    perProduct: Object.entries(per).map(([i, v]) => ({
      index: Number(i),
      model: round2(v.model / v.c),
      baseline: round2(v.baseline / v.c),
    })),
  };
}

/** Counts runs of >= minRun zero-sales days in the last 90 days for items that normally sell. */
export function possibleStockoutRuns(series: number[], minRun = 4): number {
  const s = tail(series, 90);
  if (mean(s) < 0.4) return 0;
  let runs = 0, cur = 0;
  for (const x of s) {
    if (x === 0) cur++;
    else {
      if (cur >= minRun) runs++;
      cur = 0;
    }
  }
  // a trailing zero run is current, not historical
  return runs;
}
