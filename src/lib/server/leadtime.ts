// Server glue for lead-time learning: turns recorded decisions into pairs, then into numbers.
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, isNotNull } from "drizzle-orm";
import { learnLeadTimes, type LeadTimePair, type SupplierLeadTime } from "@/lib/leadtime";

type DecisionRow = {
  productId: string | null;
  supplierId: string | null;
  orderedAtDate: string | null;
  arrivedAt: string | null;
  leadTimeDays: number | null;
};

/**
 * Only a decision with both ends recorded is a measurement. The demo time-machine sets `arrivedAt`
 * without `orderedAtDate`, so synthetic arrivals never become a "measured" supplier.
 */
export function pairsFromDecisions(rows: DecisionRow[]): LeadTimePair[] {
  const out: LeadTimePair[] = [];
  for (const d of rows) {
    if (!d.supplierId || !d.productId || !d.orderedAtDate || !d.arrivedAt) continue;
    out.push({ supplierId: d.supplierId, productId: d.productId, orderedAt: d.orderedAtDate, receivedAt: d.arrivedAt, promisedDays: d.leadTimeDays });
  }
  return out;
}

export async function learnedLeadTimes(): Promise<Map<string, SupplierLeadTime>> {
  const rows = await db
    .select({
      productId: s.decisions.productId,
      supplierId: s.decisions.supplierId,
      orderedAtDate: s.decisions.orderedAtDate,
      arrivedAt: s.decisions.arrivedAt,
      leadTimeDays: s.decisions.leadTimeDays,
    })
    .from(s.decisions)
    .where(and(isNotNull(s.decisions.orderedAtDate), isNotNull(s.decisions.arrivedAt), isNotNull(s.decisions.supplierId)));
  return learnLeadTimes(pairsFromDecisions(rows));
}
