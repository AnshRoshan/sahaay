"use client";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { cn } from "./ui";

type J = Record<string, unknown>;
const FORMAT: Record<string, (j: J) => string> = {
  text: () => "Done",
  demo: () => "Demo shop loaded",
  analysis: (j) => { const r = j.recs as { created: number; updated: number; expired: number }; return `Analysis refreshed: ${r.created} new, ${r.updated} updated, ${r.expired} expired`; },
  simulate: (j) => `Advanced to ${(j.simulation as { newAsOf: string }).newAsOf}; ${(j.outcomes as { measured: number }).measured} outcome(s) measured`,
  outcomes: (j) => `${j.measured} measured, ${j.pending} still waiting for enough data`,
  workflow: (j) => `Workflow ${j.status}`,
  explain: (j) => (j.source === "gemma" ? "Explained by Gemma (numbers verified)" : "Explained by deterministic template (Gemma not configured or its output was rejected)"),
};

export default function ActionButton({
  endpoint, body, children, variant = "primary", confirm, done = "text", className,
}: {
  endpoint: string;
  body?: Record<string, unknown>;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  confirm?: string;
  /** Serializable result formatter (functions cannot cross the server→client boundary). */
  done?: "text" | "demo" | "analysis" | "simulate" | "outcomes" | "workflow" | "explain";
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(json.error ?? `Request failed (${res.status})`));
      setMsg({ ok: true, text: (FORMAT[done] ?? FORMAT.text)(json) });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }
  const styles = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
    ghost: "text-indigo-700 hover:bg-indigo-50",
  }[variant];
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button onClick={run} disabled={busy} className={cn("rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-60", styles, className)}>
        {busy ? "Working…" : children}
      </button>
      {msg && <span className={cn("max-w-xs text-xs", msg.ok ? "text-emerald-700" : "text-red-600")}>{msg.text}</span>}
    </span>
  );
}
