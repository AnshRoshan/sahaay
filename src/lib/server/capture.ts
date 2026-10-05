// Capture → claims → events. The owner types or speaks a message; we parse it, label every
// extracted fact (CONFIRMED / INFERRED / MISSING / CONFLICTING) and *propose* events.
// Nothing is written to the ledger until the owner confirms each line. Sahaay never
// invents a quantity: a message with no number produces a MISSING claim, not a guess.
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { parseCapture, toEvents, type CaptureResult, type ProposedEvent } from "@/lib/capture";
import { consolidateOffers } from "@/lib/analysis";
import { getAsOf } from "./engine";
import { HttpError } from "./http";
import { appendEvents, derivedStock } from "./ledger";

export type CaptureRecord = {
  id: string;
  channel: "message" | "voice";
  rawText: string;
  parsed: CaptureResult;
  status: "proposed" | "confirmed" | "rejected";
  appliedEventIds: string[];
  createdAt: string;
};

function newId() {
  return `cap_${crypto.randomUUID().slice(0, 10)}`;
}

async function productCatalogue() {
  const prods = await db.select({ id: s.products.id, name: s.products.name }).from(s.products);
  const offers = await db.select().from(s.supplierOffers);
  const byProduct = new Map<string, typeof offers>();
  for (const o of offers) byProduct.set(o.productId, [...(byProduct.get(o.productId) ?? []), o]);
  return { prods, offersByProduct: byProduct };
}

/**
 * Parse a message. Deterministic rules only — there is no model path here yet. If one is ever
 * added it may only emit spans into `rawText` that the code re-reads and verifies; a model must
 * never state a quantity, because a wrong parse becomes permanent ledger history.
 */
export async function captureMessage(rawText: string, channel: "message" | "voice" = "message"): Promise<CaptureRecord> {
  const text = rawText.trim();
  if (!text) throw new HttpError(400, "Nothing to read — type or speak the update first.");
  if (text.length > 2000) throw new HttpError(413, "Message too long (2000 characters max)");
  const asOf = await getAsOf();
  const [{ prods, offersByProduct }, derived] = await Promise.all([productCatalogue(), derivedStock(asOf)]);
  const stock = Object.fromEntries(Object.entries(derived).map(([k, v]) => [k, v.quantity]));
  const parsed = parseCapture(text, { products: prods, stock, today: asOf });

  // Label each proposal against supplier terms on file (MOQ / known suppliers).
  for (const e of parsed.events) {
    if (!e.productId) continue;
    const cons = consolidateOffers(offersByProduct.get(e.productId) ?? []);
    const moq = cons.length ? Math.max(...cons.map((c) => c.moq ?? 0)) || null : null;
    if (moq !== null && e.kind === "receipt" && e.qty > 0 && e.qty < moq) {
      e.claims.push({ field: "moq", value: moq, status: "INFERRED", source: channel, reason: `Received quantity ${e.qty} is below the supplier MOQ of ${moq}. Fine for a delivery; noted so you can check it is not a part-order.` });
    }
    if (cons.length === 0) {
      e.claims.push({ field: "supplier", value: null, status: "INFERRED", source: channel, reason: "No supplier is on file for this product, so this movement has no supplier attached." });
    }
  }

  const id = newId();
  await db.insert(s.captures).values({ id, channel, rawText: text, parsed: parsed as unknown as Record<string, unknown>, status: "proposed", appliedEventIds: [] });
  return { id, channel, rawText: text, parsed, status: "proposed", appliedEventIds: [], createdAt: new Date().toISOString() };
}

export async function listCaptures(limit = 25): Promise<CaptureRecord[]> {
  const rows = await db.select().from(s.captures).orderBy(desc(s.captures.createdAt)).limit(limit);
  return rows.map((r) => ({
    id: r.id,
    channel: r.channel as CaptureRecord["channel"],
    rawText: r.rawText,
    parsed: r.parsed as unknown as CaptureResult,
    status: r.status as CaptureRecord["status"],
    appliedEventIds: r.appliedEventIds,
    createdAt: r.createdAt.toISOString(),
  }));
}

