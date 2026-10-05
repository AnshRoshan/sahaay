import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { explainTemplate, factsText, type ExplainableRec } from "@/lib/explain";
import type { Action } from "@/lib/types";
import { HttpError, handle } from "@/lib/server/http";
import { groundedAnswer } from "@/lib/server/llm";
import { decide, getRecOr404, markExecuted, previewValidation, type DecideBody } from "@/lib/server/memory";
import { Tracer } from "@/lib/server/observability";
import { researchSuppliers } from "@/lib/server/research";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    switch (action) {
      case "decision": {
        const d = body.decision;
        if (d !== "approved" && d !== "modified" && d !== "rejected") throw new HttpError(400, "decision must be approved | modified | rejected");
        return decide(id, body as unknown as DecideBody);
      }
      case "validate":
        return { validation: await previewValidation(id, Number(body.quantity), body.supplierId as string | undefined) };
      case "execute":
        return { recommendation: await markExecuted(id) };
      case "research": {
        const rec = await getRecOr404(id);
        if (!rec.productId) throw new HttpError(422, "Research needs a product");
        const [p] = await db.select().from(s.products).where(eq(s.products.id, rec.productId));
        const t = new Tracer("research", `supplier research: ${p?.name}`);
        try {
          const r = await t.span("tool:serpapi.research", async (set) => {
            const out = await researchSuppliers(p?.name ?? rec.productId!);
            set({ provider: out.provider, items: out.items.length, simulated: out.simulated });
            return out;
          });
          await db.update(s.recommendations).set({ research: r as unknown as Record<string, unknown> }).where(eq(s.recommendations.id, id));
          await t.finish("ok", { items: r.items.length });
          return { research: r };
        } catch (e) {
          await t.finish("error", null, e);
          throw new HttpError(502, `External research failed: ${e instanceof Error ? e.message : "error"}`);
        }
      }
      case "explain": {
        const rec = await getRecOr404(id);
        const ex: ExplainableRec = {
          title: rec.title, type: rec.type, summary: rec.summary, confidence: rec.confidence, abstain: rec.abstain,
          needsInfo: rec.needsInfo, evidence: rec.evidence as ExplainableRec["evidence"], action: rec.action as unknown as Action,
          risks: rec.risks as ExplainableRec["risks"], alternatives: rec.alternatives as unknown as Action[],
          calculation: rec.calculation as unknown as ExplainableRec["calculation"],
        };
        const t = new Tracer("explain", `explain ${rec.title}`);
        const out = await groundedAnswer({ facts: factsText(ex), fallback: explainTemplate(ex), tracer: t });
        await db.update(s.recommendations).set({ explanation: out.text, explanationSource: out.source }).where(eq(s.recommendations.id, id));
        await t.finish("ok", { source: out.source });
        return out;
      }
      default:
        throw new HttpError(404, "Unknown action");
    }
  });
}
