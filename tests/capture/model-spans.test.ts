import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCapture } from "../../src/lib/capture";

const products = [
  { id: "blue-shirt-m", name: "Blue Shirt M" },
  { id: "white-shirt-m", name: "White Shirt M" },
];
const opts = { products, stock: {}, today: "2026-10-25" };

// ── Rules baseline is unchanged ───────────────────────────────────────────
test("without hints the parse is identical to the rules-only path and labelled rules", () => {
  const text = "kal 30 blue shirt aaya aur 3 shirt bik gaye";
  const base = parseCapture(text, opts);
  assert.equal(base.parseSource, "rules");
  const hinted = parseCapture(text, opts, { clauses: undefined, productHints: undefined });
  assert.deepEqual(hinted, base);
});

// ── Verbatim model spans are used, and only then ──────────────────────────
test("a verbatim model span is applied, labelled model-assisted, and visible as a claim", () => {
  const text = "bloose shirt 10 aaya"; // a typo — the catalogue matcher only bridges it via "shirt"
  const assisted = parseCapture(text, opts, { clauses: ["bloose shirt 10 aaya"], productHints: ["bloose shirt"] });
  assert.equal(assisted.parseSource, "model-assisted");
  assert.equal(assisted.events.length, 1);
  assert.equal(assisted.events[0].productId, "blue-shirt-m");
  const claim = assisted.events[0].claims.find((c) => c.field === "product_span");
  assert.ok(claim, "the model's involvement must be visible as a claim");
  assert.equal(claim!.status, "INFERRED");
  assert.match(claim!.reason, /language model/);
});

test("when a clause mentions two products, the span picks the one the owner meant", () => {
  // Both names appear, so the whole-clause matcher deterministically picks the first;
  // the verbatim span focuses the matcher on the right words.
  const text = "blue shirt wale white shirt 6 bik gaye";
  const rules = parseCapture(text, opts);
  assert.equal(rules.events[0].productId, "blue-shirt-m");
  const assisted = parseCapture(text, opts, { clauses: ["blue shirt wale white shirt 6 bik gaye"], productHints: ["white shirt"] });
  assert.equal(assisted.events[0].productId, "white-shirt-m");
});

test("model clauses segment multi-movement messages the rules splitter cannot", () => {
  // "aur" without a following number does not split under the rules.
  const text = "blue shirt 10 aaya aur white shirt bik gaye";
  const rules = parseCapture(text, opts);
  assert.equal(rules.events.length, 1); // only the first movement parsed
  const assisted = parseCapture(text, opts, {
    clauses: ["blue shirt 10 aaya", "white shirt bik gaye"],
    productHints: ["blue shirt", "white shirt"],
  });
  assert.equal(assisted.parseSource, "model-assisted");
  assert.deepEqual(assisted.events.map((e) => e.productId), ["blue-shirt-m", "white-shirt-m"]);
  // Quantities still come only from the owner's words: the second line has none → MISSING.
  const second = assisted.events[1];
  assert.ok(second.claims.some((c) => c.field === "quantity" && c.status === "MISSING"));
  assert.equal(second.readyToWrite, false);
});

// ── The gate: anything not verbatim is discarded ──────────────────────────
test("a non-verbatim clause hint is discarded entirely — no partial trust", () => {
  const text = "kal 30 blue shirt aaya";
  const base = parseCapture(text, opts);
  const hinted = parseCapture(text, opts, {
    clauses: ["kal 30 blue shirt aaya", "invented second movement"],
    productHints: ["blue shirt"],
  });
  assert.deepEqual(hinted, base);
  assert.equal(hinted.parseSource, "rules");
});

test("a non-verbatim product hint falls back to whole-clause matching, still rule-safe", () => {
  const text = "20 blue shirt aaya";
  const base = parseCapture(text, opts);
  const hinted = parseCapture(text, opts, { clauses: ["20 blue shirt aaya"], productHints: ["polka dot saree"] });
  assert.equal(hinted.parseSource, "model-assisted"); // clauses were verbatim and used
  assert.deepEqual(hinted.events.map((e) => e.productId), base.events.map((e) => e.productId));
  assert.ok(!hinted.events[0].claims.some((c) => c.field === "product_span"));
});

// ── The model cannot state a quantity ────────────────────────────────────
test("no hint, whatever it contains, can inject or change a quantity", () => {
  const text = "blue shirt aaya"; // no number anywhere
  const withHints = parseCapture(text, opts, {
    clauses: ["blue shirt aaya"],
    productHints: ["blue shirt 500"], // even a hint that looks like a quantity
  });
  assert.equal(withHints.events.length, 1);
  assert.equal(withHints.events[0].qty, 0);
  assert.ok(withHints.events[0].claims.some((c) => c.field === "quantity" && c.status === "MISSING"));
  assert.equal(withHints.events[0].readyToWrite, false);
});
