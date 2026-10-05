import { test } from "node:test";
import assert from "node:assert/strict";
import { detectConflicts, deltaOf, reduceEvents, stateFromQuantity, summarise, validateClaim, type LedgerEvent } from "../../src/lib/ledger";
import { detectIntent, matchProduct, parseCapture } from "../../src/lib/capture";
import { makeRng, pickCandidate, simulateDecision } from "../../src/lib/simulate";

const ev = (p: Partial<LedgerEvent> & Pick<LedgerEvent, "id" | "productId" | "kind" | "qty" | "at">): LedgerEvent => ({
  source: "csv",
  ...p,
});

// ── Ledger: business truth is a fold over immutable events ────────────────
test("quantity is derived from events, never written directly", () => {
  const state = reduceEvents([
    ev({ id: "1", productId: "p1", kind: "receipt", qty: 30, at: "2025-06-01", note: "Supplier A" }),
    ev({ id: "2", productId: "p1", kind: "sale", qty: 7, at: "2025-06-02" }),
    ev({ id: "3", productId: "p1", kind: "adjustment", qty: -2, at: "2025-06-03", note: "damaged" }),
    ev({ id: "4", productId: "p1", kind: "receipt", qty: 12, at: "2025-06-04", note: "Supplier B" }),
  ]).get("p1")!;
  assert.equal(state.quantity, 33); // 30 - 7 - 2 + 12
  assert.equal(state.eventCount, 4);
  assert.equal(state.trail.length, 4);
  // The trail explains *why* the number is 33.
  assert.deepEqual(state.trail.map((t) => t.balance), [30, 23, 21, 33]);
});

test("a stock_count sets an absolute baseline and later movements apply after it", () => {
  const state = reduceEvents([
    ev({ id: "1", productId: "p1", kind: "sale", qty: 5, at: "2025-06-01" }),
    ev({ id: "2", productId: "p1", kind: "stock_count", qty: 18, at: "2025-06-05" }),
    ev({ id: "3", productId: "p1", kind: "sale", qty: 3, at: "2025-06-06" }),
  ]).get("p1")!;
  assert.equal(state.quantity, 15);
  assert.equal(state.baselineQty, 18);
  assert.equal(state.baselineDate, "2025-06-05");
});

test("corrections are additional events, so history is preserved", () => {
  const events = [ev({ id: "1", productId: "p1", kind: "stock_count", qty: 18, at: "2025-06-01" })];
  const before = reduceEvents(events).get("p1")!.quantity;
  const corrected = [...events, ev({ id: "2", productId: "p1", kind: "adjustment", qty: 2, at: "2025-06-02", note: "miscount corrected" })];
  assert.equal(reduceEvents(corrected).get("p1")!.quantity, 20);
  // The original event is untouched — the wrong count is still in the trail.
  assert.equal(before, 18);
  assert.equal(reduceEvents(corrected).get("p1")!.trail.length, 2);
});

test("folding is order-independent and deterministic", () => {
  const a = [ev({ id: "1", productId: "p1", kind: "receipt", qty: 10, at: "2025-06-01" }), ev({ id: "2", productId: "p1", kind: "sale", qty: 4, at: "2025-06-02" })];
  const b = [a[1], a[0]];
  assert.equal(reduceEvents(a).get("p1")!.quantity, reduceEvents(b).get("p1")!.quantity);
  assert.equal(reduceEvents(a).get("p1")!.quantity, 6);
});

test("sale events reduce stock regardless of the sign stored", () => {
  assert.equal(deltaOf(ev({ id: "1", productId: "p", kind: "sale", qty: 4, at: "2025-06-01" })), -4);
  assert.equal(deltaOf(ev({ id: "2", productId: "p", kind: "sale", qty: -4, at: "2025-06-01" })), -4);
  assert.equal(deltaOf(ev({ id: "3", productId: "p", kind: "receipt", qty: 9, at: "2025-06-01" })), 9);
  assert.equal(deltaOf(ev({ id: "4", productId: "p", kind: "stock_count", qty: 30, at: "2025-06-01" })), 0);
});

