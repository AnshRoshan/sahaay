// Owner authentication. If SAHAAY_ACCESS_CODE is set, every page and API (except /api/health)
// requires a signed session cookie. If unset the app runs in clearly-labelled open mode.
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const COOKIE = "sahaay_session";

const secret = (): string => {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    // The dev fallback is public in the repository, so a production instance without a
    // SESSION_SECRET would let anyone mint a valid owner cookie.
    throw new Error("SESSION_SECRET is not set. Refusing to sign sessions in production with the development fallback secret.");
  }
  return "sahaay-dev-secret-change-me";
};
export const authRequired = () => !!process.env.SAHAAY_ACCESS_CODE;

export function tokenFor(code: string): string {
  return createHmac("sha256", secret()).update(code).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function verifyCode(code: string): boolean {
  const expected = process.env.SAHAAY_ACCESS_CODE;
  return !!expected && safeEqual(tokenFor(code), tokenFor(expected));
}

export async function isAuthed(): Promise<boolean> {
  if (!authRequired()) return true;
  const c = (await cookies()).get(COOKIE)?.value;
  return !!c && safeEqual(c, tokenFor(process.env.SAHAAY_ACCESS_CODE!));
}
