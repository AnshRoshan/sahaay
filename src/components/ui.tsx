import type { ReactNode } from "react";
import Link from "next/link";

export const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
export const inr = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`);

export function Card({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("rounded-2xl border border-slate-200 bg-white p-5 shadow-sm", className)}>
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const chip = "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold";

export function SeverityBadge({ severity }: { severity: string }) {
  const m: Record<string, [string, string]> = {
    high: ["🔴 HIGH", "bg-red-50 text-red-700 ring-1 ring-red-200"],
    medium: ["🟡 MEDIUM", "bg-amber-50 text-amber-800 ring-1 ring-amber-200"],
    opportunity: ["🟢 OPPORTUNITY", "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"],
  };
  const [t, c] = m[severity] ?? [severity, "bg-slate-100 text-slate-700"];
  return <span className={cn(chip, c)}>{t}</span>;
}

export function LevelBadge({ level }: { level: string }) {
  const m: Record<string, string> = {
    SAFE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    WATCH: "bg-amber-50 text-amber-800 ring-amber-200",
    HIGH: "bg-orange-50 text-orange-700 ring-orange-200",
    CRITICAL: "bg-red-50 text-red-700 ring-red-200",
    ABSTAIN: "bg-slate-100 text-slate-700 ring-slate-300",
    DATA_ERROR: "bg-purple-50 text-purple-700 ring-purple-200",
  };
  return <span className={cn(chip, "ring-1", m[level] ?? "bg-slate-100 text-slate-600 ring-slate-200")}>{level.replace("_", " ")}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const m: Record<string, string> = {
    pending: "bg-indigo-50 text-indigo-700",
    approved: "bg-emerald-50 text-emerald-700",
    modified: "bg-sky-50 text-sky-700",
    rejected: "bg-slate-100 text-slate-600",
    executed: "bg-teal-50 text-teal-700",
    expired: "bg-slate-100 text-slate-400",
  };
  return <span className={cn(chip, m[status] ?? "bg-slate-100 text-slate-600")}>{status}</span>;
}

export function VerdictBadge({ verdict }: { verdict: string }) {
  if (verdict === "OK") return null;
  const m: Record<string, string> = {
    LOW_CONFIDENCE: "bg-amber-50 text-amber-800 ring-amber-200",
    FLAG_CONFLICT: "bg-orange-50 text-orange-700 ring-orange-200",
    ABSTAIN: "bg-slate-100 text-slate-700 ring-slate-300",
    DATA_ERROR: "bg-purple-50 text-purple-700 ring-purple-200",
  };
  return <span className={cn(chip, "ring-1", m[verdict] ?? "bg-slate-100")}>{verdict.replace("_", " ")}</span>;
}

export function ClaimStatusBadge({ status }: { status?: string }) {
  const s = status ?? "CONFIRMED";
  const m: Record<string, string> = {
    CONFIRMED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    INFERRED: "bg-amber-50 text-amber-800 ring-amber-200",
    MISSING: "bg-slate-100 text-slate-700 ring-slate-300",
    CONFLICTING: "bg-orange-50 text-orange-700 ring-orange-200",
  };
  const title: Record<string, string> = {
    CONFIRMED: "Stated by a source of record (export, POS, or an event you confirmed)",
    INFERRED: "Derived by calculation or a model — reasonable, but not a recorded fact",
    MISSING: "The information a decision needs is absent",
    CONFLICTING: "Two sources disagree; both are kept and the pessimistic value is used",
  };
  return <span title={title[s]} className={cn(chip, "ring-1", m[s] ?? "bg-slate-100 text-slate-600")}>{s}</span>;
}

export function ConfidencePill({ value, abstain }: { value: number; abstain?: boolean }) {
  if (abstain) return <span className={cn(chip, "bg-slate-100 text-slate-600")}>No confidence — abstained</span>;
  const label = value >= 0.75 ? "High" : value >= 0.5 ? "Medium" : "Low";
  const c = value >= 0.75 ? "text-emerald-700 bg-emerald-50" : value >= 0.5 ? "text-amber-800 bg-amber-50" : "text-red-700 bg-red-50";
  return <span className={cn(chip, c)}>Confidence: {label} ({Math.round(value * 100)}%)</span>;
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: string; href?: string }) {
  const inner = (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block transition hover:opacity-80">{inner}</Link> : inner;
}

export function EmptyState({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <div className="text-lg font-semibold text-slate-800">{title}</div>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{body}</p>}
      {children && <div className="mt-4 flex justify-center gap-2">{children}</div>}
    </div>
  );
}

export function Bar({ value, color = "bg-indigo-500" }: { value: number; color?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500", className)}>{children}</th>;
}
export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2.5 text-sm text-slate-800", className)}>{children}</td>;
}

export const fmtTs = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
