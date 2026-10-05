"use client";
import { useState } from "react";

export default function LoginForm() {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    if (res.ok) window.location.href = "/";
    else {
      setErr(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Login failed");
      setBusy(false);
    }
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-2xl font-bold text-indigo-700">Sahaay</div>
        <p className="mt-1 text-sm text-slate-600">Know what needs attention. Know why. Decide with confidence.</p>
        <label className="mt-6 block text-sm font-medium text-slate-700">Owner access code</label>
        <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoFocus className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <button disabled={busy || !code} className="mt-4 w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">Unlock</button>
      </form>
    </div>
  );
}
