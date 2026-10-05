import { handle, HttpError } from "@/lib/server/http";
import { safeEqual } from "@/lib/server/auth";
import { tick } from "@/lib/server/workflows";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Render Cron Job / Temporal Schedule hits this every few minutes with CRON_SECRET.
// A session cookie is deliberately not accepted here: the scheduler has no session, and
// falling back to "is this a logged-in browser?" silently meant that an instance with no
// CRON_SECRET and no access code let any anonymous visitor run the whole workflow chain.
async function run(req: Request) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new HttpError(503, "CRON_SECRET is not set, so scheduled callers cannot be authenticated. Set it in the deployment rather than leaving this endpoint open.");
    const bearer = req.headers.get("authorization") ?? "";
    if (!safeEqual(bearer, `Bearer ${secret}`)) throw new HttpError(401, "Unauthorized");
    return tick();
  }, { public: true });
}

export const POST = run;
