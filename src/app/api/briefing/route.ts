import { buildBriefing } from "@/lib/server/briefing";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => buildBriefing());
}
