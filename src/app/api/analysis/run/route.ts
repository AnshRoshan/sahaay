import { getDataSummary } from "@/lib/server/data";
import { runAnalysis } from "@/lib/server/engine";
import { handle, HttpError } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
  return handle(async () => {
    const d = await getDataSummary();
    if (!d.hasData) throw new HttpError(422, "No data yet. Import your CSV files or load the demo shop first.");
    return runAnalysis();
  });
}
