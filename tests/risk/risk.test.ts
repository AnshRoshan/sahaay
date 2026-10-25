import { test } from "node:test";
import assert from "node:assert/strict";
import { bandsOf, levelFor, stockoutRisk } from "../../src/lib/risk";
import { DEFAULT_RULES, type RuleSet } from "../../src/lib/types";

const rules = (patch: Partial<RuleSet>): RuleSet => ({ ...DEFAULT_RULES, ...patch });

// ── Default bands are unchanged ───────────────────────────────────────────
test("default bands keep the long-standing 25 / 60 / 90 cut points", () => {
  assert.equal(levelFor(0.24, 10), "SAFE");
  assert.equal(levelFor(0.25, 10), "WATCH");
  assert.equal(levelFor(0.59, 10), "WATCH");
  assert.equal(levelFor(0.60, 10), "HIGH");
  assert.equal(levelFor(0.89, 10), "HIGH");
  assert.equal(levelFor(0.90, 10), "CRITICAL");
  assert.equal(levelFor(0.10, 0), "CRITICAL"); // no stock is critical whatever the probability
});

// ── Owner-tunable bands ───────────────────────────────────────────────────
test("custom bands move the cut points and flow through stockoutRisk", () => {
  const r = rules({ riskWatchPct: 10, riskHighPct: 40, riskCriticalPct: 80 });
  assert.equal(levelFor(0.09, 10, r), "SAFE");
  assert.equal(levelFor(0.10, 10, r), "WATCH");
  assert.equal(levelFor(0.40, 10, r), "HIGH");
  assert.equal(levelFor(0.80, 10, r), "CRITICAL");
  const risk = stockoutRisk({ stock: 5, dailyRate: 2, dailySd: 1, leadTimeDays: 7 }, r);
  assert.equal(risk.level, levelFor(risk.probability, 5, r));
});

test("stricter bands escalate the same product to a worse band", () => {
  const loose = rules({ riskWatchPct: 40, riskHighPct: 70, riskCriticalPct: 95 });
  const strict = rules({ riskWatchPct: 5, riskHighPct: 20, riskCriticalPct: 50 });
  const p = 0.55;
  assert.ok(["SAFE", "WATCH"].includes(levelFor(p, 10, loose)));
  assert.equal(levelFor(p, 10, strict), "CRITICAL");
});

// ── Misconfiguration cannot corrupt the banding ──────────────────────────
test("out-of-order or out-of-range bands are sorted and clamped, never inconsistent", () => {
  assert.deepEqual(bandsOf(rules({ riskWatchPct: 95, riskHighPct: 50, riskCriticalPct: 10 })), [0.1, 0.5, 0.95]);
  assert.deepEqual(bandsOf(rules({ riskWatchPct: -20, riskHighPct: 400, riskCriticalPct: 60 })), [0, 0.6, 1]);
  // With the inverted numbers, every probability lands in exactly one band, in order.
  const r = rules({ riskWatchPct: 95, riskHighPct: 50, riskCriticalPct: 10 });
  const seq = [0.05, 0.3, 0.7, 0.97].map((p) => levelFor(p, 10, r));
  assert.deepEqual(seq, ["SAFE", "WATCH", "HIGH", "CRITICAL"]);
});
