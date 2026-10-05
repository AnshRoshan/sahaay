import { getWorkflowData } from "@/lib/server/data";
import { handle } from "@/lib/server/http";
import { ensureSchedules } from "@/lib/server/workflows";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await ensureSchedules();
    return getWorkflowData();
  });
}
