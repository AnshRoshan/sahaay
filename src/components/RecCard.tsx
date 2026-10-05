import Link from "next/link";
import type { RecRow } from "@/lib/server/data";
import type { Action } from "@/lib/types";
import EvidenceDrawer, { type DrawerRec } from "./EvidenceDrawer";
import type { EvidenceLike } from "./EvidenceList";
import QuickApprove from "./QuickApprove";
import { Card, ConfidencePill, SeverityBadge, StatusBadge, VerdictBadge, inr } from "./ui";

const TYPE_LABEL: Record<string, string> = {
  reorder: "Reorder", supplier_change: "Supplier opportunity", inventory_warning: "Inventory warning",
  slow_moving: "Slow-moving stock", opportunity: "Opportunity",
};

export function toDrawerRec(r: RecRow): DrawerRec {
  return {
    id: r.id, title: r.title, summary: r.summary, confidence: r.confidence, abstain: r.abstain,
    evidence: r.evidence as EvidenceLike[], risks: r.risks as DrawerRec["risks"],
    calculation: r.calculation as DrawerRec["calculation"], validation: r.validation as DrawerRec["validation"],
    simulation: (r.simulation ?? null) as DrawerRec["simulation"],
    recommendedQty: (r.action as unknown as Action)?.quantity ?? null,
  };
}

export default function RecCard({ rec, compact }: { rec: RecRow; compact?: boolean }) {
  const a = rec.action as unknown as Action;
  const ev = (rec.evidence as EvidenceLike[]).find((e) => e.label === "Stockout risk");
  const prob = ev && typeof ev.value === "object" && ev.value ? (ev.value as { probability?: number }).probability : undefined;
  const blocked = (rec.validation as { status?: string } | null)?.status === "block";
  return (
    <Card className={rec.severity === "high" ? "border-l-4 border-l-red-500" : rec.severity === "medium" ? "border-l-4 border-l-amber-400" : "border-l-4 border-l-emerald-500"}>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={rec.severity} />
        <span className="text-xs font-medium text-slate-500">{TYPE_LABEL[rec.type] ?? rec.type}</span>
        <VerdictBadge verdict={rec.verdict} />
        {rec.status !== "pending" && <StatusBadge status={rec.status} />}
        {blocked && <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">Blocked by your rules</span>}
      </div>
      <Link href={`/decisions/${rec.id}`} className="mt-2 block text-lg font-semibold text-slate-900 hover:text-indigo-700">{rec.title}</Link>
      {prob !== undefined && <div className="text-sm font-medium text-red-700">Stockout risk: {Math.round(prob * 100)}%</div>}
      <p className="mt-1 text-sm leading-relaxed text-slate-700">{rec.summary}</p>
      {!compact && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{rec.abstain ? "Needs" : "Recommended"}: </span>
          {rec.abstain ? rec.needsInfo.join("; ") : a.label}
          {a.estimatedCost !== undefined && a.estimatedCost > 0 && <span className="text-slate-500"> · est. {inr(a.estimatedCost)}</span>}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <EvidenceDrawer rec={toDrawerRec(rec)} label={rec.abstain ? "Why I abstained" : "View reasoning"} />
        {rec.status === "pending" && !rec.abstain && !blocked && <QuickApprove id={rec.id} label={a.kind === "order" ? "Approve" : "Accept"} />}
        <Link href={`/decisions/${rec.id}`} className="rounded-lg px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50">{rec.status === "pending" ? (a.kind === "order" ? "Modify / reject" : "Investigate") : "Details"}</Link>
        <span className="ml-auto"><ConfidencePill value={rec.confidence} abstain={rec.abstain} /></span>
      </div>
    </Card>
  );
}
