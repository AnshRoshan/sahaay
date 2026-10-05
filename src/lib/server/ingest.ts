// CSV import: column detection → validation → persistence → data-quality report.
// Rule: never silently assume. Bad rows are rejected and reported; suspicious rows are flagged.
import { db } from "@/db";
import * as s from "@/db/schema";
import { inArray, sql } from "drizzle-orm";
import { parseCsv } from "@/lib/csv";
import { parseDate } from "@/lib/dates";
import { todayStr } from "@/lib/dates";
import { recordCountBaseline } from "./ledger";

export type Kind = "sales" | "inventory" | "products" | "suppliers";

const PID = ["product_id", "sku", "item_id", "product_code", "item", "product", "id"];
const ALIASES: Record<Kind, Record<string, string[]>> = {
  sales: {
    date: ["date", "sale_date", "order_date", "day", "timestamp", "invoice_date"],
    product_id: PID,
    quantity: ["quantity", "qty", "units", "units_sold", "sold"],
    price: ["price", "unit_price", "selling_price", "rate", "amount"],
    txn: ["transaction_id", "invoice_id", "invoice_no", "order_id", "bill_no", "receipt_id"],
  },
  inventory: {
    product_id: PID,
    current_stock: ["current_stock", "stock", "on_hand", "qty_on_hand", "inventory", "quantity"],
    reorder_level: ["reorder_level", "reorder_point", "min_stock"],
  },
  products: {
    product_id: PID,
    name: ["name", "product_name", "title", "description"],
    category: ["category", "type", "department"],
    unit_cost: ["unit_cost", "cost", "cost_price", "purchase_price"],
    sell_price: ["selling_price", "sell_price", "price", "mrp"],
  },
  suppliers: {
    supplier_id: ["supplier_id", "supplier", "vendor_id", "vendor"],
    supplier_name: ["supplier_name", "vendor_name"],
    product_id: PID,
    price: ["price", "unit_price", "supplier_price", "cost"],
    lead_time_days: ["lead_time_days", "lead_time", "lead_days"],
    moq: ["minimum_order_quantity", "moq", "min_order_quantity", "min_order_qty"],
  },
};
const REQUIRED: Record<Kind, string[]> = {
  sales: ["date", "product_id", "quantity"],
  inventory: ["product_id", "current_stock"],
  products: ["product_id"],
  suppliers: ["supplier_id", "product_id"],
};

function mapColumns(headers: string[], kind: Kind): Record<string, string> {
  const used = new Set<string>();
  const map: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(ALIASES[kind])) {
    const hit = aliases.find((a) => headers.includes(a) && !used.has(a));
    if (hit) {
      map[field] = hit;
      used.add(hit);
    }
  }
  return map;
}

export function detectKind(headers: string[]): Kind | null {
  for (const k of ["suppliers", "sales", "inventory", "products"] as Kind[]) {
    const m = mapColumns(headers, k);
    if (REQUIRED[k].every((f) => m[f])) {
      if (k === "suppliers" && !m.price && !m.lead_time_days) continue;
      if (k === "products" && headers.includes("date")) continue;
      return k;
    }
  }
  return null;
}

export type IssueRecord = { code: string; severity: "error" | "warning" | "info"; message: string; count: number; sample: unknown[] };
export type IngestReport = {
  kind: Kind | null;
  filename: string | null;
  rowsTotal: number;
  rowsOk: number;
  rowsRejected: number;
  detectedColumns: Record<string, string>;
  issues: IssueRecord[];
  error?: string;
};

class Issues {
  private m = new Map<string, IssueRecord & { fmt: (n: number) => string }>();
  add(code: string, severity: IssueRecord["severity"], fmt: (n: number) => string, sample?: unknown) {
    const cur = this.m.get(code) ?? { code, severity, message: "", count: 0, sample: [], fmt };
    cur.count++;
    if (sample !== undefined && cur.sample.length < 5) cur.sample.push(sample);
    this.m.set(code, cur);
  }
  list(): IssueRecord[] {
    return [...this.m.values()].map(({ fmt, ...r }) => ({ ...r, message: fmt(r.count) }));
  }
}