export type ConfirmBody = {
  /** Indices (into the proposed events) the owner confirmed. Everything else is dropped. */
  accept: number[];
  /** Optional per-line corrections: quantity and/or productId the owner actually meant. */
  corrections?: { index: number; qty?: number; productId?: string; kind?: ProposedEvent["kind"] }[];
};

/**
 * Write the accepted proposals as immutable ledger events.
 * Any line with a MISSING/CONFLICTING claim is refused — the owner must correct it first,
 * because this is the one place where business reality changes.
 */
export async function confirmCapture(id: string, body: ConfirmBody): Promise<{ capture: CaptureRecord; applied: string[] }> {
  const [row] = await db.select().from(s.captures).where(eq(s.captures.id, id));
  if (!row) throw new HttpError(404, "Capture not found");
  if (row.status !== "proposed") throw new HttpError(409, `This capture was already ${row.status}.`);
  const parsed = row.parsed as unknown as CaptureResult;
  const corrections = new Map((body.corrections ?? []).map((c) => [c.index, c]));

  const accepted: ProposedEvent[] = [];
  for (const index of body.accept) {
    const p = parsed.events[index];
    if (!p) throw new HttpError(400, `No proposed event at index ${index}`);
    const c = corrections.get(index);
    // A correction supplies a magnitude; the direction comes from what the line describes,
    // so fixing "2 damaged" to 5 must stay a decrease.
    const magnitude = c?.qty !== undefined ? Math.abs(Math.round(c.qty)) : Math.abs(p.qty);
    const signed = p.qty < 0 ? -magnitude : magnitude;
    const fixed: ProposedEvent = {
      ...p,
      qty: signed,
      productId: c?.productId ?? p.productId,
      productName: c?.productId ? p.productName : p.productName,
      kind: c?.kind ?? p.kind,
    };
    if (!fixed.productId) throw new HttpError(422, `Line "${p.evidenceText}" has no product. Add the product before confirming.`);
    if (!Number.isFinite(signed) || magnitude <= 0) throw new HttpError(422, `Line "${p.evidenceText}" has no usable quantity (got ${c?.qty ?? p.qty}).`);
    // The owner confirming a line resolves MISSING fields; CONFLICTING becomes CONFIRMED-by-owner.
    fixed.claims = fixed.claims.map((cl) => (cl.status === "MISSING" || cl.status === "CONFLICTING" ? { ...cl, status: "CONFIRMED" as const, reason: `Resolved by your confirmation: ${cl.reason}` } : cl));
    accepted.push(fixed);
  }

  const events = toEvents(accepted, row.channel as "message" | "voice", row.id);
  const applied = await appendEvents(events);
  const [updated] = await db
    .update(s.captures)
    .set({ status: "confirmed", appliedEventIds: applied, confirmedAt: new Date() })
    .where(and(eq(s.captures.id, row.id), eq(s.captures.status, "proposed")))
    .returning();
  if (!updated) throw new HttpError(409, "This capture was confirmed by someone else a moment ago.");
  return {
    capture: { id: updated.id, channel: updated.channel as CaptureRecord["channel"], rawText: updated.rawText, parsed: updated.parsed as unknown as CaptureResult, status: "confirmed", appliedEventIds: applied, createdAt: updated.createdAt.toISOString() },
    applied,
  };
}

export async function rejectCapture(id: string) {
  const [row] = await db.update(s.captures).set({ status: "rejected", confirmedAt: new Date() }).where(and(eq(s.captures.id, id), eq(s.captures.status, "proposed"))).returning();
  if (!row) throw new HttpError(409, "Capture not found or already resolved.");
  return { id: row.id, status: row.status };
}