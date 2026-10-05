import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Sahaay schema.
 *
 * Spec note: the product spec names MongoDB for operational + decision memory.
 * This build runs on PostgreSQL; document-shaped data (evidence, lifecycle,
 * spans, calculations) is stored as JSONB so the same "document" semantics hold.
 */

// ───────────────────────── Business data ─────────────────────────
export const products = pgTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  unitCost: doublePrecision("unit_cost"),
  sellPrice: doublePrecision("sell_price"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const suppliers = pgTable("suppliers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const supplierOffers = pgTable(
  "supplier_offers",
  {
    id: serial("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    productId: text("product_id").notNull(),
    price: doublePrecision("price"),
    leadTimeDays: integer("lead_time_days"),
    moq: integer("moq"),
  },
  (t) => [index("supplier_offers_product_idx").on(t.productId)],
);

export const sales = pgTable(
  "sales",
  {
    id: serial("id").primaryKey(),
    saleDate: date("sale_date", { mode: "string" }).notNull(),
    productId: text("product_id").notNull(),
    quantity: integer("quantity").notNull(),
    price: doublePrecision("price"),
  },
  (t) => [
    index("sales_product_idx").on(t.productId),
    index("sales_date_idx").on(t.saleDate),
  ],
);

export const inventory = pgTable("inventory", {
  productId: text("product_id").primaryKey(),
  currentStock: integer("current_stock").notNull(),
  reorderLevel: integer("reorder_level"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Operational Event Ledger.
 *
 * Append-only: business truth is reconstructed by folding these events, never by writing a
 * quantity. A correction is another event, so the history of *why* the stock is what it is is
 * preserved. Nothing here is ever updated or deleted by the app.
 */
export const ledgerEvents = pgTable(
  "ledger_events",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull(),
    /** stock_count | sale | receipt | adjustment | return */
    kind: text("kind").notNull(),
    /** Units for stock_count; a signed delta for every other kind. */
    qty: integer("qty").notNull(),
    /** Business date the event happened on. */
    at: date("at", { mode: "string" }).notNull(),
    /** csv | pos | message | voice | owner | system */
    source: text("source").notNull(),
    note: text("note"),
    /** Capture id / import id / decision id that produced this event. */
    ref: text("ref"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("ledger_events_product_idx").on(t.productId, t.at),
    index("ledger_events_ref_idx").on(t.ref),
  ],
);

/** Raw owner captures (typed or spoken) kept so a claim can always be traced to its source text. */
export const captures = pgTable(
  "captures",
  {
    id: text("id").primaryKey(),
    /** message | voice */
    channel: text("channel").notNull(),
    rawText: text("raw_text").notNull(),
    /** Parse result: proposed events, claim labels, unresolved fragments. */
    parsed: jsonb("parsed").$type<Record<string, unknown>>().notNull(),
    /** proposed | confirmed | rejected */
    status: text("status").notNull().default("proposed"),
    /** Events actually written after owner confirmation. */
    appliedEventIds: jsonb("applied_event_ids").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    confirmedAt: timestamp("confirmed_at"),
  },
  (t) => [index("captures_status_idx").on(t.status)],
);

export const imports = pgTable("imports", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  filename: text("filename"),
  rowsTotal: integer("rows_total").notNull(),
  rowsOk: integer("rows_ok").notNull(),
  rowsRejected: integer("rows_rejected").notNull(),
  detectedColumns: jsonb("detected_columns").$type<Record<string, string>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const dataQualityIssues = pgTable("data_quality_issues", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(), // sales | inventory | products | suppliers | cross
  code: text("code").notNull(),
  severity: text("severity").notNull(), // error | warning | info
  message: text("message").notNull(),
  count: integer("count").notNull().default(0),
  sample: jsonb("sample").$type<unknown[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ───────────────────────── Intelligence ─────────────────────────
export const forecasts = pgTable("forecasts", {
  id: serial("id").primaryKey(),
  productId: text("product_id").notNull(),
  asOf: date("as_of", { mode: "string" }).notNull(),
  horizonDays: integer("horizon_days").notNull(),
  expected: doublePrecision("expected").notNull(),
  low: doublePrecision("low").notNull(),
  high: doublePrecision("high").notNull(),
  dailyRate: doublePrecision("daily_rate").notNull(),
  dailySd: doublePrecision("daily_sd").notNull(),
  trendPct: doublePrecision("trend_pct").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  model: text("model").notNull(),
  historyDays: integer("history_days").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const signals = pgTable("signals", {
  id: serial("id").primaryKey(),
  productId: text("product_id"),
  type: text("type").notNull(), // inventory_risk | slow_moving | demand_surge | supplier_saving
  level: text("level").notNull(),
  score: doublePrecision("score"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const recommendations = pgTable(
  "recommendations",
  {
    id: text("id").primaryKey(),
    dedupeKey: text("dedupe_key").notNull(),
    type: text("type").notNull(),
    severity: text("severity").notNull(), // high | medium | opportunity
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    productId: text("product_id"),
    status: text("status").notNull().default("pending"),
    confidence: doublePrecision("confidence").notNull(),
    abstain: boolean("abstain").notNull().default(false),
    verdict: text("verdict").notNull().default("OK"),
    needsInfo: jsonb("needs_info").$type<string[]>().notNull().default([]),
    evidence: jsonb("evidence").$type<unknown[]>().notNull().default([]),
    action: jsonb("action").$type<Record<string, unknown>>().notNull(),
    risks: jsonb("risks").$type<unknown[]>().notNull().default([]),
    alternatives: jsonb("alternatives").$type<unknown[]>().notNull().default([]),
    validation: jsonb("validation").$type<Record<string, unknown> | null>(),
    calculation: jsonb("calculation").$type<Record<string, unknown> | null>(),
    /** Candidate order quantities compared over simulated business futures. */
    simulation: jsonb("simulation").$type<Record<string, unknown> | null>(),
    explanation: text("explanation"),
    explanationSource: text("explanation_source"),
    research: jsonb("research").$type<Record<string, unknown> | null>(),
    lifecycle: jsonb("lifecycle")
      .$type<{ stage: string; at: string; note?: string }[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("recommendations_status_idx").on(t.status)],
);

// ───────────────────────── Decision memory ─────────────────────────
export const decisions = pgTable("decisions", {
  id: serial("id").primaryKey(),
  recommendationId: text("recommendation_id").notNull(),
  productId: text("product_id"),
  kind: text("kind").notNull(), // approved | modified | rejected
  recommendedQty: integer("recommended_qty"),
  approvedQty: integer("approved_qty"),
  reason: text("reason"),
  supplierId: text("supplier_id"),
  unitPrice: doublePrecision("unit_price"),
  stockAtDecision: integer("stock_at_decision"),
  forecastDailyRate: doublePrecision("forecast_daily_rate"),
  leadTimeDays: integer("lead_time_days"),
  decisionDate: date("decision_date", { mode: "string" }).notNull(), // business date (as-of)
  outcomeWindowDays: integer("outcome_window_days").notNull().default(7),
  executedAt: timestamp("executed_at"),
  arrivedAt: date("arrived_at", { mode: "string" }),
  decidedAt: timestamp("decided_at").defaultNow().notNull(),
});

export const outcomes = pgTable("outcomes", {
  id: serial("id").primaryKey(),
  decisionId: integer("decision_id").notNull(),
  recommendationId: text("recommendation_id").notNull(),
  productId: text("product_id"),
  actualDemand: integer("actual_demand").notNull(),
  forecastDemand: doublePrecision("forecast_demand").notNull(),
  windowDays: integer("window_days").notNull(),
  verdict: text("verdict").notNull(),
  note: text("note").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull(),
  measuredAt: timestamp("measured_at").defaultNow().notNull(),
});

export const preferences = pgTable("preferences", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  statement: text("statement").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  evidenceCount: integer("evidence_count").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const businessRules = pgTable("business_rules", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ───────────────────────── Automation + observability ─────────────────────────
export const workflowRuns = pgTable("workflow_runs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull(), // running | completed | failed
  trigger: text("trigger").notNull(), // manual | schedule | temporal
  steps: jsonb("steps").$type<unknown[]>().notNull().default([]),
  result: jsonb("result").$type<Record<string, unknown> | null>(),
  error: text("error"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
});

export const workflowSchedules = pgTable("workflow_schedules", {
  name: text("name").primaryKey(),
  label: text("label").notNull(),
  description: text("description").notNull(),
  cron: text("cron").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const agentRuns = pgTable("agent_runs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // ask | analysis | workflow | explain | research
  input: text("input").notNull(),
  status: text("status").notNull(),
  spans: jsonb("spans").$type<unknown[]>().notNull().default([]),
  output: jsonb("output").$type<Record<string, unknown> | null>(),
  error: text("error"),
  model: text("model"),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
