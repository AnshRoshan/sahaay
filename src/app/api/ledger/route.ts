import { handle } from "@/lib/server/http";
import { ledgerOverview } from "@/lib/server/ledger";

export const dynamic = "force-dynamic";

/** Read-only: the ledger is append-only, so it has no write endpoint by design. */
export async function GET() {
  return handle(async () => ledgerOverview());
}