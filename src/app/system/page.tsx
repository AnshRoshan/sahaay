import TraceView, { type SpanLike } from "@/components/TraceView";
import { Card, PageHeader, cn, fmtTs } from "@/components/ui";
import { runSafetyCases } from "@/lib/evals";
import { getRecentRuns } from "@/lib/server/data";
import { integrationStatus } from "@/lib/server/integrations";

export const dynamic = "force-dynamic";

const FLOW = ["Business data", "Detect + Forecast", "AI reasoning (Gemma)", "Validation (rules)", "Recommendation", "Human approval", "Action", "Outcome", "Decision memory"];

export default async function System() {
  const [runs, cases, integrations] = [await getRecentRuns(10), runSafetyCases(), await integrationStatus()];
  const passed = cases.filter((c) => c.pass).length;
  return (
    <div className="space-y-6">
      <PageHeader title="Architecture, traces & safety evaluation" subtitle="AI proposes → deterministic systems verify → human approves → system acts → outcome is measured → future recommendations improve." />
      <Card>
        <h2 className="font-semibold text-slate-900">Decision pipeline</h2>
        <ol className="mt-3 flex flex-wrap items-center gap-2 text-sm">{FLOW.map((f, i) => <li key={f} className="flex items-center gap-2"><span className="rounded-lg bg-indigo-50 px-3 py-1.5 font-medium text-indigo-800">{f}</span>{i < FLOW.length - 1 && <span className="text-slate-400">→</span>}</li>)}</ol>
        <p className="mt-3 text-xs text-slate-500">The model owns language and reasoning interface. Code owns forecasts, inventory arithmetic, permissions and execution.</p>
      </Card>
      <Card>
        <h2 className="font-semibold text-slate-900">Why each technology exists</h2>
        <ul className="mt-2 divide-y divide-slate-100">{integrations.map((i) => <li key={i.name} className="flex flex-wrap items-start gap-3 py-2 text-sm"><span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase", i.state === "live" ? "bg-emerald-50 text-emerald-700" : i.state === "configured" ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-800")}>{i.state}</span><div className="flex-1"><b>{i.name}</b> — <span className="text-slate-600">{i.role}</span><div className="text-xs text-slate-500">{i.detail}</div></div></li>)}</ul>
      </Card>
      <Card>
        <h2 className="font-semibold text-slate-900">Safety & grounding tests · {passed}/{cases.length} passing</h2>
        <p className="text-xs text-slate-500">Executed live from <code>src/lib/evals.ts</code> (same cases run in <code>npm</code>-less CI via <code>npx tsx --test tests/**/*.test.ts</code>).</p>
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {cases.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5"><span className={cn("w-5 text-center font-bold", c.pass ? "text-emerald-600" : "text-red-600")}>{c.pass ? "✓" : "✕"}</span><span className="font-mono text-xs text-slate-400">{c.id}</span><span className="text-slate-800">{c.name}</span><span className="ml-auto font-mono text-xs text-slate-500">expected {c.expected} · got {c.actual}</span></li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="font-semibold text-slate-900">Recent agent traces</h2>
        {runs.length === 0 && <p className="mt-1 text-sm text-slate-500">No runs yet — ask a question or run an analysis.</p>}
        <div className="mt-3 space-y-4">
          {runs.map((r) => (
            <details key={r.id} className="rounded-xl border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm"><span className={cn("mr-2 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase", r.status === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>{r.status}</span><b>{r.kind}</b> — {r.input.slice(0, 80)} <span className="text-xs text-slate-400">· {r.durationMs}ms · {fmtTs(r.createdAt)}{r.model ? ` · ${r.model}` : ""}</span></summary>
              <div className="mt-3"><TraceView spans={r.spans as SpanLike[]} label={r.id} />{r.error && <p className="mt-2 text-xs text-red-600">{r.error}</p>}</div>
            </details>
          ))}
        </div>
      </Card>
    </div>
  );
}