test("disagreeing sources are flagged as conflicts, never silently merged", () => {
  const c = detectConflicts([
    ev({ id: "1", productId: "p1", kind: "receipt", qty: 30, at: "2025-06-01", source: "message", note: "typed" }),
    ev({ id: "2", productId: "p1", kind: "receipt", qty: 25, at: "2025-06-01", source: "voice", note: "spoken" }),
  ]);
  assert.equal(c.length, 1);
  assert.equal(c[0].productId, "p1");
  assert.deepEqual(c[0].eventIds, ["1", "2"]);
  // Both survive: the total reflects both, and the conflict is reported.
  assert.equal(summarise([
    ev({ id: "1", productId: "p1", kind: "receipt", qty: 30, at: "2025-06-01" }),
    ev({ id: "2", productId: "p1", kind: "receipt", qty: 25, at: "2025-06-01" }),
  ]).conflicts.length, 1);
});

test("summary surfaces impossible negative stock", () => {
  const s = summarise([ev({ id: "1", productId: "p1", kind: "adjustment", qty: -5, at: "2025-06-01" })]);
  assert.equal(s.negative.length, 1);
  assert.equal(s.negative[0].quantity, -5);
});

// ── Claims are labelled, not assumed ──────────────────────────────────────
const st = (q: number) => stateFromQuantity("p1", q);

test("a fully specified movement is CONFIRMED and writable", () => {
  const d = validateClaim({ productId: "p1", kind: "receipt", qty: 20, at: "2025-06-01", source: "message" }, st(5));
  assert.equal(d.readyToWrite, true);
  assert.ok(d.claims.every((c) => c.status === "CONFIRMED"));
});

test("a claim with no quantity is MISSING and blocks writing", () => {
  const d = validateClaim({ productId: "p1", kind: "receipt", qty: 0, at: "2025-06-01", source: "message" }, st(5));
  assert.equal(d.readyToWrite, false);
  assert.ok(d.claims.some((c) => c.status === "MISSING" && c.field === "quantity"));
  assert.ok(d.needsInfo.length > 0);
});

test("a movement driving stock negative is CONFLICTING, not accepted", () => {
  const d = validateClaim({ productId: "p1", kind: "sale", qty: 40, at: "2025-06-01", source: "message" }, st(5));
  assert.equal(d.readyToWrite, false);
  assert.ok(d.claims.some((c) => c.status === "CONFLICTING" && c.field === "resulting_stock"));
});

// ── Capture: speak or type the shop's reality ─────────────────────────────
const products = [
  { id: "blue-shirt-m", name: "Blue Shirt M" },
  { id: "basmati-5kg", name: "Basmati 5kg" },
];
const stock = { "blue-shirt-m": 7, "basmati-5kg": 12 };

test("a spoken delivery becomes a proposed receipt, not a written event", () => {
  const r = parseCapture("Kal subah 20 basmati carton aaya", { products, stock, today: "2025-06-10" });
  assert.equal(r.events.length, 1);
  const e = r.events[0];
  assert.equal(e.kind, "receipt");
  assert.equal(e.productId, "basmati-5kg");
  assert.equal(e.qty, 20);
  assert.equal(e.at, "2025-06-09"); // "kal" = yesterday
  assert.equal(e.readyToWrite, true);
});

test("a sentence with no number yields a MISSING claim instead of a guess", () => {
  const r = parseCapture("Basmati ka maal aaya", { products, stock, today: "2025-06-10" });
  const e = r.events[0];
  assert.ok(e.claims.some((c) => c.status === "MISSING" && c.field === "quantity"));
  assert.equal(e.readyToWrite, false);
});

test("an unknown product is surfaced, never invented", () => {
  const r = parseCapture("20 unicorn aaye", { products, stock, today: "2025-06-10" });
  assert.equal(r.events.length, 0);
  assert.equal(r.unresolved.length, 1);
  assert.ok(r.unresolved[0].includes("unicorn"));
});

