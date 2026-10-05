"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function QuickApprove({ id, label = "Approve" }: { id: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/recommendations/${id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "approved" }) });
    if (res.ok) router.refresh();
    else if (res.status === 409 || res.status === 422) router.push(`/decisions/${id}`);
    else setErr(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Failed");
    setBusy(false);
  }
  return (
    <span className="inline-flex flex-col">
      <button onClick={go} disabled={busy} className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">{busy ? "…" : label}</button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}
