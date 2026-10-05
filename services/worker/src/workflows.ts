import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities";

const { runSahaayWorkflow } = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: { initialInterval: "5 seconds", backoffCoefficient: 2, maximumAttempts: 5 },
});

export async function weeklyAnalysis() { return runSahaayWorkflow("weekly_analysis"); }
export async function morningBriefing() { return runSahaayWorkflow("morning_briefing"); }
export async function monthlySlowMoving() { return runSahaayWorkflow("monthly_slow_moving"); }
export async function outcomeCheck() { return runSahaayWorkflow("outcome_check"); }