test("a negated message records nothing", () => {
  const r = parseCapture("Blue Shirt M 5 aaye nahi", { products, stock, today: "2025-06-10" });
  assert.ok(r.events.every((e) => !e.readyToWrite));
});

test("damage and loss remove stock; they never increase it", () => {
  const r = parseCapture("2 blue shirt M damaged", { products, stock, today: "2025-06-10" });
  const e = r.events[0];
  assert.equal(e.kind, "adjustment");
  assert.equal(e.qty, -2, "damaged units must be signed negative");
  assert.ok(e.claims.some((c) => c.status === "CONFIRMED" && c.field === "direction"));
  // A stated arrival adds stock.
  const plus = parseCapture("1 basmati mila", { products, stock, today: "2025-06-10" });
  assert.ok(plus.events[0].qty > 0, "a stated arrival adds stock");
});

test("word numbers and ambiguity are labelled honestly", () => {
  assert.equal(detectIntent("20 basmati aaya"), "receipt");
  assert.equal(detectIntent("5 blue shirt bik gaye"), "sale");
  assert.equal(detectIntent("2 basmati damaged"), "adjustment");
  const r = parseCapture("teen basmati aaya", { products, stock, today: "2025-06-10" });
  assert.equal(r.events[0].qty, 13);
  assert.equal(matchProduct("basmati", products).id, "basmati-5kg");
  assert.equal(matchProduct("nothing here", products).match, "none");
});

// ── Simulation: compare decisions, not just one number ────────────────────
const base = { stock: 6, dailyRate: 2, dailySd: 1.2, leadTimeDays: 6, horizonDays: 21, unitPrice: 400, sellPrice: 799, reorderLevel: 5, runs: 300, seed: 11 };

test("the same inputs always produce the same table (seeded, not random)", () => {
  const a = simulateDecision({ ...base, candidates: [10, 20] });
  const b = simulateDecision({ ...base, candidates: [10, 20] });
  assert.deepEqual(a, b);
});

test("simulations fall on the 0..1 probability range", () => {
  for (const row of simulateDecision({ ...base, candidates: [0, 10, 20, 40] })) {
    assert.ok(row.stockoutRisk >= 0 && row.stockoutRisk <= 1, `stockoutRisk ${row.stockoutRisk}`);
    assert.ok(row.overstockRisk >= 0 && row.overstockRisk <= 1, `overstockRisk ${row.overstockRisk}`);
  }
});

test("ordering more cannot be riskier and riskier at the same time as more stockout", () => {
  const rows = simulateDecision({ ...base, candidates: [0, 15, 30, 45] });
  for (let i = 1; i < rows.length; i++)
    assert.ok(rows[i].stockoutRisk <= rows[i - 1].stockoutRisk + 0.02, `stockout risk should fall as quantity rises: ${rows[i - 1].stockoutRisk} → ${rows[i].stockoutRisk}`);
});

test("an event dated after the data is flagged, not silently trusted", () => {
  // A snapshot dated in the future would outrank real movements and hide them.
  const events = [
    ev({ id: "1", productId: "p1", kind: "receipt", qty: 30, at: "2025-06-03" }),
    ev({ id: "2", productId: "p1", kind: "stock_count", qty: 7, at: "2025-06-05" }),
  ];
  const summary = summarise(events, "2025-06-04");
  assert.equal(summary.futureDated.length, 1);
  assert.equal(summary.futureDated[0].lastEventAt, "2025-06-05");
  assert.equal(reduceEvents(events, "2025-06-04").get("p1")!.futureDated, true);
  // In-range events are not flagged.
  assert.equal(summarise(events, "2025-06-06").futureDated.length, 0);
});

