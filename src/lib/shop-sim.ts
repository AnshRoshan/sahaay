// Whole-shop simulation — pure.
//
// The per-product simulator answers "if I order 20 of THIS, what happens?". The owner's real
// question once the cash plan exists is "what does this basket do to my shop?" — total unmet
// demand, total cash locked up, and how bad the bad futures look. Products are simulated as
// independent demand streams but paired by run: run r of every product together forms shop
// future r, so the totals have a real distribution instead of being sums of averages.
//
// Deliberately simpler than the per-product simulator (no weekday factors here): the shop view
// is a portfolio summary, and its inputs come from stored forecasts, not live series. The
// limitations say so rather than hiding it.
import { demandDraw, makeRng } from "./simulate";

export type ShopSimProduct = {
  productId: string;
  name: string;
  /** Funded order quantity; 0 = no order (a deferred product can be included to show its cost of inaction). */
  quantity: number;
  /** Effective stock available now (on hand + inbound). */
  stock: number;
  dailyRate: number;
  dailySd: number;
  leadTimeDays: number;
  unitPrice: number;
  sellPrice?: number | null;
};

export type ShopOutlook = {
  runs: number;
  seed: number;
  horizonDays: number;
  products: number;
  /** Total units of unmet demand across the shop, averaged over the futures. */
  expectedTotalLostUnits: number;
  /** Of which from products that got no order — the measurable cost of deferral. */
  expectedLostUnitsWithoutOrder: number;
  expectedTotalLeftoverUnits: number;
  /** Sales revenue across the basket minus cash committed by the funded orders. */
  expectedTotalCash: number;
  /** Cash committed by the funded orders (fixed, not simulated). */
  cashCommitted: number;
  /** Spread of total unmet demand across futures: half the futures were at or below p50, etc. */
  totalLostUnits: { p50: number; p90: number };
  totalCash: { p10: number; p50: number };
  method: string;
  limitations: string[];
};

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const quantile = (sorted: number[], q: number): number => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return Math.round(sorted[i] * 10) / 10;
};

/**
 * Simulate `runs` shop futures. Run r pairs every product's future r (independent demand
 * streams, shared run index), so totals across products are meaningful.
 */
export function simulateShop(products: ShopSimProduct[], opts: { runs?: number; seed?: number } = {}): ShopOutlook {
  const runs = Math.max(1, Math.round(opts.runs ?? 400));
  const seed = opts.seed ?? 20261025;
  const horizonDays = Math.max(7, ...products.map((p) => p.leadTimeDays + 1)) + 7;
  const cashCommitted = products.reduce((s, p) => s + p.quantity * p.unitPrice, 0);

  const lostPerRun: number[] = [];
  const lostNoOrderPerRun: number[] = [];
  const cashPerRun: number[] = [];
  let totalLeftover = 0;

  for (let r = 0; r < runs; r++) {
    let runLost = 0, runLostNoOrder = 0, runCash = 0, runLeftover = 0;
    for (const p of products) {
      const rand = makeRng((seed + r * 7919 + hash(p.productId)) >>> 0);
      let stock = Math.max(0, p.stock);
      let lost = 0, sold = 0;
      for (let d = 1; d <= horizonDays; d++) {
        if (d === p.leadTimeDays + 1 && p.quantity > 0) stock += p.quantity;
        const want = demandDraw(rand, p.dailyRate, p.dailySd);
        const take = Math.min(stock, want);
        stock -= take;
        sold += take;
        lost += want - take;
      }
      runLost += lost;
      if (p.quantity === 0) runLostNoOrder += lost;
      runCash += sold * (p.sellPrice ?? 0) - p.quantity * p.unitPrice;
      runLeftover += stock;
    }
    lostPerRun.push(runLost);
    lostNoOrderPerRun.push(runLostNoOrder);
    cashPerRun.push(runCash);
    totalLeftover += runLeftover;
  }

  const sortedLost = [...lostPerRun].sort((a, b) => a - b);
  const sortedCash = [...cashPerRun].sort((a, b) => a - b);
  const avg = (a: number[]) => Math.round(a.reduce((s, x) => s + x, 0) / a.length);
  const noOrder = products.filter((p) => p.quantity === 0).length;
  return {
    runs,
    seed,
    horizonDays,
    products: products.length,
    expectedTotalLostUnits: avg(lostPerRun),
    expectedLostUnitsWithoutOrder: avg(lostNoOrderPerRun),
    expectedTotalLeftoverUnits: Math.round(totalLeftover / runs),
    expectedTotalCash: avg(cashPerRun),
    cashCommitted: Math.round(cashCommitted),
    totalLostUnits: { p50: quantile(sortedLost, 0.5), p90: quantile(sortedLost, 0.9) },
    totalCash: { p10: quantile(sortedCash, 0.1), p50: quantile(sortedCash, 0.5) },
    method:
      `${runs} simulated shop futures over ${horizonDays} days, each product an independent demand stream ` +
      `(constant daily rate from its forecast, sd = forecast error), orders landing after their own lead time. ` +
      `Futures are paired across products, so the totals describe the whole basket, not sums of independent averages.`,
    limitations: [
      "A portfolio summary over the stored forecasts — weekday patterns and supplier-delay variability are not re-simulated here.",
      ...(noOrder ? [`${noOrder} product(s) carry no order in this outlook, so their unmet demand is the cost of deferral, not of the plan.`] : []),
      "Cash figures ignore the timing of sales within the window; this is not a cash-flow projection.",
    ],
  };
}
