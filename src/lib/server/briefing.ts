import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import type { BudgetCandidate, ShopPlan } from "@/lib/budget";
import { allocateBudget, budgetCandidateOf } from "./plan";
import type { Action } from "@/lib/types";
import { loadRules } from "./rules";

export type BriefingItem = { id: string; severity: string; title: string; line: string };
export type Briefing = {
  greeting: string;
  total: number;
  items: BriefingItem[];
  minutes: number;
  text: string;
  spoken: string;
  /**
   * Whole-shop cash plan across pending orders sharing the cash limit. Null when nothing is
   * waiting to be ordered. Numbers come from the recommendations' own action/simulation data.
   */
  plan: ShopPlan | null;
};

const order = { high: 0, medium: 1, opportunity: 2 } as Record<string, number>;
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export async function buildBriefing(): Promise<Briefing> {
  const [recs, rules] = await Promise.all([
    db.select().from(s.recommendations).where(eq(s.recommendations.status, "pending")),
    loadRules(),
  ]);
  recs.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || b.confidence - a.confidence);
  const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const items: BriefingItem[] = recs.slice(0, 3).map((r) => {
    const a = r.action as unknown as Action;
    let line = a.label;
    if (r.abstain) line = "I need more information before I can recommend anything";
    else if (r.type === "reorder") {
      const ev = (r.evidence as { label: string; value: { probability?: number } }[]).find((e) => e.label === "Stockout risk");
      const cost = typeof a.estimatedCost === "number" ? ` (about ${inr(a.estimatedCost)})` : "";
      line = `stockout risk ${Math.round((ev?.value?.probability ?? 0) * 100)}% — consider ordering ${a.quantity}${cost}`;
    } else if (r.type === "slow_moving") line = "demand is declining and you may be overstocked";
    else if (r.type === "supplier_change") line = `potential saving ${inr(-(a.estimatedCost ?? 0))}`;
    else if (r.type === "inventory_warning") line = "on watch — no order needed yet";
    return { id: r.id, severity: r.severity, title: r.title, line };
  });

  // Whole-shop cash check: several pending orders share one wallet, and approving them one by
  // one can pass every per-order check and still fail together. The plan uses each order's own
  // simulation table, so a downsized order states the unmet demand it accepts.
  const candidates = recs.map(budgetCandidateOf).filter((c): c is BudgetCandidate => c !== null);
  const plan = candidates.length ? allocateBudget(candidates, rules.cashLimit) : null;
  const planSentences: string[] = [];
  if (plan) {
    const allFunded = plan.deferred.length === 0;
    planSentences.push(
      allFunded
        ? `Cash check: the pending orders commit about ${inr(plan.committed)} of your ${inr(plan.cashLimit)} limit — everything fits${plan.funded.some((f) => f.downsizedFrom) ? ", with one quantity reduced as noted" : ""}.`
        : `Cash check: only ${inr(plan.committed)} of your ${inr(plan.cashLimit)} limit is committed — ${plan.deferred.length} order(s) do not fit: ${plan.deferred.map((d) => d.name).join(", ")}. They stay pending for you to approve deliberately, or after cash frees up.`,
    );
  }

  const minutes = recs.length === 0 ? 0 : Math.min(recs.length, 3) * 4;
  const n = recs.length;
  const itemTxt = items.map((i, k) => `${k + 1}. ${i.title}: ${i.line}.`).join(" ");
  const planTxt = planSentences.join(" ");
  const text = n === 0
    ? `${greeting}. Nothing needs your attention right now.`
    : `${greeting}. You have ${n} item${n > 1 ? "s" : ""} to look at. ${itemTxt}${planTxt ? ` ${planTxt}` : ""} Estimated attention required: ${minutes} minutes.`;
  const spoken = n === 0
    ? `${greeting}. Nothing needs your attention right now.`
    : `${greeting}. ${n === 1 ? "One thing needs" : `${n} things need`} your attention. ${items.map((i) => `${i.title}: ${i.line}.`).join(" ")}${planSentences.length ? ` ${planSentences[0]}` : ""}`;
  return { greeting, total: n, items, minutes, text, spoken, plan };
}
