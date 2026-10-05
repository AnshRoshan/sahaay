import { getRecDetail } from "@/lib/server/data";
import { handle, HttpError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => {
    const d = await getRecDetail(id);
    if (!d) throw new HttpError(404, "Not found");
    return d;
  });
}
