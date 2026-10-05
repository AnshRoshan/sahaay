// Durable recurring workflows: persisted step state, retries with backoff, schedules + tick().
// Production-grade orchestration is delegated to Temporal (services/worker), which calls the
// same endpoints; this runner keeps the app fully functional without a Temporal cluster.
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { buildBriefing } from "./briefing";
import { getDataSummary } from "./data";
import { runAnalysis } from "./engine";
import { captureException } from "./observability";
import { measureOutcomes } from "./outcomes";

type State = Record<string, unknown>;
type Step = { name: string; run: (st: State) => Promise<unknown> };
type Def = { label: string; description: string; cron: string; cadence: string; steps: Step[] };

export const WORKFLOWS: Record<string, Def> = {
  weekly_analysis: {
    label: "Weekly inventory review",
    description: "Load data → forecast demand → detect risks → generate + validate recommendations → measure outcomes → notify owner.",
    cron: "0 8 * * 0",
    cadence: "Every Sunday, 8:00 AM IST",
    steps: [
      { name: "load_data", run: async (st) => (st.data = await getDataSummary()) },
      { name: "forecast_detect_recommend", run: async (st) => (st.analysis = await runAnalysis()) },
      {
        name: "validate",
        run: async (st) => {
          const rows = await db.select().from(s.recommendations).where(eq(s.recommendations.status, "pending"));
          const blocked = rows.filter((r) => (r.validation as { status?: string } | null)?.status === "block").length;
          return (st.validation = { pending: rows.length, blockedByRules: blocked });
        },
      },
      { name: "measure_outcomes", run: async (st) => (st.outcomes = await measureOutcomes()) },
      { name: "notify_owner", run: async (st) => (st.briefing = await buildBriefing()) },
    ],
  },
  morning_briefing: {
    label: "Morning briefing",
    description: "Summarise what needs attention today, with a spoken version for voice playback.",
    cron: "0 8 * * *",
    cadence: "Every day, 8:00 AM IST",
    steps: [
      { name: "compose_briefing", run: async (st) => (st.briefing = await buildBriefing()) },
    ],
  },
  monthly_slow_moving: {
    label: "Monthly slow-moving stock review",
    description: "Re-analyse and list overstocked items with capital tied up.",
    cron: "0 9 1 * *",
    cadence: "1st of every month, 9:00 AM IST",
    steps: [
      { name: "analyze", run: async (st) => (st.analysis = await runAnalysis()) },
      {
        name: "list_slow_movers",
        run: async (st) => {
          const rows = await db.select().from(s.recommendations).where(eq(s.recommendations.type, "slow_moving"));
          return (st.slowMovers = rows.filter((r) => r.status === "pending").map((r) => ({ id: r.id, title: r.title })));
        },
      },
    ],
  },
  outcome_check: {
    label: "Outcome check",
    description: "Delayed outcome evaluation: measure what happened after past decisions and update learned preferences.",
    cron: "0 20 * * *",
    cadence: "Every day, 8:00 PM IST",
    steps: [{ name: "measure_outcomes", run: async (st) => (st.outcomes = await measureOutcomes()) }],
  },
};

export async function ensureSchedules() {
  for (const [name, d] of Object.entries(WORKFLOWS))
    await db.insert(s.workflowSchedules).values({ name, label: d.label, description: d.description, cron: d.cron }).onConflictDoNothing();
}

export async function runWorkflow(name: string, trigger: "manual" | "schedule" | "temporal" = "manual") {
  const def = WORKFLOWS[name];
  if (!def) throw new Error(`Unknown workflow: ${name}`);
  const [run] = await db.insert(s.workflowRuns).values({ name, status: "running", trigger, steps: [] }).returning();
  const steps: { name: string; status: string; attempts: number; durationMs: number; error?: string }[] = [];
  const state: State = {};
  try {
    for (const step of def.steps) {
      const rec = { name: step.name, status: "running", attempts: 0, durationMs: 0 } as (typeof steps)[number];
      steps.push(rec);
      const t0 = Date.now();
      for (let attempt = 1; attempt <= 3; attempt++) {
        rec.attempts = attempt;
        try {
          await step.run(state);
          rec.status = "completed";
          delete rec.error;
          break;
        } catch (e) {
          rec.error = e instanceof Error ? e.message : String(e);
          if (attempt === 3) {
            rec.status = "failed";
            throw e;
          }
          await new Promise((r) => setTimeout(r, 150 * attempt));
        }
      }
      rec.durationMs = Date.now() - t0;
      await db.update(s.workflowRuns).set({ steps }).where(eq(s.workflowRuns.id, run.id));
    }
    const result = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    await db.update(s.workflowRuns).set({ status: "completed", steps, result, finishedAt: new Date() }).where(eq(s.workflowRuns.id, run.id));
    await db.update(s.workflowSchedules).set({ lastRunAt: new Date() }).where(eq(s.workflowSchedules.name, name));
    return { runId: run.id, status: "completed", steps, result };
  } catch (e) {
    await captureException(e, { kind: "workflow", workflow: name });
    await db.update(s.workflowRuns).set({ status: "failed", steps, error: e instanceof Error ? e.message : String(e), finishedAt: new Date() }).where(eq(s.workflowRuns.id, run.id));
    return { runId: run.id, status: "failed", steps, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── minimal cron (min hour dom month dow; numbers, *, lists) evaluated in IST ──
const IST = 330 * 60000;
function field(expr: string, v: number): boolean {
  return expr === "*" || expr.split(",").some((x) => Number(x) === v);
}
export function cronMatches(cron: string, d: Date): boolean {
  const [mi, h, dom, mo, dow] = cron.trim().split(/\s+/);
  const t = new Date(d.getTime() + IST);
  return field(mi, t.getUTCMinutes()) && field(h, t.getUTCHours()) && field(dom, t.getUTCDate()) && field(mo, t.getUTCMonth() + 1) && field(dow, t.getUTCDay());
}
export function nextRunAfter(cron: string, from: Date): Date | null {
  const start = Math.floor(from.getTime() / 60000) * 60000 + 60000;
  for (let i = 0; i < 45 * 24 * 60; i++) {
    const d = new Date(start + i * 60000);
    if (cronMatches(cron, d)) return d;
  }
  return null;
}

/** Called by a cron job (Render) or Temporal Schedule: runs every workflow that is due. */
export async function tick(now = new Date()) {
  await ensureSchedules();
  const schedules = await db.select().from(s.workflowSchedules);
  const ran: string[] = [];
  for (const sc of schedules) {
    if (!sc.enabled || !WORKFLOWS[sc.name]) continue;
    const next = nextRunAfter(sc.cron, sc.lastRunAt ?? sc.createdAt);
    if (next && next <= now) {
      await runWorkflow(sc.name, "schedule");
      ran.push(sc.name);
    }
  }
  return { ran, checkedAt: now.toISOString() };
}
