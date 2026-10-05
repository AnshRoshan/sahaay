// Registers the recurring Temporal Schedules (idempotent). Cron is evaluated in IST.
import { Client, Connection, ScheduleOverlapPolicy } from "@temporalio/client";

const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233" });
const client = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? "default" });

const defs = [
  { id: "sahaay-weekly-analysis", workflow: "weeklyAnalysis", cron: "0 8 * * 0" },
  { id: "sahaay-morning-briefing", workflow: "morningBriefing", cron: "0 8 * * *" },
  { id: "sahaay-monthly-slow-moving", workflow: "monthlySlowMoving", cron: "0 9 1 * *" },
  { id: "sahaay-outcome-check", workflow: "outcomeCheck", cron: "0 20 * * *" },
];
for (const d of defs) {
  try {
    await client.schedule.create({
      scheduleId: d.id,
      spec: { cronExpressions: [d.cron], timezone: "Asia/Kolkata" } as never,
      policies: { overlap: ScheduleOverlapPolicy.SKIP },
      action: { type: "startWorkflow", workflowType: d.workflow, taskQueue: "sahaay", workflowId: `${d.id}-run` },
    });
    console.log("created", d.id);
  } catch (e) {
    console.log("exists/skipped", d.id, (e as Error).message);
  }
}
await connection.close();
