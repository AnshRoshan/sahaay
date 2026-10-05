import { cookies } from "next/headers";
import { COOKIE, authRequired, tokenFor, verifyCode } from "@/lib/server/auth";
import { handle, HttpError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    if (!authRequired()) return { ok: true, mode: "open" };
    const { code } = (await req.json().catch(() => ({}))) as { code?: string };
    if (!code || !verifyCode(code)) {
      await new Promise((r) => setTimeout(r, 400)); // slow down guessing
      throw new HttpError(401, "Incorrect access code");
    }
    const https = req.headers.get("x-forwarded-proto") === "https";
    (await cookies()).set(COOKIE, tokenFor(code), { httpOnly: true, sameSite: "lax", secure: https, path: "/", maxAge: 60 * 60 * 24 * 14 });
    return { ok: true };
  }, { public: true });
}
