import { handle } from "@/lib/server/http";
import { approveFundedPlan } from "@/lib/server/memory";

export const dynamic = "force-dynamic";

/**
 * Approve the funded whole-shop cash plan. Every order still passes the individual decide()
 * gate (re-validated, blocked refused, warnings never auto-confirmed); this endpoint only
 * orchestrates the approvals the owner just explicitly requested.
 */
export async function POST() {
  return handle(() => approveFundedPlan());
}