const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const c = v.replace(/[₹,\s]|rs\.?/gi, "");
  if (c === "") return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
};
const int = (v: string | undefined): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

async function insertChunks<T>(rows: T[], fn: (chunk: T[]) => Promise<unknown>, size = 1000) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

async function ensureProducts(ids: string[], issues: Issues, where: string) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const existing = new Set<string>();
  for (let i = 0; i < unique.length; i += 1000) {
    const rows = await db.select({ id: s.products.id }).from(s.products).where(inArray(s.products.id, unique.slice(i, i + 1000)));
    rows.forEach((r) => existing.add(r.id));
  }
  const missing = unique.filter((id) => !existing.has(id));
  if (!missing.length) return;
  await insertChunks(missing, (c) => db.insert(s.products).values(c.map((id) => ({ id, name: id }))).onConflictDoNothing());
  for (const id of missing)
    issues.add("unknown_product", "warning", (n) => `${n} product ID(s) in ${where} were not in the products list — placeholders were created (check for typos)`, id);
}

export async function ingestCsv(text: string, opts: { kind?: Kind; filename?: string } = {}): Promise<IngestReport> {
  const parsed = parseCsv(text);
  const filename = opts.filename ?? null;
  const base = { filename, rowsTotal: parsed.rowCount, rowsOk: 0, rowsRejected: 0, detectedColumns: {} as Record<string, string>, issues: [] as IssueRecord[] };
  const kind = opts.kind ?? detectKind(parsed.headers);
  if (!kind) {
    return { ...base, kind: null, error: `Could not recognise this file from its columns (${parsed.headers.join(", ") || "none"}). Expected sales, inventory, products or suppliers columns.` };
  }
  const cols = mapColumns(parsed.headers, kind);
  const missingReq = REQUIRED[kind].filter((f) => !cols[f]);
  if (missingReq.length) {
    return { ...base, kind, detectedColumns: cols, error: `Missing required column(s) for ${kind}.csv: ${missingReq.join(", ")}. Found: ${parsed.headers.join(", ")}.` };
  }
  const issues = new Issues();
  const get = (r: Record<string, string>, f: string) => (cols[f] ? r[cols[f]] : undefined);
  let ok = 0;

  if (kind === "sales") {
    const rows: { saleDate: string; productId: string; quantity: number; price: number | null }[] = [];
    const seen = new Set<string>();
    for (const r of parsed.rows) {
      const date = parseDate(get(r, "date"));
      const pid = (get(r, "product_id") ?? "").trim();
      const q = int(get(r, "quantity"));
      if (!pid) { issues.add("missing_product", "error", (n) => `${n} sales record(s) have no product ID (rejected)`, r); continue; }
      if (!date) { issues.add("invalid_date", "error", (n) => `${n} sales record(s) contain invalid dates (rejected, not guessed)`, get(r, "date") ?? ""); continue; }
      if (q === null || q <= 0) { issues.add("invalid_quantity", "error", (n) => `${n} sales record(s) have a missing, zero or negative quantity (rejected)`, get(r, "quantity") ?? ""); continue; }
      const price = num(get(r, "price"));
      if (cols.price && price === null) issues.add("invalid_price", "warning", (n) => `${n} sales record(s) have an unreadable price (kept, price unknown)`, get(r, "price") ?? "");
      const txn = get(r, "txn");
      if (txn) {
        const key = `${txn}|${date}|${pid}`;
        if (seen.has(key)) issues.add("duplicate_transaction", "warning", (n) => `${n} sales line(s) repeat an existing transaction ID + product + date (kept — please verify)`, key);
        seen.add(key);
      } else {
        const key = `${date}|${pid}|${q}|${price}`;
        if (seen.has(key)) issues.add("identical_rows", "info", (n) => `${n} sales row(s) are identical to another row. Normal if different customers bought the same item; add a transaction ID column to deduplicate exactly (all rows kept)`, key);
        seen.add(key);
      }
      rows.push({ saleDate: date, productId: pid, quantity: q, price });
      ok++;
    }
    await db.transaction(async (tx) => {
      await tx.delete(s.sales);
      await insertChunks(rows, (c) => tx.insert(s.sales).values(c));
    });
    await ensureProducts(rows.map((r) => r.productId), issues, "sales.csv");
  } else if (kind === "inventory") {
    const rows = new Map<string, { productId: string; currentStock: number; reorderLevel: number | null }>();
    for (const r of parsed.rows) {
      const pid = (get(r, "product_id") ?? "").trim();
      const st = int(get(r, "current_stock"));
      if (!pid) { issues.add("missing_product", "error", (n) => `${n} inventory row(s) have no product ID (rejected)`); continue; }
      if (st === null) { issues.add("invalid_stock", "error", (n) => `${n} inventory row(s) have a missing or non-numeric stock value (rejected)`, pid); continue; }
      if (rows.has(pid)) issues.add("duplicate_inventory", "warning", (n) => `${n} product(s) appear more than once in inventory (last value used)`, pid);
      rows.set(pid, { productId: pid, currentStock: st, reorderLevel: int(get(r, "reorder_level")) });
      ok++;
    }
    const list = [...rows.values()];
    await ensureProducts(list.map((x) => x.productId), issues, "inventory.csv");
    await db.transaction(async (tx) => {
      await tx.delete(s.inventory);
      await insertChunks(list, (c) => tx.insert(s.inventory).values(c));
    });
    // A snapshot becomes an immutable count event so the ledger keeps the history of every
    // count. Failure here must not fail the import — the snapshot itself is what analysis uses.
    try {
      const latest = await db.select({ m: sql<string | null>`max(${s.sales.saleDate})` }).from(s.sales);
      // The snapshot describes stock as of the latest recorded sale, never later: a baseline
      // dated in the future would outrank real movements and silently discard them.
      const at = latest[0]?.m ?? todayStr();
      await recordCountBaseline(
        list.map((x) => ({ productId: x.productId, qty: x.currentStock })),
        at,
        "csv",
        `import_inventory_${Date.now()}`,
      );
    } catch (e) {
      issues.add("ledger_baseline_failed", "warning", () => `Inventory snapshot was loaded but could not be added to the event ledger (${e instanceof Error ? e.message : "unknown error"}). The event history will start from the next confirmed capture.`);
    }
  } else if (kind === "products") {
    const rows = new Map<string, { id: string; name: string; category: string | null; unitCost: number | null; sellPrice: number | null }>();
    for (const r of parsed.rows) {
      const pid = (get(r, "product_id") ?? "").trim();
      if (!pid) { issues.add("missing_product", "error", (n) => `${n} product row(s) have no ID (rejected)`); continue; }
      if (rows.has(pid)) issues.add("duplicate_product", "warning", (n) => `${n} product ID(s) are listed more than once (last used)`, pid);
      rows.set(pid, { id: pid, name: get(r, "name") || pid, category: get(r, "category") || null, unitCost: num(get(r, "unit_cost")), sellPrice: num(get(r, "sell_price")) });
      ok++;
    }
    await insertChunks([...rows.values()], (c) =>
      db.insert(s.products).values(c).onConflictDoUpdate({
        target: s.products.id,
        set: { name: sql`excluded.name`, category: sql`excluded.category`, unitCost: sql`excluded.unit_cost`, sellPrice: sql`excluded.sell_price` },
      }),
    );
  } else {
    const rows: { supplierId: string; productId: string; price: number | null; leadTimeDays: number | null; moq: number | null }[] = [];
    const names = new Map<string, string>();
    for (const r of parsed.rows) {
      const sid = (get(r, "supplier_id") ?? "").trim();
      const pid = (get(r, "product_id") ?? "").trim();
      if (!sid || !pid) { issues.add("missing_ids", "error", (n) => `${n} supplier row(s) lack a supplier or product ID (rejected)`); continue; }
      const price = num(get(r, "price"));
      const lead = int(get(r, "lead_time_days"));
      if (cols.price && price === null) issues.add("missing_price", "warning", (n) => `${n} supplier row(s) have no price`, `${sid}/${pid}`);
      if (lead === null) issues.add("missing_lead_time", "warning", (n) => `${n} supplier row(s) have no lead time — Sahaay will abstain on those products`, `${sid}/${pid}`);
      if (price !== null && price <= 0) { issues.add("invalid_price", "error", (n) => `${n} supplier row(s) have a non-positive price (rejected)`, `${sid}/${pid}`); continue; }
      names.set(sid, get(r, "supplier_name") || names.get(sid) || sid);
      rows.push({ supplierId: sid, productId: pid, price, leadTimeDays: lead, moq: int(get(r, "moq")) });
      ok++;
    }
    await ensureProducts(rows.map((r) => r.productId), issues, "suppliers.csv");
    await db.transaction(async (tx) => {
      await tx.delete(s.supplierOffers);
      await insertChunks(rows, (c) => tx.insert(s.supplierOffers).values(c));
      if (names.size)
        await tx.insert(s.suppliers).values([...names].map(([id, name]) => ({ id, name }))).onConflictDoUpdate({ target: s.suppliers.id, set: { name: sql`excluded.name` } });
    });
  }

  const list = issues.list();
  await db.delete(s.dataQualityIssues).where(sql`${s.dataQualityIssues.source} = ${kind}`);
  if (list.length)
    await db.insert(s.dataQualityIssues).values(list.map((i) => ({ source: kind, code: i.code, severity: i.severity, message: i.message, count: i.count, sample: i.sample })));
  await db.insert(s.imports).values({ kind, filename, rowsTotal: parsed.rowCount, rowsOk: ok, rowsRejected: parsed.rowCount - ok, detectedColumns: cols });
  await refreshCrossQuality();
  return { ...base, kind, detectedColumns: cols, rowsOk: ok, rowsRejected: parsed.rowCount - ok, issues: list };
}

