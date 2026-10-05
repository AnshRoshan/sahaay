import { listRecs } from "@/lib/server/data";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const st = new URL(req.url).searchParams.get("status");
    return { recommendations: await listRecs(st ? st.split(",") : undefined) };
  });
}
