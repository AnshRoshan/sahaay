import { generateDemoCsvs } from "@/lib/demo-data";
import { handle, HttpError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  return handle(async () => {
    const b = generateDemoCsvs();
    const map: Record<string, string> = { "sales.csv": b.sales, "inventory.csv": b.inventory, "products.csv": b.products, "suppliers.csv": b.suppliers };
    const body = map[kind];
    if (!body) throw new HttpError(404, "Unknown sample file");
    return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${kind}"` } });
  });
}
