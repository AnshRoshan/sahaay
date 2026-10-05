import Link from "next/link";
import ActionButton from "@/components/ActionButton";
import { Card, EmptyState, PageHeader, StatusBadge, fmtTs } from "@/components/ui";
import { getHistory, getNorthStar } from "@/lib/server/data";

export const dynamic = "force-dynamic";

const verdictStyle: Record<string, string> = { close: "bg-emerald-50 text-emerald-700", reasonable: "bg-emerald-50 text-emerald-700", avoided_risk: "bg-emerald-50 text-emerald-700", overestimated: "bg-amber-50 text-amber-800", underestimated: "bg-amber-50 text-amber-800", risk_realised: "bg-red-50 text-red-700" };

export default async function History() {
  const [h, n] = await Promise.all([getHistory(), getNorthStar()]);
  return (
    <div className="space-y-6">
      <PageHeader title="Decision history & memory" subtitle="Recommendation → your decision → what actually happened. This is Sahaay's memory, and the reason its advice improves over time." actions={<ActionButton endpoint="/api/outcomes/measure" variant="secondary" done="outcomes">Measure outcomes now</ActionButton>} />
      <Card>
        <div className="grid gap-3 text-center sm:grid-cols-5">
          {[["Recommendations", n.recommendations], ["Decided", n.decided], ["Approved / modified", n.approved], ["Outcomes measured", n.measurable], ["Good outcomes", n.positive]].map(([l, v]) => <div key={l as string} className="rounded-lg bg-slate-50 p-3"><div className="text-2xl font-semibold">{v}</div><div className="text-xs text-slate-500">{l}</div></div>)}
        </div>
      </Card>
      <Card>
        <h2 className="font-semibold text-slate-900">What Sahaay has learned about you</h2>
        {h.preferences.length === 0 ? <p className="mt-1 text-sm text-slate-500">Nothing yet. Modify a recommendation and give a reason; patterns appear after a few decisions.</p> : (
          <ul className="mt-2 space-y-1.5 text-sm text-slate-800">{h.preferences.map((p) => <li key={p.id}>🧠 {p.statement} <span className="text-xs text-slate-400">· {p.evidenceCount} data point(s) · derived deterministically from your decisions and outcomes</span></li>)}</ul>
        )}
      </Card>
      {h.decisions.length === 0 && <EmptyState title="No decisions yet" body="Approve, modify or reject a recommendation and it appears here." />}
      <div className="space-y-3">
        {h.decisions.map((d) => (
          <Card key={d.id}>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={d.kind} />
              <Link href={`/decisions/${d.recommendationId}`} className="font-semibold text-slate-900 hover:text-indigo-700">{d.productName ?? d.rec?.title}</Link>
              <span className="text-xs text-slate-400">{d.decisionDate} · recorded {fmtTs(d.decidedAt)}</span>
            </div>
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 p-2.5"><div className="text-xs text-slate-500">Recommended</div><div className="font-semibold">{d.recommendedQty ?? "—"}</div></div>
              <div className="rounded-lg bg-slate-50 p-2.5"><div className="text-xs text-slate-500">Human decision</div><div className="font-semibold">{d.kind === "rejected" ? "Rejected" : (d.approvedQty ?? "Accepted")}</div></div>
              <div className="rounded-lg bg-slate-50 p-2.5"><div className="text-xs text-slate-500">Reason</div><div className="font-medium">{d.reason ?? "—"}</div></div>
            </div>
            {d.outcome ? (
              <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm">
                <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-semibold ${verdictStyle[d.outcome.verdict] ?? "bg-slate-100"}`}>{d.outcome.verdict.replace("_", " ")}</span>
                <span className="text-slate-800">{d.outcome.note}</span>
              </div>
            ) : d.recommendedQty !== null ? <p className="mt-3 text-sm text-slate-500">⏳ Monitoring — outcome measured after {d.outcomeWindowDays} days of sales.</p> : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
