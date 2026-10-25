import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateDecision, simulateOne } from "../../src/lib/simulate";

const base = {
  stock: 10,
  dailyRate: 2,
  dailySd: 0.8,
  leadTimeDays: 4,
  horizonDays: 10,
  candidates: [10, 20],
  unitPrice: 100,
  sellPrice: 180,
  runs: 400,
  seed: 7,
};

// ── Weekday demand ────────────────────────────────────────────────────────
test("weekday factors shape demand: a weekend-heavy week sells more than an even one", () => {
  const flat = simulateOne({ ...base, horizonDays: 7, candidates: [20] }, 20);
  const weekend = simulateOne(
    { ...base, horizonDays: 7, candidates: [20], weekdayFactors: [2.2, 1, 1, 1, 1, 1, 2.2], endWeekday: 5 },
    20,
  );
  // mean multiplier (2.2 + 1×5 + 2.2) / 7 ≈ 1.34 → noticeably higher demand over the same week
  assert.ok(
    weekend.expectedDemand > flat.expectedDemand * 1.1,
    `weekend ${weekend.expectedDemand} vs flat ${flat.expectedDemand}`,
  );
});

test("a weekday pattern with every factor ≈ 1 behaves like the constant-rate model", () => {
  const flat = simulateOne({ ...base, candidates: [20] }, 20);
  const even = simulateOne({ ...base, candidates: [20], weekdayFactors: [1, 1, 1, 1, 1, 1, 1], endWeekday: 3 }, 20);
  assert.equal(even.expectedDemand, flat.expectedDemand);
});

test("malformed weekday factors degrade to a constant rate instead of a wrong multiplier", () => {
  const flat = simulateOne({ ...base, candidates: [20] }, 20);
  const short = simulateOne({ ...base, candidates: [20], weekdayFactors: [3, 3], endWeekday: 3 }, 20);
  const negative = simulateOne(
    { ...base, candidates: [20], weekdayFactors: [1, 1, 1, 1, 1, 1, -2], endWeekday: 3 },
    20,
  );
  const noAnchor = simulateOne({ ...base, candidates: [20], weekdayFactors: [3, 1, 1, 1, 1, 1, 1] }, 20);
  for (const s of [short, negative, noAnchor]) assert.equal(s.expectedDemand, flat.expectedDemand);
});

// ── Supplier delay variability ────────────────────────────────────────────
test("measured delivery-delay variability pushes unmet demand up when stock runs out first", () => {
  // Stock covers almost exactly the promised lead time, so any late arrival converts directly
  // into unmet demand before the order lands. Both runs use enough futures to swamp stream noise.
  const i = { ...base, dailyRate: 5, dailySd: 0.2, stock: 20, candidates: [10], horizonDays: 12, runs: 4000 };
  const onTime = simulateOne(i, 10);
  const delayed = simulateOne({ ...i, leadTimeSd: 3 }, 10);
  assert.ok(
    delayed.expectedPreDeliveryLostUnits >= onTime.expectedPreDeliveryLostUnits + 2,
    `delayed ${delayed.expectedPreDeliveryLostUnits} vs on-time ${onTime.expectedPreDeliveryLostUnits}`,
  );
  assert.ok(delayed.expectedUnitsSold <= onTime.expectedUnitsSold + 0.5);
});

test("with deep stock, delivery delay correctly changes almost nothing", () => {
  const i = { ...base, dailyRate: 2, dailySd: 0.3, stock: 60, candidates: [10], horizonDays: 8, runs: 2000 };
  const onTime = simulateOne(i, 10);
  const delayed = simulateOne({ ...i, leadTimeSd: 5 }, 10);
  assert.equal(delayed.stockoutRisk, 0);
  assert.equal(onTime.stockoutRisk, 0);
  assert.equal(delayed.expectedLostUnits, 0);
});

test("zero delay spread reproduces the on-time model exactly", () => {
  const onTime = simulateOne({ ...base, candidates: [15] }, 15);
  const spread0 = simulateOne({ ...base, candidates: [15], leadTimeSd: 0 }, 15);
  assert.deepEqual(spread0, onTime);
});

// ── Invariants that must survive the new inputs ──────────────────────────
test("simulation stays deterministic with weekday and delay inputs", () => {
  const i = {
    ...base,
    weekdayFactors: [1.4, 0.9, 0.9, 0.9, 0.9, 1.2, 1.4],
    endWeekday: 5,
    leadTimeSd: 2,
  };
  assert.deepEqual(simulateDecision(i), simulateDecision(i));
});

test("monotonicity holds with all realism inputs on: a bigger order never loses more demand", () => {
  const rows = simulateDecision({
    ...base,
    candidates: [5, 40],
    weekdayFactors: [1.5, 0.8, 0.8, 0.8, 0.8, 1.2, 1.5],
    endWeekday: 6,
    leadTimeSd: 2.5,
  });
  const small = rows.find((r) => r.quantity === 5)!;
  const big = rows.find((r) => r.quantity === 40)!;
  assert.ok(big.expectedLostUnits <= small.expectedLostUnits);
  assert.ok(big.expectedUnitsSold >= small.expectedUnitsSold);
});

test("the order is still credited exactly once under delivery variability", () => {
  // With stock far above any demand, a duplicated credit would push leftovers above the order size.
  const row = simulateOne(
    { ...base, stock: 500, candidates: [30], horizonDays: 8, leadTimeDays: 4, leadTimeSd: 4 },
    30,
  );
  assert.ok(row.expectedLeftoverUnits <= 500 + 30);
});