/** Relationship checks across tables. Recomputed after every import. */
export async function refreshCrossQuality() {
  const q = async (query: ReturnType<typeof sql>) => Number(((await db.execute(query)).rows[0] as { n: string | number }).n);
  const [noSupplier, noLead, conflicts, negative, noInv, productsN] = await Promise.all([
    q(sql`select count(*) n from products p where not exists (select 1 from supplier_offers o where o.product_id = p.id)`),
    q(sql`select count(distinct product_id) n from supplier_offers where lead_time_days is null`),
    q(sql`select count(*) n from (select 1 from supplier_offers group by supplier_id, product_id having count(*) > 1 and (count(distinct price) > 1 or count(distinct lead_time_days) > 1)) x`),
    q(sql`select count(*) n from inventory where current_stock < 0`),
    q(sql`select count(*) n from products p where not exists (select 1 from inventory i where i.product_id = p.id)`),
    q(sql`select count(*) n from products`),
  ]);
  const out: { code: string; severity: string; message: string; count: number }[] = [];
  if (productsN > 0 && noSupplier) out.push({ code: "missing_supplier", severity: "warning", count: noSupplier, message: `${noSupplier} product(s) have missing supplier information` });
  if (noLead) out.push({ code: "missing_lead_time_products", severity: "warning", count: noLead, message: `${noLead} product(s) have a supplier with no lead time` });
  if (conflicts) out.push({ code: "supplier_conflict", severity: "warning", count: conflicts, message: `${conflicts} supplier/product pair(s) are listed with conflicting terms` });
  if (negative) out.push({ code: "negative_stock", severity: "error", count: negative, message: `${negative} product(s) have negative stock — physically impossible` });
  if (productsN > 0 && noInv) out.push({ code: "missing_inventory", severity: "warning", count: noInv, message: `${noInv} product(s) have no inventory record` });
  await db.delete(s.dataQualityIssues).where(sql`${s.dataQualityIssues.source} = 'cross'`);
  if (out.length) await db.insert(s.dataQualityIssues).values(out.map((o) => ({ source: "cross", ...o, sample: [] as unknown[] })));
}
