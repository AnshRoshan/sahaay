import Link from "next/link";
import ActionButton from "@/components/ActionButton";
import RecCard from "@/components/RecCard";
import VoiceBriefing from "@/components/VoiceBriefing";
import { Card, EmptyState, Stat } from "@/components/ui";
import { buildBriefing } from "@/lib/server/briefing";
import { getDataSummary, getHistory, getNorthStar, listRecs } from "@/lib/server/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const summary = await getDataSummary();
  if (!summary.hasData) {
    return (
      <div className="pt-6">
        <EmptyState title="Welcome to Sahaay" body="Sahaay turns your sales, inventory and supplier data into explainable decisions. Upload your CSVs, or explore with a realistic demo garment shop.">
          <Link href="/import" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Import my data</Link>
          <ActionButton endpoint="/api/demo/load" variant="secondary" done="demo">Load demo shop</ActionButton>
        </EmptyState>
      </div>
    );
  }
  const [briefing, pending, north, hist] = await Promise.all([buildBriefing(), listRecs(["pending"]), getNorthStar(), getHistory()]);
  const top = pending.slice(0, 3);
  const warnings = summary.issues.filter((i) => i.severity !== "info").length;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{briefing.greeting} 👋</h1>
          <p className="mt-1 text-lg text-slate-700">
            {briefing.total === 0 ? "Nothing needs your attention right now." : <><b>{briefing.total} thing{briefing.total > 1 ? "s" : ""}</b> need{briefing.total > 1 ? "" : "s"} your attention</>}
            {briefing.minutes > 0 && <span className="text-slate-500"> · about {briefing.minutes} minutes</span>}
          </p>
          <p className="text-xs text-slate-500">Data as of {summary.asOf}</p>
        </div>
        <div className="flex gap-2"><VoiceBriefing spoken={briefing.spoken} /><ActionButton endpoint="/api/analysis/run" variant="secondary" done="analysis">↻ Re-run analysis</ActionButton></div>
      </div>

      <div className="space-y-4">
        {top.map((r) => <RecCard key={r.id} rec={r} />)}
        {top.length === 0 && <Card><p className="text-sm text-slate-600">All clear. Sahaay will keep monitoring and tell you when something changes.</p></Card>}
        {pending.length > 3 && <Link href="/decisions" className="block text-sm font-medium text-indigo-700 hover:underline">See all {pending.length} open items →</Link>}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Sales records" value={summary.salesRecords.toLocaleString()} hint="imported & valid" href="/import" />
        <Stat label="Products" value={summary.products} href="/inventory" />
        <Stat label="Suppliers" value={summary.suppliers} href="/suppliers" />
        <Stat label="Data warnings" value={warnings} hint="never silently assumed" href="/import#quality" />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Useful decisions completed with measurable outcomes</h2>
          <Link href="/history" className="text-sm text-indigo-700 hover:underline">Decision history →</Link>
        </div>
        <div className="mt-3 grid gap-3 text-center sm:grid-cols-5">
          {[["Recommendations", north.recommendations], ["Decided", north.decided], ["Approved / modified", north.approved], ["Measurable outcomes", north.measurable], ["Good outcomes", north.positive]].map(([l, v]) => (
            <div key={l as string} className="rounded-lg bg-slate-50 p-3"><div className="text-2xl font-semibold text-slate-900">{v}</div><div className="text-xs text-slate-500">{l}</div></div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Predict → Explain → Approve → Act → Monitor → Learn. The north-star is decisions with outcomes, not messages sent.</p>
      </Card>

      {hist.preferences.length > 0 && (
        <Card>
          <h2 className="font-semibold text-slate-900">What Sahaay has learned about how you decide</h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">{hist.preferences.map((p) => <li key={p.id}>• {p.statement} <span className="text-xs text-slate-400">({p.evidenceCount} data point{p.evidenceCount === 1 ? "" : "s"})</span></li>)}</ul>
        </Card>
      )}

      <Card className="border-dashed bg-slate-50">
        <h2 className="font-semibold text-slate-900">Demo time machine <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">SIMULATION</span></h2>
        <p className="mt-1 text-sm text-slate-600">Fast-forward 7 days to see the outcome loop: sales are generated from the forecast, stock is drawn down, ordered goods arrive, and Sahaay measures what happened versus its recommendation. Don&apos;t use on real data.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionButton endpoint="/api/demo/simulate" body={{ days: 7 }} done="simulate">⏩ Simulate next 7 days</ActionButton>
          <ActionButton endpoint="/api/demo/load" variant="secondary" confirm="This resets all data and reloads the demo shop. Continue?" done="demo">Reset demo shop</ActionButton>
        </div>
      </Card>
    </div>
  );
}
