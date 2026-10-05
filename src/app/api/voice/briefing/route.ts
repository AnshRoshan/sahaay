import { buildBriefing } from "@/lib/server/briefing";
import { handle } from "@/lib/server/http";
import { captureException } from "@/lib/server/observability";

export const dynamic = "force-dynamic";

// Optional ElevenLabs voice. Without a key, the client falls back to browser speech synthesis.
export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json().catch(() => ({}))) as { text?: string };
    const text = (b.text ?? (await buildBriefing()).spoken).slice(0, 1500);
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return Response.json({ provider: "browser", text }, { status: 501 });
    try {
      const voice = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}`);
      return new Response(await res.arrayBuffer(), { headers: { "Content-Type": "audio/mpeg" } });
    } catch (e) {
      await captureException(e, { kind: "voice" });
      return Response.json({ provider: "browser", text, error: "ElevenLabs unavailable" }, { status: 501 });
    }
  });
}
