// Free-text capture → proposed business events. Pure.
//
// The owner should be able to say "aaj 20 basmati aaye" instead of maintaining a CSV.
// This module only *proposes* events and labels every extracted fact; it never writes anything.
// `src/lib/server/capture.ts` decides whether to trust a model's parse and whether the owner
// confirmed it. Everything here is deterministic so it can be unit-tested.

import { parseDate, todayStr } from "./dates";
import { validateClaim, type Claim, type LedgerEvent, type LedgerEventKind } from "./ledger";
import { stateFromQuantity } from "./ledger";

export type CaptureIntent = "receipt" | "sale" | "adjustment" | "return" | "count" | "unknown";

export type ProposedEvent = {
  kind: LedgerEventKind;
  productId: string;
  productName: string;
  qty: number;
  at: string;
  /** Words in the message that produced this proposal — shown so the owner can verify intent. */
  evidenceText: string;
  /** Product match quality. */
  match: "exact" | "fuzzy" | "none";
  claims: Claim[];
  readyToWrite: boolean;
  needsInfo: string[];
};

export type CaptureResult = {
  events: ProposedEvent[];
  /** Text we could not attach to any product. Surfaced, never dropped silently. */
  unresolved: string[];
  intent: CaptureIntent;
};

/** Number words in Hindi/Urdu and English. Note teen = 13 (not 3) and do = 2. */
const UNITS: Record<string, number> = {
  dozen: 12,
  ek: 1, one: 1, do: 2, two: 2, teen: 13, three: 3, char: 4, four: 4, paanch: 5, five: 5,
  chhe: 6, six: 6, saat: 7, seven: 7, aath: 8, eight: 8, nau: 9, nine: 9, das: 10, ten: 10,
  gyarah: 11, eleven: 11, barah: 12, twelve: 12, bees: 20, twenty: 20, tees: 30, pachas: 50,
};

/** Indications of an arrival. Order matters: "pata nahi" must not read as a receipt. */
const RECEIPT_WORDS = ["aaya", "aayi", "aaye", "aayen", "aa gaya", "aa gayi", "mila", "mili", "mile", "aaya tha", "received", "receive", "arrived", "arrive", "delivery", "delivered", "stock aaya"];
const SALE_WORDS = ["becha", "bechi", "bik", "bika", "biki", "sold", "sale", " gaya", " gayi", "nikla", "nikli", "nikle"];
const DAMAGE_WORDS = ["damaged", "damage", "toota", "tooti", "toote", "broken", "kharab", "scratched", "lost", "kho gaya"];
const RETURN_WORDS = ["return", "returned", "wapas", "wapas", "refund"];
const COUNT_WORDS = ["count", "stock hai", "mere paas", "available", "on hand", "counted", "inventory hai"];

const NEGATION_WORDS = ["nahi", "nahin", "nhi", "na", "kabhi nahi", "not", "no"];

