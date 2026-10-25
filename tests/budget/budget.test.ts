import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateBudget, type BudgetCandidate } from "../../src/lib/budget";

const cand = (p: Partial<BudgetCandidate> & Pick<BudgetCandidate, "productId" | "name" | "quantity" | "unitPrice" | "cost">): BudgetCandidate => ({
  severity: "high",
  validationStatus: "pass",
  ...p,
});

// ── Funding order and totals ──────────────────────────────────────────────
test("funds urgent orders first and respects the cash limit", () => {
  const plan = allocateBudget(
    [
      cand({ productId: "p1", name: "Cheap watch", quantity: 10, unitPrice: 100, cost: 1000, stockoutRisk: 0.2 }),
      cand({ productId: "p2", name: "Risky kurta", quantity: 20, unitPrice: 200, cost: 4000, stockoutRisk: 0.9 }),
    ],
    5000,
  );
  assert.equal(plan.committed, 5000);
  assert.equal(plan.remaining, 0);
  assert.deepEqual(plan.funded.map((f) => f.productId), ["p2", "p1"]);
  assert.ok(plan.funded.every((f) => !f.downsizedFrom));
  assert.equal(plan.deferred.length, 0);
});

test("when cash runs out, later orders are deferred with the shortfall stated", () => {
  const plan = allocateBudget(
    [
      cand({ productId: "p1", name: "Risky kurta", quantity: 20, unitPrice: 200, cost: 4000, stockoutRisk: 0.9 }),
      cand({ productId: "p2", name: "Cheap watch", quantity: 10, unitPrice: 100, cost: 1000, stockoutRisk: 0.2 }),
      cand({ productId: "p3", name: "Late saree", quantity: 30, unitPrice: 150, cost: 4500, stockoutRisk: 0.1 }),
    ],
    6000,
  );
  assert.equal(plan.committed, 5000);
  assert.equal(plan.remaining, 1000);
  assert.deepEqual(plan.funded.map((f) => f.productId), ["p1", "p2"]);
  assert.deepEqual(plan.deferred.map((d) => d.productId), ["p3"]);
  assert.match(plan.deferred[0].reason, /₹4,500/);
  assert.match(plan.deferred[0].reason, /₹1,000/);
});

test("higher post-delivery stockout risk outranks lower risk at equal severity", () => {
  const plan = allocateBudget(
    [
      cand({ productId: "low", name: "A", quantity: 5, unitPrice: 10, cost: 50, stockoutRisk: 0.1 }),
      cand({ productId: "high", name: "B", quantity: 5, unitPrice: 10, cost: 50, stockoutRisk: 0.8 }),
    ],
    50,
  );
  assert.deepEqual(plan.funded.map((f) => f.productId), ["high"]);
  assert.deepEqual(plan.deferred.map((d) => d.productId), ["low"]);
});

test("products without simulation data rank after known risks, not before", () => {
  const plan = allocateBudget(
    [
      cand({ productId: "unknown", name: "A", quantity: 5, unitPrice: 10, cost: 50 }),
      cand({ productId: "known", name: "B", quantity: 5, unitPrice: 10, cost: 50, stockoutRisk: 0.3 }),
    ],
    50,
  );
  assert.deepEqual(plan.funded.map((f) => f.productId), ["known"]);
});

