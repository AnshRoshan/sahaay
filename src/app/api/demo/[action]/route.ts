import { handle, HttpError } from "@/lib/server/http";
import { runAnalysis } from "@/lib/server/engine";
import { loadDemo } from "@/lib/server/demo";
import { measureOutcomes, simulateDays } from "@/lib/server/outcomes";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return handle(async () => {
    if (action === "load") return loadDemo();
    if (action === "simulate") {
      const b = (await req.json().catch(() => ({}))) as { days?: number };
      const sim = await simulateDays(b.days ?? 7);
      const outcomes = await measureOutcomes();
      const analysis = await runAnalysis();
      return { simulation: sim, outcomes, analysis };
    }
    throw new HttpError(404, "Unknown demo action");
  });
}
