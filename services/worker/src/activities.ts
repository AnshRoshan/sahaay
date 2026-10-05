import { ApplicationFailure } from "@temporalio/activity";

const BASE = process.env.SAHAAY_URL ?? "http://localhost:3000";

/** Calls Sahaay's workflow endpoint. Temporal owns retries/timeouts; Sahaay owns the business steps. */
export async function runSahaayWorkflow(name: string): Promise<{ status: string; runId: number }> {
  const res = await fetch(`${BASE}/api/workflows/${name}/run?trigger=temporal`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`, "Content-Type": "application/json" },
  });
  if (res.status >= 400 && res.status < 500) throw ApplicationFailure.nonRetryable(`Sahaay rejected ${name}: ${res.status}`);
  if (!res.ok) throw new Error(`Sahaay error ${res.status}`); // retryable
  const j = (await res.json()) as { status: string; runId: number };
  if (j.status === "failed") throw new Error(`Sahaay workflow ${name} failed`);
  return j;
}
