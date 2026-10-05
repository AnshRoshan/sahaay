"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProposedEvent, CaptureResult } from "@/lib/capture";
import { ClaimStatusBadge, cn } from "./ui";

type CaptureRecord = { id: string; channel: "message" | "voice"; rawText: string; parsed: CaptureResult; status: string; appliedEventIds: string[] };

const EXAMPLE = "Kal subah 20 basmati carton aaya aur 3 blue shirt M bik gaye";

/**
 * Capture → verify → confirm.
 * The owner speaks or types; we propose events and label every extracted fact. Nothing is
 * written until they confirm, and a line with a MISSING or CONFLICTING claim must be fixed
 * or dropped first — Sahaay does not guess quantities.
 */
export default function CaptureForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<"message" | "voice">("message");
  const [capture, setCapture] = useState<CaptureRecord | null>(null);
  const [accept, setAccept] = useState<Record<number, boolean>>({});
  const [qty, setQty] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  function startVoice() {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setErr("This browser does not support speech recognition. Type the update instead — it works the same way.");
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-IN";
    rec.interimResults = false;
    rec.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      setText(String(e.results[0]?.[0]?.transcript ?? ""));
      setChannel("voice");
      setErr("");
    };
    rec.onerror = () => setErr("I could not hear that. Please type the update instead.");
    rec.start();
    setMsg("Listening…");
  }

  async function submit() {
    setBusy(true);
    setErr("");
    setMsg("");
    const r = await fetch("/api/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, channel }) });
    const j = (await r.json().catch(() => ({}))) as { capture?: CaptureRecord; error?: string };
    setBusy(false);
    if (!r.ok || !j.capture) { setErr(j.error ?? "Could not read that update."); return; }
    setCapture(j.capture);
    setAccept(Object.fromEntries(j.capture.parsed.events.map((_, i) => [i, false])));
    setQty(Object.fromEntries(j.capture.parsed.events.map((e, i) => [i, String(e.qty)])));
  }

  async function confirm() {
    if (!capture) return;
    setBusy(true);
    setErr("");
    const indexes = Object.entries(accept).filter(([, v]) => v).map(([k]) => Number(k));
    const corrections = indexes
      .map((i) => ({ index: i, qty: Number(qty[i]) }))
      .filter((c) => Number.isFinite(c.qty) && c.qty > 0);
    const r = await fetch("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm", id: capture.id, accept: indexes, corrections }),
    });
    const j = (await r.json().catch(() => ({}))) as { applied?: string[]; error?: string };
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? "Could not record those events."); return; }
    setCapture(null);
    setText("");
    setMsg(`Recorded ${j.applied?.length ?? 0} event(s) in the ledger.`);
    router.refresh();
  }

  async function reject() {
    if (!capture) return;
    setBusy(true);
    await fetch("/api/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reject", id: capture.id }) });
    setBusy(false);
    setCapture(null);
    setText("");
    router.refresh();
  }

  const toggle = (e: ProposedEvent, i: number) => {
    const blocked = e.claims.some((c) => c.status === "MISSING" || c.status === "CONFLICTING") || !e.productId || !(Number(qty[i]) > 0);
    if (blocked) return;
    setAccept((a) => ({ ...a, [i]: !a[i] }));
  };

  return (
    <div className="space-y-4 text-sm">
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tell me what happened in the shop</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder={EXAMPLE}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button disabled={busy || !text.trim()} onClick={submit} className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "Reading…" : "Read it"}
          </button>
          <button disabled={busy} onClick={startVoice} className="rounded-lg border border-slate-300 px-3.5 py-2 font-medium text-slate-700 hover:bg-slate-50">🎤 Speak instead</button>
          <button onClick={() => setText(EXAMPLE)} className="rounded-lg px-3 py-2 text-slate-500 underline">Use example</button>
        </div>
        <p className="mt-1 text-xs text-slate-500">{msg}</p>
      </div>

      {capture && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Proposed events — confirm before anything is recorded</div>
          <p className="text-xs text-slate-500">Source text: “{capture.rawText}”</p>
          {capture.parsed.events.length === 0 && <p className="text-slate-600">I could not find any product in that message, so I have nothing to propose. Nothing was recorded.</p>}
          {capture.parsed.events.map((e, i) => {
            const blocked = e.claims.some((c) => c.status === "MISSING" || c.status === "CONFLICTING") || !e.productId;
            return (
              <div key={i} className={cn("rounded-lg border p-3", blocked ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white")}>
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={!!accept[i]} disabled={blocked || busy} onChange={() => toggle(e, i)} />
                  <div className="flex-1">
                    <div className="font-semibold text-slate-900">
                      {blocked ? "Cannot record this line" : `${e.kind === "stock_count" ? "Count" : e.kind === "receipt" ? "Receive" : e.kind === "sale" ? "Sold" : e.kind === "return" ? "Return" : "Adjust"} ${qty[i] || "?"} × ${e.productName || "unknown product"}`}
                    </div>
                    <div className="text-xs text-slate-500">From: “{e.evidenceText}” · date {e.at}{e.match === "fuzzy" && " · product matched partially"}</div>
                    <ul className="mt-2 space-y-1">
                      {e.claims.map((c, k) => (
                        <li key={k} className="flex flex-wrap items-start gap-1.5 text-xs">
                          <ClaimStatusBadge status={c.status} />
                          <span className="font-medium text-slate-600">{c.field}:</span>
                          <span className="text-slate-600">{c.reason}</span>
                        </li>
                      ))}
                    </ul>
                    {blocked && (
                      <div className="mt-2">
                        <label className="text-xs font-semibold uppercase text-slate-500">Correct the quantity</label>
                        <input
                          type="number"
                          min={1}
                          value={qty[i] ?? ""}
                          onChange={(e) => setQty((q) => ({ ...q, [i]: e.target.value }))}
                          className="ml-2 w-24 rounded border border-slate-300 px-2 py-1"
                        />
                        <span className="ml-2 text-xs text-slate-500">{e.needsInfo.join(" ")}</span>
                      </div>
                    )}
                  </div>
                </label>
              </div>
            );
          })}
          {capture.parsed.unresolved.length > 0 && (
            <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
              I could not match these to a product, so I ignored them (nothing was recorded): “{capture.parsed.unresolved.join("”, “")}”
            </p>
          )}
          <div className="flex gap-2">
            <button disabled={busy || !Object.values(accept).some(Boolean)} onClick={confirm} className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              Record {Object.values(accept).filter(Boolean).length} event(s) in the ledger
            </button>
            <button disabled={busy} onClick={reject} className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Discard</button>
          </div>
        </div>
      )}

      {err && <p className="text-red-600">{err}</p>}
    </div>
  );
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
};