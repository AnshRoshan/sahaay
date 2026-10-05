import test from "node:test";
import assert from "node:assert/strict";
import { effectiveLeadDays, learnLeadTimes, leadTimeStatement, type LeadTimePair } from "@/lib/leadtime";

const pair = (over: Partial<LeadTimePair> & Pick<LeadTimePair, "supplierId" | "orderedAt" | "receivedAt">): LeadTimePair => ({
  productId: "p",
  promisedDays: null,
  ...over,
});

test("one delivery is an anecdote, not a lead time", () => {
  const l = learnLeadTimes([pair({ supplierId: "s1", orderedAt: "2025-06-01", receivedAt: "2025-06-04" })]);
  assert.equal(l.get("s1")!.confidence, "insufficient");
  assert.equal(effectiveLeadDays(7, l.get("s1")).source, "promised");
});

test("three deliveries make a provisional median", () => {
  const l = learnLeadTimes([
    pair({ supplierId: "s1", orderedAt: "2025-06-01", receivedAt: "2025-06-05" }),
    pair({ supplierId: "s1", orderedAt: "2025-06-10", receivedAt: "2025-06-13" }),
    pair({ supplierId: "s1", orderedAt: "2025-06-20", receivedAt: "2025-06-28" }),
  ]);
  const s = l.get("s1")!;
  assert.equal(s.n, 3);
  assert.equal(s.medianDays, 4);
  assert.equal(s.minDays, 3);
  assert.equal(s.maxDays, 8);
  assert.equal(s.confidence, "provisional");
});

test("ten or more deliveries replace the supplier's promise", () => {
  const many = Array.from({ length: 10 }, (_, i) => pair({ supplierId: "s2", orderedAt: `2025-0${(i % 6) + 1}-0${(i % 8) + 1}`, receivedAt: `2025-0${(i % 6) + 1}-1${(i % 8) + 1}` }));
  const l = learnLeadTimes(many);
  assert.equal(l.get("s2")!.confidence, "measured");
  assert.equal(effectiveLeadDays(2, l.get("s2")).source, "observed");
});

test("an observed lead time never makes the plan more optimistic than the promise", () => {
  const fast = [4, 4, 4].map((d) => pair({ supplierId: "s3", orderedAt: "2025-06-01", receivedAt: `2025-06-0${1 + d}` }));
  const l = learnLeadTimes(fast);
  const e = effectiveLeadDays(9, l.get("s3"));
  assert.equal(e.days, 9, "three fast deliveries are not enough to shorten the plan");
  assert.equal(e.source, "promised");
  assert.equal(effectiveLeadDays(null, l.get("s3")).days, 4);
});

test("a delivery dated before the order is dropped, not clamped to zero", () => {
  const l = learnLeadTimes([pair({ supplierId: "s4", orderedAt: "2025-06-10", receivedAt: "2025-06-02" })]);
  assert.equal(l.has("s4"), false);
  assert.equal(effectiveLeadDays(6, l.get("s4")).source, "promised");
});

test("lead-time overrun is only reported when reality was slower", () => {
  const slow = learnLeadTimes([10, 11, 12].map((d) => pair({ supplierId: "s5", orderedAt: "2025-06-01", receivedAt: `2025-06-${d}`, promisedDays: 2 })));
  assert.equal(slow.get("s5")!.medianDays, 10);
  assert.equal(slow.get("s5")!.overrunDays, 8, "promised 2, took 10");
  const quick = learnLeadTimes([9, 10, 11].map((d) => pair({ supplierId: "s6", orderedAt: "2025-06-01", receivedAt: `2025-06-${d}`, promisedDays: 20 })));
  assert.equal(quick.get("s6")!.overrunDays, 0, "faster than promised is not an overrun");
});

test("unknown promised lead time still yields a plan once deliveries are recorded", () => {
  const l = learnLeadTimes([3, 4, 5].map((d) => pair({ supplierId: "s7", orderedAt: "2025-06-01", receivedAt: `2025-06-0${d}` })));
  const e = effectiveLeadDays(null, l.get("s7"));
  assert.equal(e.source, "observed");
  assert.equal(e.days, 3);
  assert.equal(effectiveLeadDays(null, undefined).source, "unknown");
});

test("the statement always reports n, because a small sample must not read as a fact", () => {
  const l = learnLeadTimes([pair({ supplierId: "s8", orderedAt: "2025-06-01", receivedAt: "2025-06-03" })]);
  assert.match(leadTimeStatement(l.get("s8")!), /Only 1 recorded delivery/);
});

// ── How the plan uses it (analysis integration) ───────────────────────────
import { consolidateOffers, pickPrimary } from "@/lib/analysis";
import type { SupplierOffer } from "@/lib/types";

const offer = (supplierId: string, leadTimeDays: number): SupplierOffer => ({ supplierId, productId: "p", price: 400, moq: 10, leadTimeDays });

test("measured deliveries change the lead time the whole plan is built on", () => {
  const learned = learnLeadTimes([9, 10, 11].map((d) => pair({ supplierId: "slow", orderedAt: "2025-06-01", receivedAt: `2025-06-${d + 1}`, promisedDays: 2 })));
  const [c] = consolidateOffers([offer("slow", 2)], learned);
  assert.equal(c.leadTimeDays, 10, "median of 9/10/11 from 2025-06-01");
  assert.equal(c.leadTimeSource, "observed");
  assert.equal(c.promisedLeadDays, 2, "the promise is kept so the evidence can show both numbers");
});

test("no recorded deliveries means the promise is used and labelled as a promise", () => {
  const [c] = consolidateOffers([offer("new", 5)], new Map());
  assert.equal(c.leadTimeDays, 5);
  assert.equal(c.leadTimeSource, "promised");
});

test("a supplier that only promises to be fast loses to one that really delivers sooner", () => {
  const learned = learnLeadTimes([9, 10, 11].map((d) => pair({ supplierId: "b", orderedAt: "2025-06-01", receivedAt: `2025-06-${d + 1}`, promisedDays: 1 })));
  const cons = consolidateOffers([offer("a", 4), offer("b", 1)], learned);
  assert.equal(pickPrimary(cons, [])!.supplierId, "a", "b promised 1 day but measurably takes 10; the promise must not win the sort");
});