// ── Downsize to a simulated smaller quantity ─────────────────────────────
test("cash-bound order is downsized to the largest smaller simulated quantity that fits, with the trade-off stated", () => {
  const plan = allocateBudget(
    [
      cand({
        productId: "p1",
        name: "Blue shirt",
        quantity: 27,
        unitPrice: 100,
        cost: 2700,
        stockoutRisk: 0.09,
        expectedLostUnits: 0.5,
        smallerOptions: [
          { quantity: 13, cost: 1300, expectedLostUnits: 3.2, stockoutRisk: 0.31 },
          { quantity: 20, cost: 2000, expectedLostUnits: 1.4, stockoutRisk: 0.2, validationStatus: "pass" },
          { quantity: 27, cost: 2700, expectedLostUnits: 0.5, stockoutRisk: 0.09 },
        ],
      }),
      cand({ productId: "p2", name: "Cheap scarf", quantity: 5, unitPrice: 40, cost: 200, stockoutRisk: 0.4 }),
    ],
    2500,
  );
  const shirt = plan.funded.find((f) => f.productId === "p1")!;
  assert.equal(shirt.quantity, 20);
  assert.equal(shirt.cost, 2000);
  assert.equal(shirt.downsizedFrom, 27);
  assert.equal(shirt.extraLostUnits, 0.9); // 1.4 − 0.5
  assert.equal(shirt.extraStockoutRisk, 0.11); // 0.20 − 0.09
  // Cash freed by the downsize funds the next order instead of being idled.
  const scarf = plan.funded.find((f) => f.productId === "p2")!;
  assert.equal(scarf.quantity, 5);
  assert.equal(plan.committed, 2200);
  assert.equal(plan.remaining, 300);
});

test("a smaller option blocked by safety rules is never chosen as the downsize", () => {
  const plan = allocateBudget(
    [
      cand({
        productId: "p1",
        name: "Blue shirt",
        quantity: 27,
        unitPrice: 100,
        cost: 2700,
        smallerOptions: [{ quantity: 20, cost: 2000, expectedLostUnits: 1.4, stockoutRisk: 0.2, validationStatus: "block" }],
      }),
    ],
    2200,
  );
  assert.equal(plan.funded.length, 0);
  assert.deepEqual(plan.deferred.map((d) => d.productId), ["p1"]);
});

// ── Blocked orders and edges ─────────────────────────────────────────────
test("orders blocked by validation are deferred, never funded", () => {
  const plan = allocateBudget(
    [
      cand({ productId: "p1", name: "Blocked", quantity: 200, unitPrice: 10, cost: 2000, validationStatus: "block", stockoutRisk: 0.95 }),
      cand({ productId: "p2", name: "Fine", quantity: 5, unitPrice: 10, cost: 50, stockoutRisk: 0.1 }),
    ],
    10000,
  );
  assert.deepEqual(plan.funded.map((f) => f.productId), ["p2"]);
  assert.deepEqual(plan.deferred.map((d) => d.productId), ["p1"]);
  assert.match(plan.deferred[0].reason, /safety rule/i);
});

test("zero limit funds nothing and defers everything eligible", () => {
  const plan = allocateBudget([cand({ productId: "p1", name: "A", quantity: 3, unitPrice: 10, cost: 30 })], 0);
  assert.equal(plan.funded.length, 0);
  assert.equal(plan.deferred.length, 1);
  assert.equal(plan.committed, 0);
});

test("no candidates yields an empty, valid plan", () => {
  const plan = allocateBudget([], 50000);
  assert.equal(plan.funded.length, 0);
  assert.equal(plan.deferred.length, 0);
  assert.equal(plan.committed, 0);
  assert.equal(plan.remaining, 50000);
});

test("the plan is deterministic — same inputs, same plan", () => {
  const input: BudgetCandidate[] = [
    cand({ productId: "a", name: "A", quantity: 10, unitPrice: 100, cost: 1000, stockoutRisk: 0.5, expectedLostUnits: 2 }),
    cand({ productId: "b", name: "B", quantity: 10, unitPrice: 90, cost: 900, stockoutRisk: 0.5, expectedLostUnits: 2 }),
    cand({ productId: "c", name: "C", quantity: 10, unitPrice: 80, cost: 800, severity: "medium", stockoutRisk: 0.9 }),
  ];
  assert.deepEqual(allocateBudget(input, 2000), allocateBudget(input, 2000));
});

test("the plan states its method and limitations rather than hiding them", () => {
  const plan = allocateBudget([], 50000);
  assert.match(plan.method, /most-urgent first/);
  assert.ok(plan.limitations.length >= 3);
  assert.match(plan.limitations.join(" "), /not approval/);
});
