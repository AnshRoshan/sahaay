// Deterministic inventory risk engine. Pure.
import type { RiskLevel } from "./types";

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

export function levelFor(p: number, stock: number): RiskLevel {
  if (stock <= 0 || p >= 0.9) return "CRITICAL";
  if (p >= 0.6) return "HIGH";
  if (p >= 0.25) return "WATCH";
  return "SAFE";
}

/** P(demand during supplier lead time > available stock). */
export function stockoutRisk(i: RiskInput): RiskOutput {
  const mu = i.dailyRate * i.leadTimeDays;
  const sd = Math.max(i.dailySd * Math.sqrt(i.leadTimeDays), 0.5);
  let p: number;
  if (i.stock <= 0) p = mu > 0 ? 1 : 0;
  else if (mu <= 0) p = 0;
  else p = 1 - normalCdf((i.stock - mu) / sd);
  p = Math.round(Math.min(1, Math.max(0, p)) * 100) / 100;
  return {
    probability: p,
    level: levelFor(p, i.stock),
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
