// Input guards: decide whether Sahaay may recommend at all. Pure.
import type { GuardResult, GuardVerdict, RuleSet, SupplierOffer } from "./types";

const PRIORITY: GuardVerdict[] = ["DATA_ERROR", "ABSTAIN", "FLAG_CONFLICT", "LOW_CONFIDENCE", "OK"];

export type GuardInput = {
  name: string;
  stock: number | null;
  offers: SupplierOffer[];
  historyDays: number;
  totalUnits: number;
};

export function usableOffers(offers: SupplierOffer[]): SupplierOffer[] {
  return offers.filter((o) => o.price !== null && o.leadTimeDays !== null);
}

/** Same supplier+product listed more than once with different terms. */
export function detectConflicts(offers: SupplierOffer[]): string[] {
  const groups = new Map<string, SupplierOffer[]>();
  for (const o of offers) {
    const k = `${o.supplierId}|${o.productId}`;
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  const out: string[] = [];
  for (const [k, g] of groups) {
    if (g.length < 2) continue;
    const prices = new Set(g.map((o) => o.price));
    const leads = new Set(g.map((o) => o.leadTimeDays));
    const moqs = new Set(g.map((o) => o.moq));
    if (prices.size > 1 || leads.size > 1 || moqs.size > 1) {
      out.push(
        `Supplier ${k.split("|")[0]} is listed ${g.length} times with different terms (prices: ${[...prices].join(" / ")})`,
      );
    }
  }
  return out;
}

export function assessInputs(f: GuardInput, rules: RuleSet): GuardResult {
  const flags: GuardVerdict[] = [];
  const reasons: string[] = [];
  const needs: string[] = [];

  if (f.stock === null) {
    flags.push("ABSTAIN");
    reasons.push("Current inventory is missing");
    needs.push(`Current stock for ${f.name}`);
  } else if (f.stock < 0) {
    flags.push("DATA_ERROR");
    reasons.push(`Inventory is negative (${f.stock}) — this cannot be physically true`);
    needs.push(`Corrected stock count for ${f.name}`);
  }

  if (usableOffers(f.offers).length === 0) {
    flags.push("ABSTAIN");
    if (f.offers.length === 0) {
      reasons.push("No supplier is on record for this product");
      needs.push(`Supplier, price and lead time for ${f.name}`);
    } else if (f.offers.every((o) => o.leadTimeDays === null)) {
      reasons.push("Supplier lead time is missing");
      needs.push(`Supplier lead time for ${f.name}`);
    } else {
      reasons.push("Supplier price is missing");
      needs.push(`Supplier price for ${f.name}`);
    }
  }

  const conflicts = detectConflicts(f.offers);
  if (conflicts.length) {
    flags.push("FLAG_CONFLICT");
    reasons.push(...conflicts);
    needs.push(`Confirm the correct supplier terms for ${f.name}`);
  }

  if (f.historyDays < rules.minHistoryDays || f.totalUnits < 8) {
    flags.push("LOW_CONFIDENCE");
    reasons.push(
      `Only ${f.historyDays} day(s) of sales history and ${f.totalUnits} unit(s) sold — forecasts are unreliable`,
    );
  }

  const verdict = PRIORITY.find((p) => flags.includes(p)) ?? "OK";
  return { verdict, flags, reasons, needs };
}
