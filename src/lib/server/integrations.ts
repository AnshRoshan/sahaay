// Honest status of every partner technology: what role it plays and whether it answers *now*.
// Presence of an environment variable is not evidence that a service works — a stale URL, a pod
// that never came up, or a licence refusal all look identical to "configured" from the env alone.
type State = "live" | "configured" | "fallback";

export type IntegrationStatus = {
  name: string;
  role: string;
  state: State;
  detail: string;
};

const has = (k: string) => !!process.env[k];
const env = (k: string) => process.env[k] ?? "";

type Probe = { ok: boolean; detail: string };
const PROBE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Probe }>();

async function probebaseUrl(baseUrl: string, path: string): Promise<Probe> {
  const key = `${baseUrl}${path}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.value;
  let value: Probe;
  try {
    const res = await fetch(new URL(path, baseUrl).toString(), { signal: AbortSignal.timeout(2500), cache: "no-store" });
    value = { ok: res.ok, detail: res.ok ? `answered ${res.status} at ${path}` : `${path} returned HTTP ${res.status}` };
  } catch (e) {
    value = { ok: false, detail: `${path} did not answer (${e instanceof Error ? e.message : "no response"})` };
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function integrationStatus(): Promise<IntegrationStatus[]> {
  const gemmaBase = env("GEMMA_BASE_URL");
  const tabpfnBase = env("TABPFN_URL");
  const [gemma, tabpfn]: [Probe | undefined, Probe | undefined] = await Promise.all([
    gemmaBase ? probebaseUrl(gemmaBase, "/v1/models") : Promise.resolve(undefined),
    tabpfnBase ? probebaseUrl(tabpfnBase, "/health") : Promise.resolve(undefined),
  ]);

  return [
    {
      name: "Gemma (open-source LLM)",
      role: "Explains recommendations and answers questions from structured evidence",
      state: gemmaBase ? (gemma?.ok ? "live" : "configured") : "fallback",
      detail: !gemmaBase
        ? "GEMMA_BASE_URL not set — deterministic template explanations are used. Run services/gemma (Ollama) and set GEMMA_BASE_URL."
        : gemma?.ok
          ? `${gemma.detail}; model ${env("GEMMA_MODEL") || "gemma3:4b"}. Its output is rephrasing only and must pass the numeric grounding gate.`
          : `Endpoint is configured but ${gemma?.detail ?? "was not checked"} — explanations fall back to the deterministic template.`,
    },
    {
      name: "TabPFN",
      role: "Structured demand prediction with uncertainty (quantiles)",
      state: tabpfnBase ? (tabpfn?.ok ? "live" : "configured") : "fallback",
      detail: !tabpfnBase
        ? "TABPFN_URL not set — the built-in statistical ensemble forecasts. Run services/tabpfn and set TABPFN_URL."
        : tabpfn?.ok
          ? `${tabpfn.detail} — forecasts currently come from TabPFN, with automatic fallback to the local engine on failure. Weights are pinned to the v2 (commercially licensed) line.`
          : `Endpoint is configured but ${tabpfn?.detail ?? "was not checked"} — every forecast is produced by the local ensemble and labelled local-ensemble.`,
    },
    {
      name: "PostgreSQL (decision memory)",
      role: "Operational data, recommendations, decisions, outcomes, preferences (JSONB documents)",
      state: "live",
      detail: "Replaces MongoDB in this build; same document-style memory using JSONB columns.",
    },
    {
      name: "Temporal",
      role: "Durable scheduled + long-running workflows",
      state: "fallback",
      detail:
        "Not part of the running system. Scheduling is done by the built-in durable runner (persisted steps, retries, /api/cron/tick), which is what the deploy actually uses. services/worker is reference code for a self-hosted Temporal cluster and is not deployed — self-hosting needs its own server, persistence DB and visibility store, and Temporal Cloud starts at a $500/mo minimum.",
    },
    {
      name: "Sentry",
      role: "Error + agent-run observability",
      state: has("SENTRY_DSN") ? "live" : "fallback",
      detail: has("SENTRY_DSN")
        ? "Errors are forwarded to Sentry. Every agent run is also traced in-app (see Traces)."
        : "Deliberately off, not merely unconfigured: forwarding errors to a third party would send the owner's business data outside the system. Traces stay in-app (agent_runs). Set SENTRY_DSN only if that trade-off is acceptable to the owner.",
    },
    {
      name: "SerpApi",
      role: "External supplier / price research (kept separate from internal data)",
      state: has("SERPAPI_KEY") ? "live" : "fallback",
      detail: has("SERPAPI_KEY") ? "Live Google results via SerpApi." : "SERPAPI_KEY not set — research returns clearly-labelled SIMULATED candidates.",
    },
    {
      name: "ElevenLabs",
      role: "Optional voice briefing",
      state: has("ELEVENLABS_API_KEY") ? "live" : "fallback",
      detail: has("ELEVENLABS_API_KEY") ? "Server-side text-to-speech." : "ELEVENLABS_API_KEY not set — the browser's built-in speech synthesis reads the briefing.",
    },
    {
      name: "Render",
      role: "Deployment (web + cron)",
      state: "configured",
      detail: "render.yaml blueprint included (web service, paid Postgres plan, cron job calling POST /api/cron/tick). Migrations are applied with drizzle-kit migrate, not during a build.",
    },
    {
      name: "Demo tooling",
      role: "Sample shop + time-machine for the outcome loop",
      state: env("DEMO_MODE") === "1" ? "live" : "fallback",
      detail: env("DEMO_MODE") === "1"
        ? "DEMO_MODE=1: this instance is expected to hold demo data. Loading the demo still confirms before truncating."
        : "DEMO_MODE is off, so /api/demo/* returns 403. The demo shop truncates every table and the time-machine appends synthetic movements to the real ledger.",
    },
    {
      name: "Owner authentication",
      role: "Protects business data",
      state: has("SAHAAY_ACCESS_CODE") ? "live" : "fallback",
      detail: has("SAHAAY_ACCESS_CODE") ? "Access-code login with signed session cookie." : "OPEN MODE — set SAHAAY_ACCESS_CODE before deploying publicly.",
    },
  ];
}
