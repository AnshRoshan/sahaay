"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import TraceView, { type SpanLike } from "./TraceView";
import { SeverityBadge, cn } from "./ui";

type Resp = {
  answer: string; source: string; intent: string; note?: string; runId: string; spans: SpanLike[];
  cards: { id: string; title: string; severity: string; summary: string }[];
  internal?: { heading: string; lines: string[] };
  external?: { provider: string; simulated: boolean; query: string; fetchedAt: string; note?: string; items: { title: string; url: string | null; snippet: string; source: string; priceInr: number | null; moq: number | null; relevance: number }[] } | null;
  recommendationId?: string; productId?: string;
};
type Msg = { role: "user" | "assistant"; text: string; resp?: Resp };

const SUGGEST = ["What needs my attention?", "Which products might run out?", "What should I order?", "Which products are overstocked?", "Why are sales falling?", "Find a cheaper supplier for Blue Shirt M", "What happened after my last decision?"];

export default function Chat({ context, compact, suggestions }: { context?: { recommendationId?: string; productId?: string }; compact?: boolean; suggestions?: string[] }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ctx, setCtx] = useState(context ?? {});
  const [trace, setTrace] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: q, context: ctx }) });
      const j = (await res.json()) as Resp & { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Request failed");
      setMsgs((m) => [...m, { role: "assistant", text: j.answer, resp: j }]);
      if (j.recommendationId || j.productId) setCtx((c) => ({ recommendationId: j.recommendationId ?? c.recommendationId, productId: j.productId ?? c.productId }));
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: `Sorry — ${e instanceof Error ? e.message : "something went wrong"}.` }]);
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  function listen() {
    type SR = { new (): { lang: string; onresult: (e: { results: { 0: { 0: { transcript: string } } } }) => void; start: () => void } };
    const W = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
    const R = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!R) { alert("Voice input is not supported in this browser."); return; }
    const r = new R();
    r.lang = "en-IN";
    r.onresult = (e) => send(e.results[0][0].transcript);
    r.start();
  }
  const speak = (t: string) => { if ("speechSynthesis" in window) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(t)); } };

  return (
    <div className="flex flex-col">
      <div className={cn("space-y-4 overflow-y-auto", compact ? "max-h-96" : "min-h-[320px]")}>
        {msgs.length === 0 && (
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            I&apos;m a decision-investigation layer, not a generic chatbot. Every number I give comes from your data and deterministic calculations — and I&apos;ll say “I don&apos;t have enough information” when that&apos;s the truth.
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[92%] rounded-2xl px-4 py-3 text-sm", m.role === "user" ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-800")}>
              <div className="whitespace-pre-wrap leading-relaxed">{m.text}</div>
              {m.resp && (
                <div className="mt-3 space-y-3">
                  {m.resp.internal && (
                    <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-violet-700">{m.resp.internal.heading}</div>
                      <ul className="mt-1 space-y-0.5 text-xs text-slate-700">{m.resp.internal.lines.map((l, k) => <li key={k}>• {l}</li>)}</ul>
                    </div>
                  )}
                  {m.resp.external && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-rose-700">EXTERNAL DATA — web research ({m.resp.external.provider})</div>
                      {m.resp.external.note && <div className="mt-1 text-xs font-medium text-rose-800">{m.resp.external.note}</div>}
                      <ul className="mt-1 space-y-1 text-xs text-slate-700">
                        {m.resp.external.items.map((it, k) => (
                          <li key={k}>• <b>{it.title}</b>{it.priceInr ? ` — ₹${it.priceInr}` : ""}{it.moq ? `, MOQ ${it.moq}` : it.priceInr ? ", MOQ unknown" : ""} <span className="text-slate-400">(relevance {Math.round(it.relevance * 100)}%{it.url ? "" : ""})</span>{it.url && <> <a href={it.url} target="_blank" rel="noreferrer" className="text-indigo-700 underline">source</a></>}</li>
                        ))}
                      </ul>
                      <div className="mt-1 text-[10px] text-slate-500">Query: “{m.resp.external.query}” · {m.resp.external.fetchedAt}</div>
                    </div>
                  )}
                  {m.resp.cards.length > 0 && (
                    <div className="space-y-1.5">
                      {m.resp.cards.map((c) => (
                        <Link key={c.id} href={`/decisions/${c.id}`} className="block rounded-lg border border-slate-200 p-2.5 hover:border-indigo-300">
                          <div className="flex items-center gap-2"><SeverityBadge severity={c.severity} /><span className="font-semibold text-slate-900">{c.title}</span></div>
                          <div className="mt-0.5 text-xs text-slate-600">{c.summary}</div>
                        </Link>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span className={cn("rounded px-1.5 py-0.5 font-semibold", m.resp.source === "gemma" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600")}>{m.resp.source === "gemma" ? "Phrased by Gemma · numbers verified" : "Deterministic answer"}</span>
                    <span>intent: {m.resp.intent}</span>
                    <button onClick={() => setTrace(trace === i ? null : i)} className="underline">{trace === i ? "hide trace" : "show trace"}</button>
                    <button onClick={() => speak(m.text)} className="underline">🔊 read aloud</button>
                  </div>
                  {m.resp.note && <div className="text-[11px] text-slate-400">{m.resp.note}</div>}
                  {trace === i && <TraceView spans={m.resp.spans} label={`Trace ${m.resp.runId}`} />}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="text-sm text-slate-500">Investigating your data…</div>}
        <div ref={endRef} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(suggestions ?? SUGGEST).slice(0, compact ? 4 : 8).map((s) => (
          <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:border-indigo-300 hover:bg-indigo-50">{s}</button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="mt-3 flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your business… e.g. “Why 18?”" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
        <button type="button" onClick={listen} title="Voice question" className="rounded-lg border border-slate-300 px-3 text-sm hover:bg-slate-50">🎙</button>
        <button disabled={busy || !input.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">Ask</button>
      </form>
    </div>
  );
}
