import { handle, HttpError } from "@/lib/server/http";
import { isAuthed } from "@/lib/server/auth";
import { tick } from "@/lib/server/workflows";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Render Cron Job / Temporal Schedule hits this every few minutes with CRON_SECRET.
async function run(req: Request) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    const bearer = req.headers.get("authorization") === `Bearer ${secret}`;
    if (!(secret && bearer) && !(await isAuthed())) throw new HttpError(401, "Unauthorized");
    return tick();
  }, { public: true });
}
export const POST = run;
export const GET = run;
