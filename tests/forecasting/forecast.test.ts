import { test } from "node:test";
import assert from "node:assert/strict";
import { backtest, localForecast, trendPct } from "../../src/lib/forecast-core";
import { generateDemoCsvs } from "../../src/lib/demo-data";
import { parseCsv } from "../../src/lib/csv";
import { addDays, diffDays, weekdayOf } from "../../src/lib/dates";

function demoSeries() {
  const d = generateDemoCsvs("2025-06-02");
  const rows = parseCsv(d.sales).rows;
  const asOf = d.meta.asOf;
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const idx = 119 - diffDays(asOf, r.date);
    if (!/^\d{4}-\d\d-\d\d$/.test(r.date) || idx < 0 || idx > 119) continue;
    const s = map.get(r.product_id) ?? Array(120).fill(0);
    s[idx] += Number(r.quantity);
    map.set(r.product_id, s);
  }
  return { map, asOf };
}

test("flat series forecasts roughly its mean", () => {
  const f = localForecast(Array(90).fill(2), 1);
  assert.ok(Math.abs(f.expected - 14) < 2);
  assert.ok(f.low <= f.expected && f.expected <= f.high);
});

test("rising series has positive trend", () => {
  const s = [...Array(60).fill(1), ...Array(14).fill(2)];
  assert.ok(trendPct(s) > 0.3);
});

test("empty series is low-confidence zero forecast", () => {
  const f = localForecast(Array(90).fill(0), 1);
  assert.equal(f.expected, 0);
  assert.ok(f.confidence <= 0.1);
});

test("backtest reports MAE/RMSE vs naive baseline on demo data", () => {
  const { map, asOf } = demoSeries();
  const bt = backtest([...map.values()], weekdayOf(asOf));
  console.log("backtest", JSON.stringify(bt.model), JSON.stringify(bt.baseline), bt.improvementPct, bt.intervalCoverage);
  assert.ok(bt.n > 100);
  assert.ok(bt.model.mae > 0 && bt.baseline.mae > 0);
  assert.ok(bt.model.mae <= bt.baseline.mae * 1.05, "model should be at least on par with naive baseline");
});

test("date helper sanity", () => {
  assert.equal(addDays("2025-03-01", -1), "2025-02-28");
});
