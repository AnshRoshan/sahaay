// Agent observability: span tracing persisted to agent_runs, plus a dependency-free Sentry
// envelope sender (active only when SENTRY_DSN is set).
import { db } from "@/db";
import { agentRuns } from "@/db/schema";

export type Span = {
  name: string;
  startMs: number;
  durationMs: number;
  status: "ok" | "error";
  attrs?: Record<string, unknown>;
  error?: string;
};

function parseDsn(dsn: string) {
  try {
    const u = new URL(dsn);
    return { key: u.username, host: u.host, protocol: u.protocol, projectId: u.pathname.replace(/^\//, "") };
  } catch {
    return null;
  }
}

export async function captureException(err: unknown, extra: Record<string, unknown> = {}): Promise<void> {
  console.error("[sahaay:error]", err instanceof Error ? err.message : err, extra);
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const d = parseDsn(dsn);
  if (!d) return;
  const e = err instanceof Error ? err : new Error(String(err));
  const id = crypto.randomUUID().replace(/-/g, "");
  const event = {
    event_id: id,
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    environment: process.env.NODE_ENV ?? "development",
    tags: { app: "sahaay", ...(typeof extra.kind === "string" ? { kind: extra.kind } : {}) },
    extra,
    exception: { values: [{ type: e.name, value: e.message, stacktrace: { frames: (e.stack ?? "").split("\n").slice(1, 12).map((l) => ({ filename: l.trim() })) } }] },
  };
  const body = [
    JSON.stringify({ event_id: id, sent_at: new Date().toISOString(), dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
  try {
    await fetch(`${d.protocol}//${d.host}/api/${d.projectId}/envelope/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=sahaay/1.0, sentry_key=${d.key}`,
      },
      body,
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    /* never let telemetry break the app */
  }
}

export class Tracer {
  id = `run_${crypto.randomUUID().slice(0, 12)}`;
  spans: Span[] = [];
  model: string | null = null;
  private t0 = Date.now();
  constructor(public kind: string, public input: string) {}

  async span<T>(
    name: string,
    fn: (set: (attrs: Record<string, unknown>) => void) => Promise<T> | T,
  ): Promise<T> {
    const start = Date.now();
    const span: Span = { name, startMs: start - this.t0, durationMs: 0, status: "ok" };
    this.spans.push(span);
    const set = (a: Record<string, unknown>) => (span.attrs = { ...span.attrs, ...a });
    try {
      return await fn(set);
    } catch (e) {
      span.status = "error";
      span.error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      span.durationMs = Date.now() - start;
    }
  }

  note(name: string, attrs?: Record<string, unknown>) {
    this.spans.push({ name, startMs: Date.now() - this.t0, durationMs: 0, status: "ok", attrs });
  }

  async finish(status: "ok" | "error", output: Record<string, unknown> | null, error?: unknown) {
    const msg = error ? (error instanceof Error ? error.message : String(error)) : null;
    if (error) await captureException(error, { kind: this.kind, runId: this.id, input: this.input.slice(0, 200) });
    try {
      await db.insert(agentRuns).values({
        id: this.id,
        kind: this.kind,
        input: this.input.slice(0, 2000),
        status,
        spans: this.spans,
        output,
        error: msg,
        model: this.model,
        durationMs: Date.now() - this.t0,
      });
    } catch (e) {
      console.error("[sahaay] failed to persist agent run", e);
    }
  }
}