function has(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

export function detectIntent(text: string): CaptureIntent {
  const t = ` ${text.toLowerCase()} `;
  if (has(t, COUNT_WORDS) && !has(t, RECEIPT_WORDS)) return "count";
  if (has(t, RECEIPT_WORDS)) return "receipt";
  if (has(t, RETURN_WORDS)) return "return";
  if (has(t, DAMAGE_WORDS)) return "adjustment";
  if (has(t, SALE_WORDS)) return "sale";
  return "unknown";
}

/**
 * A number only counts as a quantity when it sits next to the product ("20 basmati carton",
 * "teen basmati aaya"). A bare number elsewhere — a size, a date, "3 colours" — is not a unit
 * count, and treating it as one would invent inventory.
 */
export function quantityNearProduct(clause: string, productId: string, productName: string): number | null {
  const tokens = clause.split(/[^a-z0-9]+/i).map((t) => t.toLowerCase()).filter(Boolean);
  const nameParts = new Set([...nameTokens(productName), ...nameTokens(productId)]);
  const isName = (t: string) => nameParts.has(t) || PACKAGING.has(t);
  const isNumber = (t: string) => /^-?\d+(\.\d+)?$/.test(t) || UNITS[t] !== undefined;
  for (let i = 0; i < tokens.length; i++) {
    if (!isNumber(tokens[i])) continue;
    const prev = i > 0 ? tokens[i - 1] : "";
    const next = i + 1 < tokens.length ? tokens[i + 1] : "";
    const next2 = i + 2 < tokens.length ? tokens[i + 2] : "";
    // "20 carton basmati" · "20 basmati" · "basmati 20" · "20 carton"
    if (PACKAGING.has(prev) || PACKAGING.has(next) || isName(prev) || isName(next) || isName(next2)) {
      const n = UNITS[tokens[i]] ?? Number(tokens[i]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

const DATE_WORDS: Record<string, number> = {
  aaj: 0, kal: -1, parso: -2, "pichle kal": -1, today: 0, yesterday: -1, tomorrow: 1,
};

function detectDate(text: string, today = todayStr()): { at: string | null; explicit: boolean } {
  const t = text.toLowerCase();
  for (const [w, off] of Object.entries(DATE_WORDS)) {
    if (t.includes(w)) return { at: shift(today, off), explicit: true };
  }
  const m = /\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{4}|\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (m) {
    const d = parseDate(m[1]);
    if (d) return { at: d, explicit: true };
  }
  return { at: null, explicit: false };
}

function shift(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

// Used only to find where a new movement clause starts ("… aur 20 basmati aaya").
// Reading the quantity itself is quantityNearProduct's job, so a stray number elsewhere in
// the message is never mistaken for a unit count.
const NUM_WORDS = Object.keys(UNITS).join("|");

/** Words that describe packaging or amount, not the product itself. */
const PACKAGING = new Set(["carton", "cartons", "packet", "packets", "pack", "packs", "piece", "pieces", "pcs", "nos", "unit", "units", "bundle", "bundles", "bora", "box", "boxes", "dozen", "kg", "gm", "g", "l", "litre", "litres", "liter", "ml"]);

const nameTokens = (name: string) =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !/\d/.test(w) && !PACKAGING.has(w));

/** Word overlap against known products; conservative but tolerant of pack-size suffixes. */
export function matchProduct(text: string, products: { id: string; name: string }[]): { id: string; name: string; match: "exact" | "fuzzy" | "none" } {
  const t = text.toLowerCase();
  let best: { id: string; name: string; match: "exact" | "fuzzy" | "none"; score: number } | null = null;
  for (const p of products) {
    const name = p.name.toLowerCase();
    if (t.includes(name)) {
      const s = 100 + name.length;
      if (!best || s > best.score) best = { id: p.id, name: p.name, match: "exact", score: s };
      continue;
    }
    // Match on the id too: shopkeepers say "blue shirt", the catalogue says "blue-shirt-m".
    const tokens = [...new Set([...nameTokens(name), ...nameTokens(p.id)])];
    if (!tokens.length) continue;
    const hits = tokens.filter((w) => t.includes(w)).length;
    if (hits === 0) continue;
    const ratio = hits / tokens.length;
    if (ratio >= 0.5 && (!best || ratio * 10 > best.score)) best = { id: p.id, name: p.name, match: "fuzzy", score: ratio * 10 };
  }
  return best ? { id: best.id, name: best.name, match: best.match } : { id: "", name: "", match: "none" };
}

/**
 * Parse one owner message into proposed events. Every extracted number is a *claim*:
 * explicit = CONFIRMED, guessed = INFERRED, absent = MISSING. Nothing is written here.
 */
export function parseCapture(
  text: string,
  opts: {
    products: { id: string; name: string }[];
    /** Current derived quantity per product, from the ledger. */
    stock: Record<string, number>;
    today?: string;
  },
): CaptureResult {
  const today = opts.today ?? todayStr();
  const lower = text.toLowerCase();
  const intent = detectIntent(lower);
  const negated = has(lower, NEGATION_WORDS);
  const { at, explicit } = detectDate(text, today);

  // Split on sentence-ish boundaries so one message can carry several movements. A trailing
  // "aur N x y bik gaye" after "aur" starts a new clause.
  const clauses = text
    .split(new RegExp(`[;,]|(?:\\baur\\b|\\band\\b|\\bphir\\b|\\bthen\\b)(?=\\s+(?:${NUM_WORDS}|\\d))`, "i"))
    .map((c) => c.trim())
    .filter(Boolean);
  const events: ProposedEvent[] = [];
  const unresolved: string[] = [];

  for (const clause of clauses.length ? clauses : [text]) {
    const cl = clause.toLowerCase();
    const m = matchProduct(clause, opts.products);
    if (m.match === "none") {
      // Keep the text rather than dropping it — the owner must see what we could not read.
      unresolved.push(clause);
      continue;
    }
    const clauseIntent = detectIntent(cl) === "unknown" ? intent : detectIntent(cl);
    const kind: LedgerEventKind | null =
      clauseIntent === "receipt" ? "receipt"
        : clauseIntent === "sale" ? "sale"
          : clauseIntent === "adjustment" ? "adjustment"
            : clauseIntent === "return" ? "return"
              : clauseIntent === "count" ? "stock_count"
                : null;

    const qtyRaw = quantityNearProduct(clause, m.id, m.name);
    // Damage and loss remove stock; a plain correction may add it. Sign it explicitly so
    // "2 damaged" can never increase stock.
    const isDamage = detectIntent(cl) === "adjustment" && has(` ${cl} `, DAMAGE_WORDS);
    const qty = isDamage ? -Math.abs(qtyRaw ?? 0) : Math.abs(qtyRaw ?? 0);

    const draft = {
      productId: m.id,
      kind: kind ?? "adjustment",
      qty,
      at: at ?? today,
      source: "message" as const,
      note: clause.slice(0, 140),
    };
    const v = validateClaim(draft, opts.stock[m.id] === undefined ? undefined : stateFromQuantity(m.id, opts.stock[m.id]));

    const claims = [...v.claims];
    // Capture-specific provenance labels, layered on top of the ledger checks.
    if (qtyRaw === null) {
      claims.push({ field: "quantity", value: null, status: "MISSING", source: "message", reason: `No number found in “${clause.slice(0, 60)}”. I will not guess how many units.` });
    } else if (explicit === false) {
      // The number itself was stated; the *date* was not.
      claims.push({ field: "quantity_source", value: qtyRaw, status: "CONFIRMED", source: "message", reason: "You said the number explicitly." });
    }
    if (!explicit) {
      const i = claims.findIndex((c) => c.field === "date");
      if (i >= 0) claims[i] = { ...claims[i], status: "INFERRED", reason: `No date in the message; assuming today (${today}).` };
    }
    if (negated) {
      claims.push({ field: "intent", value: "negated", status: "MISSING", source: "message", reason: `The message contains a negation (“${lower.trim()}”), so I am not sure this is a real movement. Nothing will be written until you confirm.` });
    }
    if (m.match === "fuzzy") {
      claims.push({ field: "product", value: m.name, status: "INFERRED", source: "message", reason: `Product name matched partially to “${m.name}”. Check this is the right item.` });
    }
    if (isDamage) {
      claims.push({ field: "direction", value: "decrease", status: "CONFIRMED", source: "message", reason: "The message describes damage or loss, so the quantity leaves stock." });
    }
    if (kind === null) {
      claims.push({ field: "intent", value: null, status: "MISSING", source: "message", reason: "I could not tell whether this was a delivery, a sale, or a correction." });
    }

    const needsInfo = [...new Set([...v.needsInfo, ...(kind === null ? ["What happened — delivery, sale, or damage/loss?"] : []), ...(qtyRaw === null ? ["How many units?"] : []), ...(m.match === "fuzzy" ? [`Is this ${m.name}?`] : [])])];
    events.push({
      kind: draft.kind,
      productId: m.id,
      productName: m.name,
      qty,
      at: draft.at,
      evidenceText: clause,
      match: m.match,
      claims,
      readyToWrite: kind !== null && qtyRaw !== null && !negated && !claims.some((c) => c.status === "MISSING" || c.status === "CONFLICTING"),
      needsInfo,
    });
  }

  return { events, unresolved, intent };
}

/** Turns owner-approved proposals into ledger events. Never called before confirmation. */
export function toEvents(approved: ProposedEvent[], source: "message" | "voice", ref: string): LedgerEvent[] {
  return approved
    .filter((p) => p.readyToWrite && p.productId)
    .map((p, i) => ({
      id: `${ref}_${i}`,
      productId: p.productId,
      kind: p.kind,
      // `sale` stores a positive magnitude (the reducer negates it); every other kind is signed.
      qty: p.kind === "sale" ? Math.abs(p.qty) : p.qty,
      at: p.at,
      source,
      note: p.evidenceText.slice(0, 140),
      ref,
    }));
}