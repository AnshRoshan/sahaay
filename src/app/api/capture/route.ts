import { captureMessage, confirmCapture, listCaptures, rejectCapture, type ConfirmBody } from "@/lib/server/capture";
import { handle, HttpError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET: recent captures. POST: parse a new typed/spoken message into proposed events. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { action?: string; text?: string; channel?: "message" | "voice"; id?: string; accept?: number[]; corrections?: ConfirmBody["corrections"] };
    if (body.action === "confirm") {
      if (!body.id) throw new HttpError(400, "id is required");
      if (!Array.isArray(body.accept)) throw new HttpError(400, "accept must be an array of line indexes");
      return confirmCapture(body.id, { accept: body.accept, corrections: body.corrections });
    }
    if (body.action === "reject") {
      if (!body.id) throw new HttpError(400, "id is required");
      return rejectCapture(body.id);
    }
    if (!body.text) throw new HttpError(400, "text is required");
    return { capture: await captureMessage(body.text, body.channel ?? "message") };
  });
}

export async function GET() {
  return handle(async () => ({ captures: await listCaptures() }));
}