test("the order is credited once, on the day it arrives", () => {
  // A bug that credited the order on every day after the lead time inflated leftover stock.
  const rows = simulateDecision({ ...base, dailyRate: 0, dailySd: 0, candidates: [20] });
  assert.equal(rows[0].expectedLeftoverUnits, 26); // 6 in stock + 20, with no demand to draw it down
});

test("pre-delivery shortage is visible and barely moves with order size", () => {
  // Only 6 units against 6 days of lead time at 2/day: those units are lost whatever you order
  // today, so a big order must not appear to fix it.
  const rows = simulateDecision({ ...base, candidates: [5, 50] });
  assert.ok(rows[0].expectedPreDeliveryLostUnits > 0, "shortage during the lead time must be visible");
  assert.ok(rows[1].expectedPreDeliveryLostUnits > 0);
  assert.ok(
    Math.abs(rows[1].expectedPreDeliveryLostUnits - rows[0].expectedPreDeliveryLostUnits) < 1,
    `pre-delivery loss should be near-constant across quantities: ${rows[0].expectedPreDeliveryLostUnits} vs ${rows[1].expectedPreDeliveryLostUnits}`,
  );
  // Ordering a lot reduces *total* unmet demand, but only by the part after the delivery.
  assert.ok(rows[1].expectedLostUnits < rows[0].expectedLostUnits);
});

test("stockout risk is not saturated: the column must discriminate between quantities", () => {
  const rows = simulateDecision({ ...base, candidates: [11, 24, 32] });
  assert.ok(rows[0].stockoutRisk > rows[1].stockoutRisk, `a smaller order should carry more post-delivery risk: ${rows[0].stockoutRisk} vs ${rows[1].stockoutRisk}`);
  assert.ok(rows.some((r) => r.stockoutRisk < 0.5), "at least one quantity should be able to reach a safe risk level");
});

test("more units means more cash committed", () => {
  const rows = simulateDecision({ ...base, candidates: [10, 40] });
  assert.equal(rows[0].orderCost, 10 * base.unitPrice);
  assert.equal(rows[1].orderCost, 40 * base.unitPrice);
  assert.ok(rows[1].orderCost > rows[0].orderCost);
});

test("net cash is a trade-off, not a monotonic function of quantity", () => {
  // Revenue rises with the extra units sold, so net cash can peak in the middle. The table
  // exists precisely because "more is always better" is false — assert we do not pretend otherwise.
  const rows = simulateDecision({ ...base, candidates: [5, 24, 40] });
  assert.ok(rows[1].expectedCash > rows[0].expectedCash, "more units sell more, so cash can improve");
  assert.ok(rows[2].expectedCash < rows[1].expectedCash, "but past the sweet spot, cash falls again");
  assert.ok(rows[1].expectedCash !== rows[2].expectedCash);
});

test("risk falls and leftover rises with quantity — the trade-off is visible", () => {
  const rows = simulateDecision({ ...base, candidates: [5, 45] });
  assert.ok(rows[1].expectedLeftoverUnits > rows[0].expectedLeftoverUnits);
  assert.ok(rows[1].stockoutRisk <= rows[0].stockoutRisk);
});

test("pickCandidate chooses the least unmet demand", () => {
  const rows = simulateDecision({ ...base, candidates: [5, 25, 45] });
  const best = pickCandidate(rows)!;
  const minLost = Math.min(...rows.map((r) => r.expectedLostUnits));
  assert.equal(best.expectedLostUnits, minLost);
});

test("zero demand means no stockout regardless of quantity", () => {
  const rows = simulateDecision({ ...base, dailyRate: 0, dailySd: 0, candidates: [0, 20] });
  assert.equal(rows[0].stockoutRisk, 0);
  assert.equal(rows[1].stockoutRisk, 0);
});

test("the RNG is reproducible and in range", () => {
  const a = Array.from({ length: 50 }, makeRng(5));
  const b = Array.from({ length: 50 }, makeRng(5));
  assert.deepEqual(a, b);
  assert.ok(a.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(a, Array.from({ length: 50 }, makeRng(6)));
});