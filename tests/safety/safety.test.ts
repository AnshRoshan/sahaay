import { test } from "node:test";
import assert from "node:assert/strict";
import { runSafetyCases } from "../../src/lib/evals";

for (const c of runSafetyCases()) {
  test(`${c.id} [${c.category}] ${c.name}`, () => {
    assert.equal(c.actual, c.expected);
  });
}
