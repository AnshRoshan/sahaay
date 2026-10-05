// Decision simulator — pure.
//
// A single "stockout probability = 87%" hides the trade-off. The owner's real question is
// "if I order 10, 15 or 20, what happens?" So we simulate N business futures for each candidate
// quantity and report the risk/cash trade-off explicitly.
//
// Deterministic by construction: a seeded PRNG (mulberry32) means the same inputs always give
// the same table, so it is testable and explainable. The model is deliberately simple and its
// limitations are reported rather than hidden.

export type SimInput = {
  /** Effective stock available before a new order arrives (on hand + already inbound). */
  stock: number;
  /** Units/day expected demand. */
  dailyRate: number;
  /** Units/day standard deviation of demand (from the forecast ensemble). */
  dailySd: number;
  /** Days until a new order arrives. */
  leadTimeDays: number;
  /** Days of trading to evaluate after the decision. */
  horizonDays: number;
  /** Candidate order quantities to compare. */
  candidates: number[];
  /** Cost per unit — cash committed. */
  unitPrice: number;
  /** Selling price per unit — revenue. Optional (supplier_change recs have no order). */
  sellPrice?: number | null;
  /** Units already on order that will land during the horizon. */
  inbound?: number;
  /** Units that count as "leftover" (reorder buffer). Below this, no overstock penalty. */
  reorderLevel?: number;
  /** Monte Carlo paths per candidate. */
  runs?: number;
  /** Seed for reproducibility. */
  seed?: number;
};

/** mulberry32 — small, fast, fully deterministic. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller: daily demand is a count, so we round a normal draw down to whole units. */
function demandDraw(rand: () => number, mean: number, sd: number): number {
  if (sd <= 0.01) return Math.max(0, Math.round(mean));
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(0, Math.round(mean + z * sd));
}

export type SimRow = {
  quantity: number;
  stockoutRisk: number;
  overstockRisk: number;
  expectedDemand: number;
  expectedUnitsSold: number;
  expectedLostUnits: number;
  expectedPreDeliveryLostUnits: number;
  expectedLeftoverUnits: number;
  expectedCash: number;
  /** Cash committed by this quantity. Always quantity × unit price. */
  orderCost: number;
  expectedLostSalesValue: number;
};

/**
 * For one candidate quantity, walk `runs` simulated futures day by day.
 *
 * Stockout risk = share of futures that run out on a day *after* the new order has arrived.
 * That is the period the order quantity actually controls. Shortages during the lead time
 * happen whatever you order today, so folding them in would report ~100% risk for every
 * candidate and make the comparison useless; they are reported separately as
 * expectedPreDeliveryLostUnits.
 *
 * Overstock = the horizon ended with more units than the reorder level.
 */
export function simulateOne(i: SimInput, quantity: number): SimRow {
  const runs = Math.max(1, Math.round(i.runs ?? 400));
  const rand = makeRng((i.seed ?? 42) + quantity * 7919);
  const sell = i.sellPrice ?? null;
  const reorderLevel = i.reorderLevel ?? 0;
  let stockouts = 0, overstocks = 0;
  let totalDemand = 0, totalSold = 0, totalLost = 0, totalLeftover = 0, totalCash = 0, totalLostValue = 0;
  let totalPreDeliveryLost = 0;

  const inboundArrivesDay = Math.max(1, Math.floor(i.leadTimeDays / 2)); // already-in-flight stock lands mid-lead-time
  const orderArrivesDay = i.leadTimeDays + 1; // ordered today; only after the lead time does it count
  for (let r = 0; r < runs; r++) {
    // The new order does NOT exist until orderArrivesDay. Before that only current stock serves demand.
    let stock = Math.max(0, i.stock);
    const inbound = Math.max(0, i.inbound ?? 0);
    let inboundLeft = inbound;
    let demand = 0, sold = 0, lost = 0, outAfterArrival = false, lostBeforeArrival = 0;

    for (let d = 1; d <= i.horizonDays; d++) {
      if (inboundLeft > 0 && d >= inboundArrivesDay) {
        stock += inboundLeft;
        inboundLeft = 0;
      }
      // Credited exactly once, on the day it arrives.
      if (d === orderArrivesDay) stock += quantity;
      const want = demandDraw(rand, i.dailyRate, i.dailySd);
      demand += want;
      const take = Math.min(stock, want);
      stock -= take;
      sold += take;
      if (want > take) {
        const short = want - take;
        lost += short;
        if (d < orderArrivesDay) lostBeforeArrival += short; // caused by today's stock level
        else outAfterArrival = true; // the order size was the lever here
      }
    }

    const leftover = stock;
    const cash = sold * (sell ?? 0) - quantity * i.unitPrice;
    const lostValue = lost * (sell ?? 0);
    if (outAfterArrival) stockouts++;
    if (leftover > reorderLevel) overstocks++;
    totalDemand += demand; totalSold += sold; totalLost += lost; totalLeftover += leftover;
    totalCash += cash; totalLostValue += lostValue; totalPreDeliveryLost += lostBeforeArrival;
  }

  const n = runs;
  const round = (x: number) => Math.round(x * 100) / 100;
  return {
    quantity,
    stockoutRisk: round(stockouts / n),
    overstockRisk: round(overstocks / n),
    expectedDemand: round(totalDemand / n),
    expectedUnitsSold: round(totalSold / n),
    expectedLostUnits: round(totalLost / n),
    /** Units lost before the new order could arrive — caused by today's stock, not by quantity. */
    expectedPreDeliveryLostUnits: round(totalPreDeliveryLost / n),
    expectedLeftoverUnits: round(totalLeftover / n),
    expectedCash: Math.round(totalCash / n),
    orderCost: Math.round(quantity * i.unitPrice),
    expectedLostSalesValue: Math.round(totalLostValue / n),
  };
}

/**
 * Compare candidate order quantities over simulated futures.
 * Candidates are de-duplicated, sorted ascending, and evaluated independently but with the
 * same seed offset so the comparison is apples-to-apples.
 */
export function simulateDecision(i: SimInput): SimRow[] {
  const candidates = [...new Set(i.candidates.filter((q) => Number.isFinite(q) && q >= 0))].sort((a, b) => a - b);
  return candidates.map((q) => simulateOne(i, q));
}

/** Best candidate = fewest expected lost units, tie-broken by higher expected cash. */
export function pickCandidate(rows: SimRow[]): SimRow | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => a.expectedLostUnits - b.expectedLostUnits || b.expectedCash - a.expectedCash)[0];
}