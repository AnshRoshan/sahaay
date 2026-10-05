"use client";
import { useState } from "react";

type Item = { title: string; url: string | null; snippet: string; source: string; priceInr: number | null; moq: number | null; relevance: number };
type Research = { provider: string; simulated: boolean; query: string; fetchedAt: string; note?: string; items: Item[] };

export default function ResearchPanel({ id, initial }: { id: string; initial: Research | null }) {
  const [r, setR] = useState<Research | null>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/recommendations/${id}/research`, { method: "POST" });
    const j = (await res.json().catch(() => ({}))) as { research?: Research; error?: string };
    if (!res.ok) setErr(j.error ?? "Failed");
    else setR(j.research ?? null);
    setBusy(false);
  }
  return (
    <div className="text-sm">
      <button onClick={go} disabled={busy} className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-medium hover:bg-slate-50 disabled:opacity-60">{busy ? "Searching external sources…" : r ? "Search again" : "Can I get this cheaper? Search the web"}</button>
      <p className="mt-1 text-xs text-slate-500">Only the product name is sent out. No sales, stock or price data leaves your system.</p>
      {err && <p className="mt-2 text-red-600">{err}</p>}
      {r && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-rose-700">EXTERNAL DATA — not verified against your records</div>
          {r.note && <div className="mt-1 text-xs font-semibold text-rose-800">{r.note}</div>}
          <ul className="mt-2 space-y-2">
            {r.items.map((it, i) => (
              <li key={i} className="rounded-lg bg-white p-2.5">
                <div className="font-medium text-slate-900">{it.url ? <a href={it.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">{it.title}</a> : it.title}</div>
                <div className="text-xs text-slate-600">{it.priceInr ? `₹${it.priceInr}/unit` : "price unknown"} · {it.moq ? `MOQ ${it.moq}` : "MOQ unknown"} · relevance {Math.round(it.relevance * 100)}% · source: {it.source}</div>
                {it.snippet && <div className="mt-0.5 text-xs text-slate-500">{it.snippet}</div>}
              </li>
            ))}
            {r.items.length === 0 && <li className="text-xs text-slate-600">No results.</li>}
          </ul>
          <div className="mt-2 text-[10px] text-slate-500">query: “{r.query}” · fetched {r.fetchedAt} · provider {r.provider}</div>
        </div>
      )}
    </div>
  );
}
