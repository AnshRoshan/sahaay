// Event ledger persistence + derived inventory. The only writer of ledger events.
// Rule: events are append-only. There is no update/delete path here on purpose — a correction
// is a new event, so the reason a quantity is what it is is always reconstructable.
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { detectConflicts, reduceEvents, summarise, type LedgerEvent, type LedgerState } from "@/lib/ledger";
import { getAsOf } from "./engine";
import { HttpError } from "./http";

export type LedgerRow = typeof s.ledgerEvents.$inferSelect;

export function toLedgerEvent(r: LedgerRow): LedgerEvent {
  return {
    id: r.id,
    productId: r.productId,
    kind: r.kind as LedgerEvent["kind"],
    qty: r.qty,
    at: r.at,
    source: r.source as LedgerEvent["source"],
    note: r.note ?? undefined,
    ref: r.ref ?? undefined,
  };
}

export async function listEvents(opts: { productId?: string; limit?: number } = {}): Promise<LedgerEvent[]> {
  const rows = opts.productId
    ? await db.select().from(s.ledgerEvents).where(eq(s.ledgerEvents.productId, opts.productId)).orderBy(desc(s.ledgerEvents.at), desc(s.ledgerEvents.id)).limit(opts.limit ?? 200)
    : await db.select().from(s.ledgerEvents).orderBy(desc(s.ledgerEvents.at), desc(s.ledgerEvents.id)).limit(opts.limit ?? 200);
  return rows.map(toLedgerEvent);
}

/** `id` is optional: callers may supply a deterministic id (e.g. derived from the capture id). */
export async function appendEvents(events: (Omit<LedgerEvent, "id"> & { id?: string })[]): Promise<string[]> {
  if (!events.length) return [];
  const withIds = events.map((e, i) => ({ ...e, id: e.id ?? `ev_${crypto.randomUUID().slice(0, 12)}_${i}` }));
  // A duplicate id would mean a double-apply; refuse rather than overwrite an existing event.
  const ids = withIds.map((e) => e.id);
  const clash = await db.select({ id: s.ledgerEvents.id }).from(s.ledgerEvents).where(sql`${s.ledgerEvents.id} in ${ids}`);
  if (clash.length) throw new HttpError(409, `Event(s) already exist: ${clash.map((c) => c.id).join(", ")}. Ledger events are immutable.`);
  await db.insert(s.ledgerEvents).values(withIds);
  return ids;
}

/** Derived quantity per product, folded from events only. */
export async function derivedStock(asOf?: string): Promise<Record<string, { quantity: number; events: number }>> {
  const rows = await db.select().from(s.ledgerEvents);
  const state = reduceEvents(rows.map(toLedgerEvent), asOf);
  const out: Record<string, { quantity: number; events: number }> = {};
  for (const [k, v] of state) out[k] = { quantity: v.quantity, events: v.eventCount };
  return out;
}

export async function ledgerStateFor(productId: string): Promise<LedgerState | undefined> {
  const rows = await db.select().from(s.ledgerEvents).where(eq(s.ledgerEvents.productId, productId));
  return reduceEvents(rows.map(toLedgerEvent)).get(productId);
}

export type LedgerOverview = ReturnType<typeof summarise> & {
  asOf: string;
  recent: (LedgerEvent & { productName: string })[];
  states: (LedgerState & { productName: string })[];
};

/**
 * A CSV inventory export is a full snapshot, so it becomes a `stock_count` baseline event
 * rather than a silent overwrite of the quantity. The previous baseline is kept in history.
 */
export async function recordCountBaseline(rows: { productId: string; qty: number }[], at: string, source: "csv" | "owner", ref: string): Promise<number> {
  const events: Omit<LedgerEvent, "id">[] = rows.map((r, i) => ({
    id: `${ref}_count_${i}`,
    productId: r.productId,
    kind: "stock_count",
    qty: r.qty,
    at,
    source,
    note: "Full inventory snapshot from export",
    ref,
  }));
  const ids = await appendEvents(events);
  return ids.length;
}

export async function ledgerOverview(limit = 25): Promise<LedgerOverview> {
  const [rows, prods, asOf] = await Promise.all([
    db.select().from(s.ledgerEvents).orderBy(desc(s.ledgerEvents.at), desc(s.ledgerEvents.id)).limit(limit),
    db.select({ id: s.products.id, name: s.products.name }).from(s.products),
    getAsOf(),
  ]);
  const events = rows.map(toLedgerEvent);
  const names = new Map(prods.map((p) => [p.id, p.name]));
  const all = (await db.select().from(s.ledgerEvents)).map(toLedgerEvent);
  const state = reduceEvents(all, asOf);
  return {
    ...summarise(all, asOf),
    asOf,
    recent: events.map((e) => ({ ...e, productName: names.get(e.productId) ?? e.productId })),
    states: [...state.values()]
      .map((s2) => ({ ...s2, productName: names.get(s2.productId) ?? s2.productId }))
      .sort((a, b) => a.productId.localeCompare(b.productId)),
  };
}

export { detectConflicts };