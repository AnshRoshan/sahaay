import Link from "next/link";
import ActionButton from "@/components/ActionButton";
import RecCard from "@/components/RecCard";
import { EmptyState, PageHeader, cn } from "@/components/ui";
import { listRecs } from "@/lib/server/data";

export const dynamic = "force-dynamic";

export default async function Decisions({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = "pending" } = await searchParams;
  const all = await listRecs();
  const tabs = [
    ["pending", "Open", all.filter((r) => r.status === "pending")],
    ["decided", "Decided", all.filter((r) => ["approved", "modified", "rejected", "executed"].includes(r.status))],
    ["expired", "Expired", all.filter((r) => r.status === "expired")],
  ] as const;
  const current = tabs.find((t) => t[0] === status) ?? tabs[0];
  const rows = current[2];
  const groups = status === "pending" || !tabs.find((t) => t[0] === status)
    ? [["Needs attention now", rows.filter((r) => r.severity === "high")], ["Worth a look", rows.filter((r) => r.severity === "medium" && !r.abstain)], ["Opportunities", rows.filter((r) => r.severity === "opportunity")], ["Needs information (I abstained)", rows.filter((r) => r.abstain)]] as const
    : [["", rows]] as const;
  return (
    <div>
      <PageHeader title="Decisions" subtitle="Every recommendation carries evidence, confidence, risks and alternatives — and is validated against your rules before you see it." actions={<ActionButton endpoint="/api/analysis/run" variant="secondary" done="analysis">↻ Re-run analysis</ActionButton>} />
      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {tabs.map(([k, label, list]) => (
          <Link key={k} href={`/decisions?status=${k}`} className={cn("-mb-px border-b-2 px-4 py-2 text-sm font-medium", current[0] === k ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800")}>{label} <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-xs">{list.length}</span></Link>
        ))}
      </div>
      {rows.length === 0 && <EmptyState title="Nothing here" body={status === "pending" ? "No open recommendations. Import data or re-run analysis." : "No items in this view yet."} />}
      <div className="space-y-8">
        {groups.map(([label, list]) => list.length > 0 && (
          <section key={label}>
            {label && <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{label} <span className="text-slate-400">({list.length})</span></h2>}
            <div className="space-y-4">{list.map((r) => <RecCard key={r.id} rec={r} />)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
