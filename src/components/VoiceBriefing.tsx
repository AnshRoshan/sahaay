"use client";
import { useState } from "react";

export default function VoiceBriefing({ spoken }: { spoken: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  async function play() {
    setState("loading");
    try {
      const res = await fetch("/api/voice/briefing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: spoken }) });
      if (res.ok && res.headers.get("content-type")?.includes("audio")) {
        const url = URL.createObjectURL(await res.blob());
        const a = new Audio(url);
        a.onended = () => setState("idle");
        setState("playing");
        await a.play();
        return;
      }
    } catch { /* fall through to browser voice */ }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(spoken);
      u.lang = "en-IN";
      u.onend = () => setState("idle");
      setState("playing");
      window.speechSynthesis.speak(u);
    } else setState("idle");
  }
  return (
    <button onClick={play} disabled={state === "loading"} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50">
      {state === "loading" ? "Preparing…" : state === "playing" ? "🔊 Playing…" : "🔊 Play voice briefing"}
    </button>
  );
}
