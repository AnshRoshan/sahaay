import { handle, HttpError } from "@/lib/server/http";
import { WORKFLOWS, runWorkflow } from "@/lib/server/workflows";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Called by the UI ("Run now") and by Temporal activities (trigger=temporal).
export async function POST(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  return handle(async () => {
    if (!WORKFLOWS[name]) throw new HttpError(404, "Unknown workflow");
    const trig = new URL(req.url).searchParams.get("trigger");
    return runWorkflow(name, trig === "temporal" ? "temporal" : "manual");
  });
}
