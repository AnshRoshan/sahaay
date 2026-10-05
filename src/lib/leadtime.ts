/**
 * Lead-time learning (pure).
 *
 * Supplier lead time used to come only from a spreadsheet column — a promise. Once the owner
 * records that goods actually arrived, the order→delivery gap is a *measurement*. This module turns
 * those pairs into a defensible number and, importantly, decides when there are too few to trust.
 */

export type LeadTimePair = {
  supplierId: string;
  productId: string;
  orderedAt: string;
  receivedAt: string;
  /** What the supplier's sheet claimed at the time, if anything. */
  promisedDays: number | null;
};

export type SupplierLeadTime = {
  supplierId: string;
  n: number;
  medianDays: number;
  /** Median absolute deviation — robust spread, because 3 deliveries cannot support a variance. */
  madDays: number;
  minDays: number;
  maxDays: number;
  /**
   * `insufficient` n < 3: an anecdote, not a distribution — do not override the promise.
   * `provisional` 3–9: usable, but keep it labelled as derived and show n.
   * `measured`   ≥ 10: the observed figure replaces the promised one.
   */
  confidence: "insufficient" | "provisional" | "measured";
  /** Only when observed is slower than promised — the case that actually causes stockouts. */
  overrunDays: number | null;
};

export const MIN_PAIRS_TO_OVERRIDE = 3;
export const PAIRS_TO_TRUST = 10;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function dayGap(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Group confirmed order→delivery pairs per supplier. A pair dated the wrong way round (delivery
 * before the order) is dropped rather than clamped: it means the dates are wrong, and inventing a
 * lead time from that would put a made-up number into the reorder arithmetic.
 */
export function learnLeadTimes(pairs: LeadTimePair[]): Map<string, SupplierLeadTime> {
  const bySupplier = new Map<string, number[]>();
  const promises = new Map<string, number[]>();
  for (const p of pairs) {
    const days = dayGap(p.orderedAt, p.receivedAt);
    if (days === null) continue;
    bySupplier.set(p.supplierId, [...(bySupplier.get(p.supplierId) ?? []), days]);
    if (p.promisedDays !== null) promises.set(p.supplierId, [...(promises.get(p.supplierId) ?? []), p.promisedDays]);
  }

  const out = new Map<string, SupplierLeadTime>();
  for (const [supplierId, days] of bySupplier) {
    const medianDays = median(days);
    const mad = median(days.map((d) => Math.abs(d - medianDays)));
    const promised = promises.get(supplierId);
    const promisedMedian = promised && promised.length ? median(promised) : null;
    out.set(supplierId, {
      supplierId,
      n: days.length,
      medianDays,
      madDays: mad,
      minDays: Math.min(...days),
      maxDays: Math.max(...days),
      confidence: days.length >= PAIRS_TO_TRUST ? "measured" : days.length >= MIN_PAIRS_TO_OVERRIDE ? "provisional" : "insufficient",
      overrunDays: promisedMedian === null ? null : Math.max(0, medianDays - promisedMedian),
    });
  }
  return out;
}

/**
 * The lead time the engine should plan against. An observed figure only replaces the promised one
 * once there are enough deliveries to make it a distribution rather than an anecdote, and it never
 * replaces it with something *faster* unless measured: guessing optimistic here is how stockouts happen.
 */
export function effectiveLeadDays(promised: number | null, learned: SupplierLeadTime | undefined): { days: number | null; source: "promised" | "observed" | "unknown" } {
  const noObservation = () => (promised === null ? { days: null as number | null, source: "unknown" as const } : { days: promised as number | null, source: "promised" as const });
  if (!learned || learned.confidence === "insufficient") return noObservation();
  const observed = Math.ceil(learned.medianDays);
  if (promised === null || observed >= promised) return { days: observed, source: "observed" };
  // Reality has been faster than the promise. Shortening the plan buys less safety stock, so only a
  // measured sample (n >= 10) is allowed to make the plan more optimistic than the supplier's word.
  if (learned.confidence === "measured") return { days: observed, source: "observed" };
  return { days: promised, source: "promised" };
}

export function leadTimeStatement(l: SupplierLeadTime): string {
  const spread = l.minDays === l.maxDays ? `${l.minDays} day${l.minDays === 1 ? "" : "s"}` : `${l.minDays}–${l.maxDays} days`;
  if (l.confidence === "insufficient") return `Only ${l.n} recorded deliver${l.n === 1 ? "y" : "ies"} so far (${spread}) — too few to replace the supplier's stated lead time.`;
  return `Median ${l.medianDays} day(s) across ${l.n} recorded deliveries (${spread}, typical deviation ${l.madDays}). ${l.confidence === "provisional" ? "Provisional: keep watching." : "Measured — used instead of the stated lead time."}`;
}
