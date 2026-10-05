import { runSafetyCases } from "@/lib/evals";
import { getForecastEvaluation } from "@/lib/server/data";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const safety = runSafetyCases();
    return { safety, passed: safety.filter((c) => c.pass).length, total: safety.length, forecast: await getForecastEvaluation() };
  });
}
