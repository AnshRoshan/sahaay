import { handle, HttpError } from "@/lib/server/http";
import { runAnalysis } from "@/lib/server/engine";
import { loadDemo } from "@/lib/server/demo";
import { measureOutcomes, simulateDays } from "@/lib/server/outcomes";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// The demo shop and the time-machine write synthetic sales and receipts into the *same* tables as
// real business truth. On an instance holding the owner's real data that is corruption, so both
// actions stay behind an explicit switch and the deploy default is off.
const demoEnabled = () => process.env.DEMO_MODE === "1";

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return handle(async () => {
    if (!demoEnabled()) throw new HttpError(403, "Demo tooling is switched off. Set DEMO_MODE=1 on an instance that holds demo data only — the time-machine appends synthetic movements to the real ledger.");
    const body = (await req.json().catch(() => ({}))) as { days?: number; confirm?: boolean };
    if (action === "load") return loadDemo({ confirm: !!body.confirm });
    if (action === "simulate") {
      const sim = await simulateDays(body.days ?? 7);
      const outcomes = await measureOutcomes();
      const analysis = await runAnalysis();
      return { simulation: sim, outcomes, analysis };
    }
    throw new HttpError(404, "Unknown demo action");
  });
}
