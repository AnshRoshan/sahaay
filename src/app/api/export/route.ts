// Data ownership export: the owner's business truth leaves the system the same way it can
// enter — as data. Every business table plus the decision memory, as one JSON download.
import { db } from "@/db";
import * as s from "@/db/schema";
import { handle } from "@/lib/server/http";
import { todayStr } from "@/lib/dates";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const [
      products, suppliers, supplierOffers, sales, inventory, ledgerEvents, captures,
      decisions, outcomes, preferences, businessRules,
    ] = await Promise.all([
      db.select().from(s.products),
      db.select().from(s.suppliers),
      db.select().from(s.supplierOffers),
      db.select().from(s.sales),
      db.select().from(s.inventory),
      db.select().from(s.ledgerEvents),
      db.select().from(s.captures),
      db.select().from(s.decisions),
      db.select().from(s.outcomes),
      db.select().from(s.preferences),
      db.select().from(s.businessRules),
    ]);
    const body = {
      exportedAt: new Date().toISOString(),
      asOf: todayStr(),
      format: "sahaay-export/v1",
      note: "Full export of business truth and decision memory. ledger_events is the source of record: current stock is derived by folding these events, never written directly.",
      tables: { products, suppliers, supplierOffers, sales, inventory, ledgerEvents, captures, decisions, outcomes, preferences, businessRules },
      counts: {
        products: products.length, suppliers: suppliers.length, supplierOffers: supplierOffers.length,
        sales: sales.length, inventory: inventory.length, ledgerEvents: ledgerEvents.length,
        captures: captures.length, decisions: decisions.length, outcomes: outcomes.length,
      },
    };
    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="sahaay-export-${todayStr()}.json"`,
      },
    });
  });
}
