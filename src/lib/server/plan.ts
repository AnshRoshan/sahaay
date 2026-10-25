// Whole-shop cash plan: mapping recommendations → budget candidates, and the owner-facing lines.
// Lives between the pure allocator (src/lib/budget.ts) and its consumers (briefing, batch approval).
import { allocateBudget, type BudgetCandidate, type ShopPlan } from "@/lib/budget";
import type { Action, SimulationResult, ValidationReport } from "@/lib/types";

export { allocateBudget };
export type { BudgetCandidate, ShopPlan };

/**
 * Turn a pending reorder recommendation into a budget candidate. Everything is read from the
 * stored action, simulation and validation — the same numbers the owner sees on the card —
 * so the plan cannot quote anything the recommendation does not already show.
 */
export function budgetCandidateOf(rec: {
  id?: string;
  productId: string | null;
  title: string;
  severity: string;
  abstain: boolean;
  action: unknown;
  simulation: unknown;
  validation: unknown;
}): BudgetCandidate | null {
  const a = rec.action as unknown as Action | null;
  if (rec.abstain || !rec.productId || !a || a.kind !== "order") return null;
  const quantity = a.quantity;
  const unitPrice = a.unitPrice;
  if (typeof quantity !== "number" || quantity <= 0) return null;
  const cost = typeof a.estimatedCost === "number" && Number.isFinite(a.estimatedCost)
    ? a.estimatedCost
    : typeof unitPrice === "number"
      ? quantity * unitPrice
      : null;
  if (cost === null) return null;
  const price = typeof unitPrice === "number" ? unitPrice : cost / quantity;

  const sim = rec.simulation as unknown as SimulationResult | null;
  const candidates = sim?.candidates ?? [];
  const chosen = candidates.find((c) => c.quantity === quantity) ?? null;
  return {
    productId: rec.productId,
    name: rec.title,
    supplierId: a.supplierId ?? null,
    quantity,
    unitPrice: price,
    cost,
    severity: rec.severity,
    stockoutRisk: chosen ? chosen.stockoutRisk : null,
    expectedLostUnits: chosen ? chosen.expectedLostUnits : null,
    validationStatus: chosen?.validationStatus ?? ((rec.validation as ValidationReport | null)?.status ?? null),
    smallerOptions: candidates
      .filter((c) => c.quantity < quantity)
      .map((c) => ({
        quantity: c.quantity,
        cost: c.orderCost,
        expectedLostUnits: c.expectedLostUnits,
        stockoutRisk: c.stockoutRisk,
        validationStatus: c.validationStatus,
      })),
  };
}

/** One sentence per funded order; downsizes and deferrals say what they cost the owner. */
export function planLines(plan: ShopPlan): string[] {
  const out: string[] = [];
  for (const f of plan.funded) {
    out.push(
      f.downsizedFrom
        ? `${f.name}: order ${f.quantity} instead of ${f.downsizedFrom} to fit cash (${inr(f.cost)}) — expected unmet demand rises by about ${f.extraLostUnits ?? "?"} unit(s) per the simulation`
        : `${f.name}: order ${f.quantity} (${inr(f.cost)})`,
    );
  }
  for (const d of plan.deferred) out.push(`${d.name}: deferred — ${d.reason}`);
  return out;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
