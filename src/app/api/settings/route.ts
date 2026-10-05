import { handle } from "@/lib/server/http";
import { integrationStatus } from "@/lib/server/integrations";
import { loadRules, saveRules } from "@/lib/server/rules";
import type { RuleSet } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => ({ rules: await loadRules(), integrations: await integrationStatus() }));
}

export async function PUT(req: Request) {
  return handle(async () => ({ rules: await saveRules((await req.json()) as Partial<RuleSet>) }));
}
