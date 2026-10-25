// Whole-shop budget allocation — pure.
//
// validateOrder guards one order against the cash limit. The owner's real constraint is the
// basket: several pending orders share one wallet, and approving them one by one can pass each
// check and still fail together. This module answers "what fits, in what order, what gets
// deferred — and what deferral costs", using the same simulation tables the owner already sees
// on each recommendation.
//
// Every figure in the output is one of its inputs (costs, risks, lost units), so anything the
// briefing quotes about the plan stays traceable to the recommendations' evidence (invariant 10).
// Greedy, not an optimiser: with ≤ ~20 pending orders the ranking matters more than the last
// rupee, and a greedy pass is explainable in one sentence. Limitations are stated, not hidden.

export type BudgetOption = {
  quantity: number;
  cost: number;
  expectedLostUnits: number;
  stockoutRisk: number;
  /** Per-candidate validation from the simulation table; a blocked option is never funded. */
  validationStatus?: "pass" | "warn" | "block" | null;
};

export type BudgetCandidate = {
  productId: string;
  name: string;
  supplierId?: string | null;
  quantity: number;
  unitPrice: number;
  cost: number;
  severity: string;
  /** Post-delivery stockout risk at `quantity`, from the product's simulation. Absent → unknown. */
  stockoutRisk?: number | null;
  /** Expected unmet demand at `quantity`, from the product's simulation. Absent → unknown. */
  expectedLostUnits?: number | null;
  /** "block" candidates are never funded; "warn" still needs the owner's explicit confirmation. */
  validationStatus: "pass" | "warn" | "block" | null;
  /** Smaller quantities the simulator already scored — the same table the owner sees. */
  smallerOptions?: BudgetOption[];
};

export type FundedOrder = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  cost: number;
  /** Set when cash forced a smaller quantity than recommended. */
  downsizedFrom?: number;
  /** Extra expected unmet demand the downsize accepts (units, from the simulation table). */
  extraLostUnits?: number;
  /** Extra post-delivery stockout risk the downsize accepts, as a fraction. */
  extraStockoutRisk?: number;
};

export type DeferredOrder = {
  productId: string;
  name: string;
  quantity: number;
  cost: number;
  reason: string;
};

export type ShopPlan = {
  cashLimit: number;
  committed: number;
  remaining: number;
  funded: FundedOrder[];
  deferred: DeferredOrder[];
  method: string;
  limitations: string[];
};

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, opportunity: 2 };
const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Urgent first: severity, then the highest post-delivery stockout risk, then the most expected
 * unmet demand, then the cheapest. Unknown risk metrics rank after known ones (they carry less
 * information, not more) and name/productId break remaining ties so the plan is deterministic.
 */
function rank(c: BudgetCandidate): number[] {
  const risk = typeof c.stockoutRisk === "number" ? c.stockoutRisk : -1;
  const lost = typeof c.expectedLostUnits === "number" ? c.expectedLostUnits : -1;
  return [SEVERITY_RANK[c.severity] ?? 9, -risk, -lost, c.cost];
}

/**
 * Fund pending orders in urgency order until the cash limit binds. When the recommended
 * quantity no longer fits, the largest smaller quantity from the product's own simulation table
 * that does fit is funded instead — the "order 20 instead of 27" trade-off, applied shop-wide,
 * with the extra expected unmet demand stated rather than discovered later.
 */
export function allocateBudget(candidates: BudgetCandidate[], cashLimit: number): ShopPlan {
  const limit = Math.max(0, Math.round(cashLimit));
  const funded: FundedOrder[] = [];
  const deferred: DeferredOrder[] = [];

  for (const c of candidates.filter((x) => x.validationStatus === "block")) {
    deferred.push({
      productId: c.productId,
      name: c.name,
      quantity: c.quantity,
      cost: c.cost,
      reason: "A safety rule blocks this order as proposed — see the recommendation before spending anything.",
    });
  }

  const eligible = candidates
    .filter((c) => c.validationStatus !== "block" && Number.isFinite(c.cost) && c.cost >= 0 && c.quantity > 0)
    .sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
      return a.name.localeCompare(b.name) || a.productId.localeCompare(b.productId);
    });

  let remaining = limit;
  for (const c of eligible) {
    if (c.cost <= remaining) {
      funded.push({
        productId: c.productId, name: c.name, quantity: c.quantity, unitPrice: c.unitPrice, cost: c.cost,
      });
      remaining -= c.cost;
      continue;
    }
    // Cash binds: try the product's own simulation for a smaller quantity that fits.
    const fits = (c.smallerOptions ?? [])
      .filter((o) => o.quantity >= 1 && o.quantity < c.quantity && o.cost <= remaining && o.validationStatus !== "block")
      .sort((a, b) => b.quantity - a.quantity)[0];
    if (fits) {
      funded.push({
        productId: c.productId, name: c.name, quantity: fits.quantity, unitPrice: c.unitPrice, cost: fits.cost,
        downsizedFrom: c.quantity,
        extraLostUnits: round2(Math.max(0, fits.expectedLostUnits - (c.expectedLostUnits ?? fits.expectedLostUnits))),
        extraStockoutRisk: round2(Math.max(0, fits.stockoutRisk - (c.stockoutRisk ?? fits.stockoutRisk))),
      });
      remaining -= fits.cost;
    } else {
      deferred.push({
        productId: c.productId, name: c.name, quantity: c.quantity, cost: c.cost,
        reason: `Needs ₹${Math.round(c.cost).toLocaleString("en-IN")}, but only ₹${Math.round(remaining).toLocaleString("en-IN")} remains after funding more urgent orders. No smaller simulated quantity fits (or none was computed).`,
      });
    }
  }

  const committed = funded.reduce((s, f) => s + f.cost, 0);
  return {
    cashLimit: limit,
    committed: Math.round(committed),
    remaining: Math.round(limit - committed),
    funded,
    deferred,
    method:
      `Orders are funded most-urgent first (severity, then post-delivery stockout risk, then expected unmet demand). ` +
      `When the cash limit binds, a recommendation is either downsized to the largest smaller quantity its own simulation table scored (trade-off stated per order) or deferred until cash frees up. ` +
      `Greedy by design: simple to explain, and with a handful of pending orders the ranking matters more than squeezing the last rupee.`,
    limitations: [
      "Ranking urgency uses the post-delivery stockout risk from each product's simulation; products without a simulation are ranked by severity and cost only.",
      "This is an allocation plan, not approval — every order still needs the owner's explicit approve/modify/reject.",
      "The plan assumes order prices are fixed and does not model partial deliveries or supplier renegotiation.",
      "A deferred product can still be approved deliberately; this plan only says what fits the configured cash limit.",
    ],
  };
}
