/**
 * Outcome classification (pure).
 *
 * Recorded sales are *censored* demand: you cannot sell more than you had on hand. Treating
 * sales as demand makes a stockout look like a correct call, so any window where supply was
 * fully consumed is reported as indeterminate rather than as a verdict.
 */

export type OutcomeVerdict =
  | "close"
  | "overestimated"
  | "underestimated"
  | "avoided_risk"
  | "reasonable"
  | "indeterminate";

export type OutcomeInput = {
  kind: "approved" | "modified" | "rejected";
  actualSold: number;
  forecastDemand: number;
  stockAtDecision: number;
  recommendedQty: number;
  approvedQty: number | null;
  windowDays: number;
};

export type OutcomeClassification = {
  verdict: OutcomeVerdict;
  censored: boolean;
  supplyCap: number;
  needed: number;
  errorPct: number | null;
  parts: string[];
};

const units = (n: number) => `${n} unit${n === 1 ? "" : "s"}`;

export function classifyOutcome(input: OutcomeInput, closeBandPct = 0.2): OutcomeClassification {
  const stock = Math.max(0, input.stockAtDecision);
  const rec = input.recommendedQty;
  const ordered = input.kind === "rejected" ? 0 : (input.approvedQty ?? rec);
  const sold = Math.max(0, input.actualSold);
  const supplyCap = stock + Math.max(0, ordered);
  const censored = sold >= supplyCap;
  const needed = Math.max(0, sold - stock);
  const errorPct = input.forecastDemand > 0 ? Math.round(((sold - input.forecastDemand) / input.forecastDemand) * 100) : null;
  const parts: string[] = [
    `Recorded sales over ${input.windowDays} days: ${units(sold)} (forecast ${input.forecastDemand}${errorPct === null ? "" : `, ${errorPct >= 0 ? "+" : ""}${errorPct}%`}).`,
  ];

  if (censored) {
    parts.push(
      `All ${units(supplyCap)} that were available got sold, so real demand was at least that high and sales alone cannot tell us how much higher. ` +
        `Verdict withheld: measuring demand from censored sales would score this window on incomplete evidence.`,
    );
    return { verdict: "indeterminate", censored, supplyCap, needed, errorPct, parts };
  }

  if (input.kind === "rejected") {
    parts.push(
      `You declined the order. On-hand stock was ${stock} and demand was fully served from it, leaving ${units(stock - sold)} unsold — rejecting looks reasonable here.`,
    );
    return { verdict: "avoided_risk", censored, supplyCap, needed, errorPct, parts };
  }

  if (errorPct === null) {
    parts.push("No daily demand rate was stored with this decision, so there is no forecast to compare the window against. Verdict withheld.");
    return { verdict: "indeterminate", censored, supplyCap, needed, errorPct, parts };
  }

  const err = errorPct / 100;
  let verdict: OutcomeVerdict = Math.abs(err) <= closeBandPct ? "close" : err < 0 ? "overestimated" : "underestimated";

  if (input.kind === "modified" && input.approvedQty !== null && input.approvedQty !== rec) {
    const closerYou = Math.abs(ordered - needed) <= Math.abs(rec - needed);
    parts.push(
      `You changed the order from ${rec} to ${input.approvedQty}. The net units actually needed in this window were about ${needed}. ` +
        (closerYou ? "Your adjustment was closer to what was needed." : "My original suggestion was closer to what was needed."),
    );
    if (closerYou && verdict !== "close") verdict = "reasonable";
  } else {
    parts.push(`You ordered ${ordered}; about ${needed} net unit(s) were needed in the window.`);
  }

  if (verdict === "close") parts.push("✓ The demand estimate was close.");
  else if (verdict === "overestimated") parts.push("⚠ The forecast overestimated demand.");
  else if (verdict === "underestimated") parts.push("⚠ The forecast underestimated demand.");

  return { verdict, censored, supplyCap, needed, errorPct, parts };
}

/** Outcomes usable for learning forecast bias — censored windows would bias it downward. */
export function isBiasUsable(o: { verdict: string; forecastDemand: number }): boolean {
  return o.forecastDemand > 0 && o.verdict !== "indeterminate";
}
