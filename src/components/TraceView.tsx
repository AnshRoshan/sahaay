import { cn } from "./ui";

export type SpanLike = { name: string; startMs: number; durationMs: number; status: string; attrs?: Record<string, unknown>; error?: string };

export default function TraceView({ spans, label }: { spans: SpanLike[]; label?: string }) {
  const total = Math.max(1, ...spans.map((s) => s.startMs + s.durationMs));
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
      {label && <div className="mb-2 font-semibold text-slate-700">{label}</div>}
      <ol className="space-y-1.5">
        {spans.map((s, i) => (
          <li key={i}>
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", s.status === "ok" ? "bg-emerald-500" : "bg-red-500")} />
              <span className="font-mono text-slate-800">{s.name}</span>
              <span className="text-slate-400">{s.durationMs}ms</span>
            </div>
            <div className="ml-4 mt-0.5 h-1 rounded bg-slate-200">
              <div className={cn("h-1 rounded", s.status === "ok" ? "bg-indigo-400" : "bg-red-400")} style={{ marginLeft: `${(s.startMs / total) * 100}%`, width: `${Math.max(1, (s.durationMs / total) * 100)}%` }} />
            </div>
            {s.attrs && <div className="ml-4 mt-0.5 break-all font-mono text-[10px] text-slate-500">{JSON.stringify(s.attrs)}</div>}
            {s.error && <div className="ml-4 text-red-600">{s.error}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}
