import { handle } from "@/lib/server/http";
import { measureOutcomes } from "@/lib/server/outcomes";

export const dynamic = "force-dynamic";

export async function POST() {
  return handle(() => measureOutcomes());
}
