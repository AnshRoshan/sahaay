// Shared domain types. Pure — no DB or framework imports.

export type Severity = "high" | "medium" | "opportunity";
export type RecType =
  | "reorder"
  | "supplier_change"
  | "inventory_warning"
  | "slow_moving"
  | "opportunity";
export type RecStatus =
  | "pending"
  | "approved"
  | "modified"
  | "rejected"
  | "executed"
  | "expired";

export type RiskLevel = "SAFE" | "WATCH" | "HIGH" | "CRITICAL";
export type GuardVerdict =
  | "OK"
  | "LOW_CONFIDENCE"
  | "FLAG_CONFLICT"
  | "ABSTAIN"
  | "DATA_ERROR";

export type EvidenceSource =
  | "sales"
  | "inventory"
  | "forecast"
  | "supplier"
  | "web"
  | "rules"
  | "memory"
  | "ledger";

/**
 * How much we trust an extracted fact.
 * CONFIRMED  — stated by a source of record (CSV export, POS, an event the owner confirmed).
 * INFERRED    — derived by code or model from other facts; may be wrong.
 * MISSING     — the information a decision needs is absent.
 * CONFLICTING — two sources disagree; both are kept and the pessimistic value is used.
 */
export type ClaimStatus = "CONFIRMED" | "INFERRED" | "MISSING" | "CONFLICTING";

export type Evidence = {
  source: EvidenceSource;
  label: string;
  value: unknown;
  explanation: string;
  timestamp?: string;
  /** Provenance label. Absent on older rows → treated as CONFIRMED (internal data). */
  status?: ClaimStatus;
};

export type Risk = { label: string; detail: string };

export type ActionKind =
  | "order"
  | "switch_supplier"
  | "pause_reorder"
  | "watch"
  | "gather_info"
  | "fix_data"
  | "promote";

export type Action = {
  kind: ActionKind;
  label: string;
  productId?: string;
  supplierId?: string;
  quantity?: number;
  unitPrice?: number;
  estimatedCost?: number;
  leadTimeDays?: number;
  details?: Record<string, unknown>;
};

export type CalcStep = { label: string; value: number | string; formula?: string };
export type Calculation = {
  steps: CalcStep[];
  quantity?: number;
  validationInput?: ValidationInput;
  context?: Record<string, unknown>;
};

export type RuleSet = {
  maxOrderQuantity: number;
  cashLimit: number;
  minMarginPct: number;
  inventoryCapacity: number;
  allowedSuppliers: string[]; // empty = any
  safetyBufferPct: number;
  reviewPeriodDays: number;
  plausibilityMultiple: number;
  minHistoryDays: number;
};

export const DEFAULT_RULES: RuleSet = {
  maxOrderQuantity: 100,
  cashLimit: 50000,
  minMarginPct: 20,
  inventoryCapacity: 3000,
  allowedSuppliers: [],
  safetyBufferPct: 12,
  reviewPeriodDays: 7,
  plausibilityMultiple: 3,
  minHistoryDays: 28,
};

export type SupplierOffer = {
  supplierId: string;
  productId: string;
  price: number | null;
  leadTimeDays: number | null;
  moq: number | null;
};

export type ProductFacts = {
  id: string;
  name: string;
  category: string | null;
  unitCost: number | null;
  sellPrice: number | null;
  stock: number | null;
  inbound: number;
  reorderLevel: number | null;
  offers: SupplierOffer[];
  /** Daily units sold, oldest → newest, ending on as-of date. */
  series: number[];
  historyDays: number;
  totalUnits: number;
};

export type ForecastResult = {
  productId: string;
  horizonDays: number;
  expected: number;
  low: number;
  high: number;
  dailyRate: number;
  dailySd: number;
  trendPct: number;
  confidence: number;
  model: "tabpfn" | "local-ensemble";
  historyDays: number;
};

export type ValidationInput = {
  quantity: number;
  unitPrice: number | null;
  supplierId: string | null;
  moq: number | null;
  sellPrice: number | null;
  monthlyDemand: number;
  currentStock: number;
  totalStockUnits: number;
};

export type ValidationCheck = {
  rule: string;
  status: "pass" | "warn" | "block" | "skipped";
  message: string;
};
export type ValidationReport = {
  status: "pass" | "warn" | "block";
  checks: ValidationCheck[];
};

export type GuardResult = {
  verdict: GuardVerdict;
  flags: GuardVerdict[];
  reasons: string[];
  needs: string[];
};

/** One candidate order quantity evaluated over many simulated business futures. */
export type SimulationCandidate = {
  quantity: number;
  /** Probability demand exhausts stock before a replenishment can arrive. */
  stockoutRisk: number;
  /** Probability the horizon ends with stock left over the reorder buffer. */
  overstockRisk: number;
  expectedDemand: number;
  expectedUnitsSold: number;
  /** Units of unmet demand across the simulated horizon. */
  expectedLostUnits: number;
  /** Units lost before the new order could arrive; caused by today's stock level. */
  expectedPreDeliveryLostUnits: number;
  expectedLeftoverUnits: number;
  /** Sales revenue minus the cash committed to the order. */
  expectedCash: number;
  /** Cash committed by this quantity (quantity × unit price). */
  orderCost: number;
  expectedLostSalesValue: number;
  /** Blocking / warning checks from validateOrder, per candidate. */
  validationStatus: "pass" | "warn" | "block" | null;
};

export type SimulationResult = {
  runs: number;
  seed: number;
  horizonDays: number;
  leadTimeDays: number;
  stockAtStart: number;
  /** Deterministic, seeded, reproducible. Same inputs → same table. */
  candidates: SimulationCandidate[];
  method: string;
  limitations: string[];
};

export type RecDraft = {
  dedupeKey: string;
  type: RecType;
  severity: Severity;
  title: string;
  summary: string;
  productId: string | null;
  confidence: number;
  abstain: boolean;
  verdict: GuardVerdict;
  needsInfo: string[];
  evidence: Evidence[];
  action: Action;
  risks: Risk[];
  alternatives: Action[];
  validation: ValidationReport | null;
  calculation: Calculation | null;
  /** Present on order recommendations: candidate quantities compared over simulated futures. */
  simulation?: SimulationResult | null;
};

export type SignalDraft = {
  productId: string | null;
  type: string;
  level: string;
  score: number | null;
  payload: Record<string, unknown>;
};

export type LifecycleEntry = { stage: string; at: string; note?: string };

/**
 * Capture → Verify → Understand → Predict → Simulate → Explain → Approve → Act → Monitor → Learn.
 * The stored strings are kept backwards-compatible with rows written by earlier versions.
 */
export const LIFECYCLE_STAGES = [
  "DETECTED", // capture
  "ANALYZED", // understand
  "RECOMMENDED", // predict
  "SIMULATED", // simulate
  "VALIDATED", // verify
  "PENDING_APPROVAL", // explain + human approves
  "APPROVED",
  "EXECUTED", // act
  "MONITORED",
  "OUTCOME_RECORDED", // learn
] as const;
