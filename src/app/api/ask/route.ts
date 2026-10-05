import { runAgent } from "@/lib/server/agent";
import { handle, HttpError } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json().catch(() => ({}))) as { message?: string; context?: { recommendationId?: string; productId?: string } };
    const message = (b.message ?? "").trim();
    if (!message) throw new HttpError(400, "message is required");
    if (message.length > 1000) throw new HttpError(400, "message too long");
    return runAgent(message, b.context ?? {});
  });
}
