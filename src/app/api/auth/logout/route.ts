import { cookies } from "next/headers";
import { COOKIE } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST() {
  return handle(async () => {
    (await cookies()).delete(COOKIE);
    return { ok: true };
  }, { public: true });
}
