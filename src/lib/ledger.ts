// Operational Event Ledger — pure.
//
// Why this exists: business truth must be reconstructable from *events*, not written by a
// model. Every fact about the shop (a delivery arrived, three shirts were sold, two were
// damaged) is an immutable event with a source; the current business state is a pure fold over
// those events. Nothing — including the language model — can silently rewrite the past: a
// correction is another event, and the history of *why* the state is what it is is preserved.

export type LedgerEventKind =
  | "stock_count" // authoritative count (physical count or POS sync) — sets the baseline
  | "sale" // units sold (negative)
  | "receipt" // stock received from a supplier (positive)
  | "adjustment" // manual correction, e.g. damaged goods
  | "return" // customer return (positive)
  | "order_placed"; // a purchase order left the shop — commits cash, moves no stock yet

export type EventSource = "csv" | "pos" | "message" | "voice" | "owner" | "system";

/** Kinds that change on-hand stock. `order_placed` is deliberately absent: goods are not in the shop yet. */
const SIGNED_KINDS: LedgerEventKind[] = ["sale", "receipt", "adjustment", "return"];

/** An immutable fact. `qty` is signed for sale/receipt/adjustment/return; ignored for stock_count. */
export type LedgerEvent = {
  id: string;
  productId: string;
  kind: LedgerEventKind;
  /** Units for stock_count; a signed delta for every other kind. */
  qty: number;  /** Business date (YYYY-MM-DD) the event happened on. */
  at: string;
  source: EventSource;
  /** Free text: supplier name, "voice note", "damaged in storage". */
  note?: string;
  /** Correlation id: capture id, import id, decision id. Never mutated. */
  ref?: string;
};

export function deltaOf(e: LedgerEvent): number {
  if (!SIGNED_KINDS.includes(e.kind)) return 0;
  // `sale` is stored as a positive magnitude of units sold; everything else is already signed.
  return e.kind === "sale" ? -Math.abs(e.qty) : e.qty;
}

export type LedgerState = {
  productId: string;
  /** Units derived purely from events. Never read from a model. */
  quantity: number;
  /** Date of the last stock_count, or null when only movements exist. */
  baselineDate: string | null;
  baselineQty: number | null;
  lastEventAt: string | null;
  eventCount: number;
  /** True when the newest event is dated after `asOf`: its effects cannot be trusted yet. */
  futureDated: boolean;
  /** Running balance after each event, oldest → newest. Explains *why* the quantity is what it is. */
  trail: { at: string; kind: LedgerEventKind; /** The event's own quantity, before signing — so an order can show what was committed. */ qty: number; delta: number; balance: number; source: EventSource; note?: string }[];
};

/**
 * Deterministic fold: events → current quantity per product.
 * Ordering is by (at, id) so the same set of events always produces the same state,
 * regardless of insertion order. stock_count sets an absolute baseline; movements apply after it.
 *
 * `asOf` is the latest business date the rest of the system considers real. Events dated after
 * it are folded but flagged `futureDated`, because a snapshot dated ahead of the data (a clock
 * skew, or an upload with a wrong date) would otherwise silently overwrite real history.
 */
