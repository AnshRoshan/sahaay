CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"input" text NOT NULL,
	"status" text NOT NULL,
	"spans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output" jsonb,
	"error" text,
	"model" text,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_rules" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captures" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"raw_text" text NOT NULL,
	"parsed" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"applied_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "data_quality_issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"code" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"sample" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"recommendation_id" text NOT NULL,
	"product_id" text,
	"kind" text NOT NULL,
	"recommended_qty" integer,
	"approved_qty" integer,
	"reason" text,
	"supplier_id" text,
	"unit_price" double precision,
	"stock_at_decision" integer,
	"forecast_daily_rate" double precision,
	"lead_time_days" integer,
	"decision_date" date NOT NULL,
	"outcome_window_days" integer DEFAULT 7 NOT NULL,
	"executed_at" timestamp,
	"arrived_at" date,
	"decided_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"as_of" date NOT NULL,
	"horizon_days" integer NOT NULL,
	"expected" double precision NOT NULL,
	"low" double precision NOT NULL,
	"high" double precision NOT NULL,
	"daily_rate" double precision NOT NULL,
	"daily_sd" double precision NOT NULL,
	"trend_pct" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"model" text NOT NULL,
	"history_days" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"filename" text,
	"rows_total" integer NOT NULL,
	"rows_ok" integer NOT NULL,
	"rows_rejected" integer NOT NULL,
	"detected_columns" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"product_id" text PRIMARY KEY NOT NULL,
	"current_stock" integer NOT NULL,
	"reorder_level" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_events" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"kind" text NOT NULL,
	"qty" integer NOT NULL,
	"at" date NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" serial PRIMARY KEY NOT NULL,
	"decision_id" integer NOT NULL,
	"recommendation_id" text NOT NULL,
	"product_id" text,
	"actual_demand" integer NOT NULL,
	"forecast_demand" double precision NOT NULL,
	"window_days" integer NOT NULL,
	"verdict" text NOT NULL,
	"note" text NOT NULL,
	"details" jsonb NOT NULL,
	"measured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"statement" text NOT NULL,
	"data" jsonb NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "preferences_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"unit_cost" double precision,
	"sell_price" double precision,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"dedupe_key" text NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"product_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"confidence" double precision NOT NULL,
	"abstain" boolean DEFAULT false NOT NULL,
	"verdict" text DEFAULT 'OK' NOT NULL,
	"needs_info" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"risks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation" jsonb,
	"calculation" jsonb,
	"simulation" jsonb,
	"explanation" text,
	"explanation_source" text,
	"research" jsonb,
	"lifecycle" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"sale_date" date NOT NULL,
	"product_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"price" double precision
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" text,
	"type" text NOT NULL,
	"level" text NOT NULL,
	"score" double precision,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"product_id" text NOT NULL,
	"price" double precision,
	"lead_time_days" integer,
	"moq" integer
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"trigger" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "workflow_schedules" (
	"name" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"cron" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "captures_status_idx" ON "captures" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ledger_events_product_idx" ON "ledger_events" USING btree ("product_id","at");--> statement-breakpoint
CREATE INDEX "ledger_events_ref_idx" ON "ledger_events" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "recommendations_status_idx" ON "recommendations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sales_product_idx" ON "sales" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sales_date_idx" ON "sales" USING btree ("sale_date");--> statement-breakpoint
CREATE INDEX "supplier_offers_product_idx" ON "supplier_offers" USING btree ("product_id");