import { Bar, ClaimStatusBadge, cn } from "./ui";

export type EvidenceLike = { source: string; label: string; value: unknown; explanation: string; timestamp?: string; status?: string };

const srcStyle: Record<string, string> = {
  sales: "bg-sky-50 text-sky-700",
  inventory: "bg-violet-50 text-violet-700",
  forecast: "bg-indigo-50 text-indigo-700",
  supplier: "bg-amber-50 text-amber-800",
  rules: "bg-slate-100 text-slate-700",
  memory: "bg-emerald-50 text-emerald-700",
  ledger: "bg-teal-50 text-teal-700",
  web: "bg-rose-50 text-rose-700",
};

export default function EvidenceList({ evidence }: { evidence: EvidenceLike[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {evidence.map((e, i) => {
        const v = e.value as Record<string, number> | number | null;
        const trend = e.label === "Demand trend" && v && typeof v === "object" ? v.trendPct : null;
        const prob = e.label === "Stockout risk" && v && typeof v === "object" ? v.probability : null;
        return (
          <li key={i} className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", srcStyle[e.source] ?? "bg-slate-100")}>
                {e.source === "web" ? "EXTERNAL · web" : `INTERNAL · ${e.source}`}
              </span>
              <span className="text-sm font-semibold text-slate-900">{e.label}</span>
              <ClaimStatusBadge status={e.status} />
            </div>
            <p className="mt-1 text-sm text-slate-700">{e.explanation}</p>
            {trend !== null && trend !== undefined && (
              <div className="mt-2 flex items-center gap-2">
                <span className="w-16 text-xs font-semibold text-slate-600">{trend >= 0 ? "↑" : "↓"} {Math.abs(Math.round(trend * 100))}%</span>
                <Bar value={Math.min(1, Math.abs(trend))} color={trend >= 0 ? "bg-emerald-500" : "bg-red-500"} />
              </div>
            )}
            {prob !== null && prob !== undefined && (
              <div className="mt-2 flex items-center gap-2">
                <span className="w-16 text-xs font-semibold text-slate-600">{Math.round(prob * 100)}%</span>
                <Bar value={prob} color={prob >= 0.6 ? "bg-red-500" : prob >= 0.25 ? "bg-amber-500" : "bg-emerald-500"} />
              </div>
            )}
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">Inspect underlying data</summary>
              <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-[11px] text-slate-600">{JSON.stringify(e.value, null, 2)}{e.timestamp ? `\n(as of ${e.timestamp})` : ""}</pre>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

export function CalcTable({ steps }: { steps: { label: string; value: number | string; formula?: string }[] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {steps.map((s, i) => (
          <tr key={i} className={cn("border-b border-slate-100 last:border-0", i === steps.length - 1 && "font-semibold")}>
            <td className="py-1.5 pr-3 text-slate-600">{s.label}</td>
            <td className="py-1.5 pr-3 text-right font-mono text-slate-900">{s.value}</td>
            <td className="py-1.5 font-mono text-xs text-slate-400">{s.formula}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ValidationList({ report }: { report: { status: string; checks: { rule: string; status: string; message: string }[] } }) {
  const icon: Record<string, string> = { pass: "✓", warn: "⚠", block: "✕", skipped: "–" };
  const color: Record<string, string> = { pass: "text-emerald-600", warn: "text-amber-600", block: "text-red-600", skipped: "text-slate-400" };
  return (
    <ul className="space-y-1">
      {report.checks.map((c, i) => (
        <li key={i} className="flex gap-2 text-sm">
          <span className={cn("w-4 shrink-0 text-center font-bold", color[c.status])}>{icon[c.status]}</span>
          <span><span className="font-mono text-xs text-slate-500">{c.rule}</span> — <span className="text-slate-700">{c.message}</span></span>
        </li>
      ))}
    </ul>
  );
}
