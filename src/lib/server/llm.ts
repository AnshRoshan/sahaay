// Gemma (open-source) reasoning client. Talks to any OpenAI-compatible endpoint
// (Ollama, vLLM, llama.cpp server, LM Studio). The model only REPHRASES facts the
// deterministic engine produced; any text with an ungrounded number is rejected.
import { checkGrounding } from "@/lib/grounding";
import type { Tracer } from "./observability";

export const llmConfigured = () => !!process.env.GEMMA_BASE_URL;
export const llmModel = () => process.env.GEMMA_MODEL || "gemma3:4b";

const SYSTEM = `You are Sahaay, an assistant that explains business decisions to a small-shop owner.
Rules:
- Use ONLY the facts provided. Never invent, estimate, or recompute numbers.
- Every number you write must appear in the facts.
- Be concise, friendly and plain. No markdown tables. Maximum 120 words.
- If information is missing, say "I don't have enough information" and list what is needed.`;

export async function chatComplete(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  timeoutMs = 15000,
): Promise<string | null> {
  const base = process.env.GEMMA_BASE_URL;
  if (!base) return null;
  const res = await fetch(`${base.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.GEMMA_API_KEY ? { Authorization: `Bearer ${process.env.GEMMA_API_KEY}` } : {}),
    },
    body: JSON.stringify({ model: llmModel(), messages, temperature: 0.2, max_tokens: 400 }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content?.trim() || null;
}

export type GroundedText = {
  text: string;
  source: "gemma" | "template";
  grounding: { ok: boolean; ungrounded: number[]; checked: number } | null;
  note?: string;
};

/** Ask the model to rephrase `facts`; fall back to the deterministic `fallback` text. */
export async function groundedAnswer(args: {
  facts: string;
  fallback: string;
  question?: string;
  tracer?: Tracer;
}): Promise<GroundedText> {
  const { facts, fallback, question, tracer } = args;
  if (!llmConfigured()) return { text: fallback, source: "template", grounding: null, note: "GEMMA_BASE_URL not set — using deterministic template." };
  try {
    const run = async (set: (a: Record<string, unknown>) => void) => {
      set({ model: llmModel() });
      return chatComplete([
        { role: "system", content: SYSTEM },
        { role: "user", content: `FACTS:\n${facts}\n\n${question ? `OWNER QUESTION: ${question}` : "Explain this to the owner."}` },
      ]);
    };
    const out = tracer ? await tracer.span("gemma.generate", run) : await run(() => undefined);
    if (!out) return { text: fallback, source: "template", grounding: null, note: "Empty model response." };
    const g = checkGrounding(out, facts + "\n" + fallback);
    tracer?.note("grounding.check", { ok: g.ok, ungrounded: g.ungrounded });
    if (!g.ok)
      return { text: fallback, source: "template", grounding: g, note: `Rejected model output: ungrounded numbers ${g.ungrounded.join(", ")}.` };
    if (tracer) tracer.model = llmModel();
    return { text: out, source: "gemma", grounding: g };
  } catch (e) {
    return { text: fallback, source: "template", grounding: null, note: `Model unavailable (${e instanceof Error ? e.message : "error"}) — using template.` };
  }
}
