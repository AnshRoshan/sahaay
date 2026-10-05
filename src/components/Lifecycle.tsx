import { LIFECYCLE_STAGES } from "@/lib/types";
import { cn } from "./ui";

export default function Lifecycle({ entries }: { entries: { stage: string; at: string; note?: string }[] }) {
  const reached = new Map<string, { at: string; note?: string }>();
  for (const e of entries) {
    const slot = e.stage === "MODIFIED" || e.stage === "REJECTED" ? "APPROVED" : e.stage;
    reached.set(slot, e);
  }
  const rejected = entries.find((e) => e.stage === "REJECTED");
  const expired = entries.find((e) => e.stage === "EXPIRED");
  const modified = entries.find((e) => e.stage === "MODIFIED");
  return (
    <ol className="flex flex-wrap gap-1.5">
      {LIFECYCLE_STAGES.map((st) => {
        const hit = reached.get(st);
        const label = st === "APPROVED" ? (rejected ? "REJECTED" : modified ? "MODIFIED" : "APPROVED") : st;
        const bad = st === "APPROVED" && rejected;
        return (
          <li key={st} title={hit?.note ?? ""} className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide", hit ? (bad ? "bg-slate-200 text-slate-700" : "bg-indigo-600 text-white") : "bg-slate-100 text-slate-400")}>
            {label.replace("_", " ")}
          </li>
        );
      })}
      {expired && <li className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-500">EXPIRED</li>}
    </ol>
  );
}
