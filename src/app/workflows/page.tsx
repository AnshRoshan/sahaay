import ActionButton from "@/components/ActionButton";
import { Card, PageHeader, cn, fmtTs } from "@/components/ui";
import { getWorkflowData } from "@/lib/server/data";
import { WORKFLOWS, ensureSchedules, nextRunAfter } from "@/lib/server/workflows";

export const dynamic = "force-dynamic";

export default async function Workflows() {
  await ensureSchedules();
  const { schedules, runs } = await getWorkflowData();
  return (
    <div className="space-y-6">
      <PageHeader title="Recurring workflows" subtitle="Schedules are owned by durable workflow infrastructure — not by the language model's memory. Steps are persisted and retried with backoff." />
      <div className="grid gap-4 sm:grid-cols-2">
        {schedules.map((sc) => {
          const def = WORKFLOWS[sc.name];
          const next = nextRunAfter(sc.cron, sc.lastRunAt ?? new Date());
          return (
            <Card key={sc.name}>
              <div className="font-semibold text-slate-900">{sc.label}</div>
              <div className="text-xs text-indigo-700">{def?.cadence} <span className="font-mono text-slate-400">({sc.cron} IST)</span></div>
              <p className="mt-1 text-sm text-slate-600">{sc.description}</p>
              <ol className="mt-2 flex flex-wrap gap-1 text-[11px]">{def?.steps.map((st, i) => <li key={st.name} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-600">{i + 1}. {st.name}</li>)}</ol>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>Last run: {fmtTs(sc.lastRunAt)} · Next: {fmtTs(next)}</span>
                <ActionButton endpoint={`/api/workflows/${sc.name}/run`} variant="secondary" done="workflow">Run now</ActionButton>
              </div>
            </Card>
          );
        })}
      </div>
      <Card>
        <h2 className="font-semibold text-slate-900">Run history</h2>
        {runs.length === 0 && <p className="mt-1 text-sm text-slate-500">No runs yet.</p>}
        <ul className="mt-2 divide-y divide-slate-100">
          {runs.map((r) => (
            <li key={r.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", r.status === "completed" ? "bg-emerald-50 text-emerald-700" : r.status === "failed" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800")}>{r.status}</span>
                <b>{WORKFLOWS[r.name]?.label ?? r.name}</b><span className="text-xs text-slate-400">#{r.id} · {r.trigger} · {fmtTs(r.startedAt)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">{(r.steps as { name: string; status: string; attempts: number; durationMs: number }[]).map((st) => <span key={st.name} className={cn("rounded px-1.5 py-0.5 font-mono text-[11px]", st.status === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>{st.name} · {st.durationMs}ms{st.attempts > 1 ? ` · ${st.attempts} tries` : ""}</span>)}</div>
              {r.error && <div className="mt-1 text-xs text-red-600">{r.error}</div>}
              {(r.result as { briefing?: { text?: string } } | null)?.briefing?.text && <div className="mt-1 rounded bg-slate-50 p-2 text-xs text-slate-700">📣 {(r.result as { briefing: { text: string } }).briefing.text}</div>}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="bg-slate-50 text-sm text-slate-700">
        <b>Orchestration:</b> a Render Cron Job (or Temporal Schedule) calls <code className="rounded bg-white px-1">/api/cron/tick</code>, which runs every due workflow. For production-grade durability, <code className="rounded bg-white px-1">services/worker</code> contains Temporal workflows whose activities call <code className="rounded bg-white px-1">/api/workflows/&#123;name&#125;/run</code> with Temporal retry policies.
      </Card>
    </div>
  );
}
