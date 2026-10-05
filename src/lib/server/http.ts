import { captureException } from "./observability";
import { isAuthed } from "./auth";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Auth + error envelope for every API route handler. */
export async function handle(
  fn: () => Promise<unknown>,
  opts: { public?: boolean } = {},
): Promise<Response> {
  try {
    if (!opts.public && !(await isAuthed())) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const out = await fn();
    if (out instanceof Response) return out;
    return Response.json(out ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) {
      return Response.json({ error: e.message, ...e.body }, { status: e.status });
    }
    await captureException(e, { kind: "api" });
    return Response.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
