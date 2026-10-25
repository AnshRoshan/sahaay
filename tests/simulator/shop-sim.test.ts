import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateShop, type ShopSimProduct } from "../../src/lib/shop-sim";

const p = (over: Partial<ShopSimProduct> & Pick<ShopSimProduct, "productId" | "name">): ShopSimProduct => ({
  quantity: 20,
  stock: 5,
  dailyRate: 2,
  dailySd: 0.8,
  leadTimeDays: 4,
  unitPrice: 100,
  sellPrice: 180,
  ...over,
});

// ── Portfolio behaviour ───────────────────────────────────────────────────
test("a funded order reduces the shop's expected unmet demand versus the same products with no orders", () => {
  const prods = [p({ productId: "a", name: "A" }), p({ productId: "b", name: "B" })];
  const funded = simulateShop(prods, { seed: 11 });
  const nothing = simulateShop(prods.map((x) => ({ ...x, quantity: 0 })), { seed: 11 });
  assert.ok(funded.expectedTotalLostUnits < nothing.expectedTotalLostUnits);
  assert.ok(funded.expectedTotalCash > nothing.expectedTotalCash);
  assert.equal(funded.cashCommitted, 4000);
  assert.equal(nothing.cashCommitted, 0);
});

test("products carrying no order are reported separately as the cost of deferral", () => {
  const outlook = simulateShop([p({ productId: "a", name: "A", quantity: 20 }), p({ productId: "b", name: "B", quantity: 0 })], { seed: 3 });
  assert.ok(outlook.expectedLostUnitsWithoutOrder > 0);
  assert.ok(outlook.limitations.some((l) => l.includes("no order")));
});

test("totals describe the basket: expected lost units is the sum of the products' own expectations", () => {
  // Two products with identical demand and stock but different ids → same expected loss each.
  const one = simulateShop([p({ productId: "a", name: "A" })], { seed: 5 });
  const two = simulateShop([p({ productId: "a", name: "A" }), p({ productId: "b", name: "B" })], { seed: 5 });
  assert.equal(two.expectedTotalLostUnits, one.expectedTotalLostUnits * 2);
  assert.equal(two.expectedTotalLeftoverUnits, one.expectedTotalLeftoverUnits * 2);
});

// ── Distribution and robustness ───────────────────────────────────────────
test("quantiles are ordered and the bad tail is at least the median", () => {
  const outlook = simulateShop([p({ productId: "a", name: "A", dailySd: 1.5 })], { seed: 9 });
  assert.ok(outlook.totalLostUnits.p90 >= outlook.totalLostUnits.p50);
  assert.ok(outlook.totalCash.p10 <= outlook.totalCash.p50);
});

test("the outlook is deterministic for the same seed", () => {
  const prods = [p({ productId: "a", name: "A" }), p({ productId: "b", name: "B", quantity: 0 })];
  assert.deepEqual(simulateShop(prods, { seed: 42 }), simulateShop(prods, { seed: 42 }));
});

test("no products yields an empty but valid outlook", () => {
  const outlook = simulateShop([], { seed: 1 });
  assert.equal(outlook.expectedTotalLostUnits, 0);
  assert.equal(outlook.cashCommitted, 0);
  assert.equal(outlook.totalLostUnits.p50, 0);
});
