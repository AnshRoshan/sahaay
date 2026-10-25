// Deterministic inventory risk engine. Pure.
import type { RuleSet, RiskLevel } from "./types";

/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export type RiskInput = {
  stock: number; // effective stock (on hand + inbound)
  dailyRate: number;
  dailySd: number;
  leadTimeDays: number;
};

export type RiskOutput = {
  probability: number;
  level: RiskLevel;
  daysOfCover: number | null;
  demandDuringLead: number;
  shortfall: number;
};

/**
 * Band cut points, owner-tunable via business rules. Defaults match the long-standing values
 * (25 / 60 / 90). They are clamped to 0–100 and sorted defensively, so a misconfigured rule can
 * only move where the boundaries sit, never produce an inconsistent banding.
 */
export function bandsOf(rules?: Pick<RuleSet, "riskWatchPct" | "riskHighPct" | "riskCriticalPct">): [number, number, number] {
  const w = rules?.riskWatchPct ?? 25;
  const h = rules?.riskHighPct ?? 60;
  const c = rules?.riskCriticalPct ?? 90;
  return [w, h, c].map((x) => Math.min(100, Math.max(0, x)) / 100).sort((a, b) => a - b) as [number, number, number];
}

export function levelFor(p: number, stock: number, rules?: Pick<RuleSet, "riskWatchPct" | "riskHighPct" | "riskCriticalPct">): RiskLevel {
  const [watch, high, critical] = bandsOf(rules);
  if (stock <= 0 || p >= critical) return "CRITICAL";
  if (p >= high) return "HIGH";
  if (p >= watch) return "WATCH";
  return "SAFE";
}

/** P(demand during supplier lead time > available stock). */
export function stockoutRisk(i: RiskInput, rules?: Pick<RuleSet, "riskWatchPct" | "riskHighPct" | "riskCriticalPct">): RiskOutput {
  const mu = i.dailyRate * i.leadTimeDays;
  const sd = Math.max(i.dailySd * Math.sqrt(i.leadTimeDays), 0.5);
  let p: number;
  if (i.stock <= 0) p = mu > 0 ? 1 : 0;
  else if (mu <= 0) p = 0;
  else p = 1 - normalCdf((i.stock - mu) / sd);
  p = Math.round(Math.min(1, Math.max(0, p)) * 100) / 100;
  return {
    probability: p,
    level: levelFor(p, i.stock, rules),
    daysOfCover: i.dailyRate > 0 ? Math.round((i.stock / i.dailyRate) * 10) / 10 : null,
    demandDuringLead: Math.round(mu * 10) / 10,
    shortfall: Math.max(0, Math.ceil(mu - i.stock)),
  };
}

export type OrderQtyInput = {
  dailyRate: number;
  leadTimeDays: number;
  reviewPeriodDays: number;
  safetyBufferPct: number;
  stock: number;
  moq: number | null;
};

export type OrderQty = {
  quantity: number;
  coverDays: number;
  demand: number;
  buffer: number;
  raw: number;
  moqBinding: boolean;
};

/** need = demand over (lead + review) + safety buffer − stock; MOQ is a floor. */
export function computeOrderQuantity(i: OrderQtyInput): OrderQty {
  const coverDays = i.leadTimeDays + i.reviewPeriodDays;
  const demand = Math.round(i.dailyRate * coverDays * 10) / 10;
  const buffer = Math.ceil((demand * i.safetyBufferPct) / 100);
  const raw = Math.max(0, Math.ceil(demand + buffer - Math.max(0, i.stock)));
  const moq = i.moq ?? 1;
  const quantity = raw === 0 ? 0 : Math.max(raw, moq);
  return { quantity, coverDays, demand, buffer, raw, moqBinding: raw > 0 && raw < moq };
}
