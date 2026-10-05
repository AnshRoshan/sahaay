import test from "node:test";
import assert from "node:assert/strict";
import { classifyOutcome, isBiasUsable, type OutcomeInput } from "@/lib/outcomes-core";

const base: OutcomeInput = {
  kind: "approved",
  actualSold: 10,
  forecastDemand: 10,
  stockAtDecision: 5,
  recommendedQty: 10,
  approvedQty: 10,
  windowDays: 7,
};

test("censored window: declining an order and selling out is NOT scored as avoided risk", () => {
  const r = classifyOutcome({ ...base, kind: "rejected", actualSold: 8, stockAtDecision: 8, approvedQty: null, recommendedQty: 20 });
  assert.equal(r.verdict, "indeterminate");
  assert.equal(r.censored, true);
  assert.match(r.parts.join(" "), /cannot tell|at least/);
});

test("censored window: zero stock and zero sales is indeterminate, not a clean rejection", () => {
  const r = classifyOutcome({ ...base, kind: "rejected", actualSold: 0, stockAtDecision: 0, approvedQty: null });
  assert.equal(r.verdict, "indeterminate");
  assert.equal(r.censored, true);
});

test("uncensored rejection: demand fully served from on-hand stock is a real avoided risk", () => {
  const r = classifyOutcome({ ...base, kind: "rejected", actualSold: 3, stockAtDecision: 12, approvedQty: null, forecastDemand: 4 });
  assert.equal(r.verdict, "avoided_risk");
  assert.equal(r.censored, false);
});

test("censored approval cannot be read as the forecast overestimating demand", () => {
  const r = classifyOutcome({ ...base, actualSold: 15, forecastDemand: 40, stockAtDecision: 5, approvedQty: 10 });
  assert.equal(r.verdict, "indeterminate");
  assert.equal(r.censored, true);
});

test("approval verdicts follow forecast error when demand was fully served", () => {
  assert.equal(classifyOutcome({ ...base, actualSold: 20, forecastDemand: 20, stockAtDecision: 50 }).verdict, "close");
  assert.equal(classifyOutcome({ ...base, actualSold: 12, forecastDemand: 20, stockAtDecision: 50 }).verdict, "overestimated");
  assert.equal(classifyOutcome({ ...base, actualSold: 18, forecastDemand: 10, stockAtDecision: 50 }).verdict, "underestimated");
});

test("an owner's edit that landed closer to real need is credited", () => {
  const r = classifyOutcome({ ...base, kind: "modified", actualSold: 18, forecastDemand: 30, stockAtDecision: 25, recommendedQty: 28, approvedQty: 15 });
  assert.equal(r.censored, false);
  assert.equal(r.verdict, "reasonable");
});

test("needed units are measured against opening stock, not total supply", () => {
  const r = classifyOutcome({ ...base, actualSold: 12, stockAtDecision: 5, approvedQty: 10 });
  assert.equal(r.needed, 7);
  assert.equal(r.supplyCap, 15);
});

test("no stored forecast means no verdict, rather than a free 'close'", () => {
  const r = classifyOutcome({ ...base, forecastDemand: 0, actualSold: 2, stockAtDecision: 20 });
  assert.equal(r.errorPct, null);
  assert.equal(r.verdict, "indeterminate");
});

test("censored outcomes never feed forecast-bias learning", () => {
  const censored = classifyOutcome({ ...base, actualSold: 15, forecastDemand: 40, stockAtDecision: 5, approvedQty: 10 });
  assert.equal(isBiasUsable({ verdict: censored.verdict, forecastDemand: 40 }), false);
  assert.equal(isBiasUsable({ verdict: "underestimated", forecastDemand: 10 }), true);
  assert.equal(isBiasUsable({ verdict: "close", forecastDemand: 0 }), false);
});