export function reduceEvents(events: LedgerEvent[], asOf?: string): Map<string, LedgerState> {
  const ordered = [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out = new Map<string, LedgerState>();
  for (const e of ordered) {
    let st = out.get(e.productId);
    if (!st) {
      st = { productId: e.productId, quantity: 0, baselineDate: null, baselineQty: null, lastEventAt: null, eventCount: 0, futureDated: false, trail: [] };
      out.set(e.productId, st);
    }
    const delta = deltaOf(e);
    if (e.kind === "stock_count") {
      st.quantity = e.qty;
      st.baselineDate = e.at;
      st.baselineQty = e.qty;
    } else {
      st.quantity += delta;
    }
    st.lastEventAt = e.at;
    st.eventCount++;
    if (asOf && e.at > asOf) st.futureDated = true;
    st.trail.push({ at: e.at, kind: e.kind, qty: e.qty, delta: e.kind === "stock_count" ? e.qty - (st.baselineQty ?? 0) : delta, balance: st.quantity, source: e.source, note: e.note });
  }
  return out;
}

/** Minimal state for a product with a known quantity but no event history (e.g. a CSV-only shop). */
export function stateFromQuantity(productId: string, quantity: number): LedgerState {
  return { productId, quantity, baselineDate: null, baselineQty: null, lastEventAt: null, eventCount: 0, futureDated: false, trail: [] };
}

export type LedgerConflict = {
  productId: string;
  at: string;
  kind: LedgerEventKind;
  eventIds: string[];
  detail: string;
};

/**
 * Two sources reporting the same thing differently on the same day.
 * Never resolved automatically — both values are kept and the owner is asked.
 */
export function detectConflicts(events: LedgerEvent[]): LedgerConflict[] {
  const groups = new Map<string, LedgerEvent[]>();
  for (const e of events) {
    const k = `${e.productId}|${e.at}|${e.kind}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const out: LedgerConflict[] = [];
  for (const [k, g] of groups) {
    if (g.length < 2) continue;
    const quantities = new Set(g.map((e) => e.qty));
    if (quantities.size > 1) {
      const [productId, at, kind] = k.split("|");
      out.push({
        productId,
        at,
        kind: kind as LedgerEventKind,
        eventIds: g.map((e) => e.id),
        detail: `${g.length} sources reported different ${kind} values for ${productId} on ${at}: ${[...quantities].join(" / ")}. Both are kept; confirm which is right.`,
      });
    }
  }
  return out;
}

/** A claim is one extracted fact with an honest label about how much we trust it. */
export type Claim = {
  field: string;
  value: unknown;
  /** CONFIRMED | INFERRED | MISSING | CONFLICTING */
  status: "CONFIRMED" | "INFERRED" | "MISSING" | "CONFLICTING";
  /** Where the claim came from. */
  source: EventSource;
  /** Why this label — shown to the owner verbatim. */
  reason: string;
};

export type ClaimDraft = {
  productId: string;
  productName: string;
  claims: Claim[];
  /** True only when every field needed to write an event is CONFIRMED. */
  readyToWrite: boolean;
  needsInfo: string[];
};

const CONFIRMED = "CONFIRMED" as const;
const INFERRED = "INFERRED" as const;
const MISSING = "MISSING" as const;
const CONFLICTING = "CONFLICTING" as const;

/**
 * Validate one proposed movement against what the ledger already knows.
 * Pure: takes the candidate event and the current derived state, returns labelled claims.
 */
export function validateClaim(draft: Omit<LedgerEvent, "id">, state: LedgerState | undefined, opts: { moq?: number | null; supplierOnFile?: boolean } = {}): ClaimDraft {
  const claims: Claim[] = [];
  const needsInfo: string[] = [];

  const matched = draft.kind === "stock_count" || state !== undefined;
  claims.push(
    matched
      ? { field: "product", value: draft.productId, status: CONFIRMED, source: draft.source, reason: "Matched to a product already in the ledger." }
      : { field: "product", value: null, status: MISSING, source: draft.source, reason: "No existing product matched this claim." },
  );
  if (!matched) needsInfo.push("Which product is this about?");

  const qtyOk = draft.kind === "stock_count" ? Number.isFinite(draft.qty) : Number.isFinite(draft.qty) && draft.qty !== 0;
  claims.push(
    qtyOk
      ? { field: "quantity", value: draft.qty, status: CONFIRMED, source: draft.source, reason: "Quantity was stated explicitly." }
      : { field: "quantity", value: draft.qty, status: MISSING, source: draft.source, reason: "No usable quantity was stated." },
  );
  if (!qtyOk) needsInfo.push("How many units?");

  claims.push(
    draft.at
      ? { field: "date", value: draft.at, status: CONFIRMED, source: draft.source, reason: `Business date ${draft.at}.` }
      : { field: "date", value: null, status: MISSING, source: draft.source, reason: "No date could be determined." },
  );

  if (state && draft.kind !== "stock_count") {
    const after = state.quantity + deltaOf({ ...draft, id: "draft" });
    if (after < 0)
      claims.push({ field: "resulting_stock", value: after, status: CONFLICTING, source: draft.source, reason: `That movement would take stock below zero (${state.quantity} now). It may still be true, but please confirm.` });
  } else if (state) {
    claims.push({ field: "resulting_stock", value: draft.qty, status: CONFIRMED, source: draft.source, reason: "This count replaces the previous baseline." });
  }

  if ((draft.kind === "receipt" || draft.kind === "order_placed") && opts.supplierOnFile === false) {
    claims.push({ field: "supplier", value: null, status: INFERRED, source: draft.source, reason: "No supplier matched this movement; recorded without a supplier name." });
  }
  if (draft.kind !== "stock_count" && opts.moq && Math.abs(draft.qty) > 0 && Math.abs(draft.qty) < opts.moq && draft.kind === "receipt") {
    claims.push({ field: "moq", value: opts.moq, status: INFERRED, source: draft.source, reason: `Received quantity ${Math.abs(draft.qty)} is below the supplier MOQ of ${opts.moq}; fine for a delivery, noted for context.` });
  }

  const blocking = claims.some((c) => c.status === MISSING || c.status === CONFLICTING);
  return { productId: draft.productId, productName: draft.productId, claims, readyToWrite: !blocking, needsInfo };
}

export type LedgerSummary = {
  products: number;
  events: number;
  /** Events that move on-hand stock. Purchase orders are excluded: nothing has arrived yet. */
  movements: number;
  counts: number;
  orders: number;
  conflicts: LedgerConflict[];
  /** Products whose derived quantity is negative — impossible, needs a correction event. */
  negative: { productId: string; quantity: number }[];
  /** Products whose newest event is dated after `asOf`; check the date on that event. */
  futureDated: { productId: string; lastEventAt: string }[];
};

export function summarise(events: LedgerEvent[], asOf?: string): LedgerSummary {
  const state = reduceEvents(events, asOf);
  return {
    products: state.size,
    events: events.length,
    movements: events.filter((e) => SIGNED_KINDS.includes(e.kind)).length,
    counts: events.filter((e) => e.kind === "stock_count").length,
    orders: events.filter((e) => e.kind === "order_placed").length,
    conflicts: detectConflicts(events),
    negative: [...state.values()].filter((s) => s.quantity < 0).map((s) => ({ productId: s.productId, quantity: s.quantity })),
    futureDated: [...state.values()].filter((s) => s.futureDated && s.lastEventAt).map((s) => ({ productId: s.productId, lastEventAt: s.lastEventAt as string })),
  };
}