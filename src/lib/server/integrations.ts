// Honest status of every partner technology: what role it plays and whether it is live here.
export type IntegrationStatus = {
  name: string;
  role: string;
  state: "live" | "configured" | "fallback";
  detail: string;
};

const has = (k: string) => !!process.env[k];

export function integrationStatus(): IntegrationStatus[] {
  return [
    {
      name: "Gemma (open-source LLM)",
      role: "Explains recommendations and answers questions from structured evidence",
      state: has("GEMMA_BASE_URL") ? "configured" : "fallback",
      detail: has("GEMMA_BASE_URL")
        ? `Endpoint set, model ${process.env.GEMMA_MODEL || "gemma3:4b"}. Output passes a numeric grounding gate.`
        : "GEMMA_BASE_URL not set — deterministic template explanations are used. Run services/gemma (Ollama) and set GEMMA_BASE_URL.",
    },
    {
      name: "TabPFN",
      role: "Structured demand prediction with uncertainty (quantiles)",
      state: has("TABPFN_URL") ? "configured" : "fallback",
      detail: has("TABPFN_URL")
        ? "Forecasts call the TabPFN service; automatic fallback to the local engine on failure."
        : "TABPFN_URL not set — the built-in statistical ensemble forecasts. Run services/tabpfn and set TABPFN_URL.",
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
      state: has("TEMPORAL_ADDRESS") ? "configured" : "fallback",
      detail: has("TEMPORAL_ADDRESS")
        ? "Address set. Run services/worker; Temporal Schedules call /api/workflows/{name}/run with retry policies."
        : "Built-in durable runner (persisted steps + retries) and /api/cron/tick. Temporal worker provided in services/worker.",
    },
    {
      name: "Sentry",
      role: "Error + agent-run observability",
      state: has("SENTRY_DSN") ? "live" : "fallback",
      detail: has("SENTRY_DSN")
        ? "Errors are forwarded to Sentry. Every agent run is also traced in-app (see Traces)."
        : "SENTRY_DSN not set — traces are stored in-app (agent_runs). Set SENTRY_DSN to forward errors.",
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
      detail: "render.yaml blueprint included (web service, Postgres, cron job calling /api/cron/tick).",
    },
    {
      name: "Owner authentication",
      role: "Protects business data",
      state: has("SAHAAY_ACCESS_CODE") ? "live" : "fallback",
      detail: has("SAHAAY_ACCESS_CODE") ? "Access-code login with signed session cookie." : "OPEN MODE — set SAHAAY_ACCESS_CODE before deploying publicly.",
    },
  ];
}
