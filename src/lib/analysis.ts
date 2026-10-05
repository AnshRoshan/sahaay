// Detection → Risk → Recommendation → Validation. Pure (no DB, no network).
import { assessInputs, usableOffers } from "./guards";
import { effectiveLeadDays, leadTimeStatement, type SupplierLeadTime } from "./leadtime";
import { possibleStockoutRuns } from "./forecast-core";
import { computeOrderQuantity, stockoutRisk, type RiskOutput } from "./risk";
import { simulateDecision, type SimRow } from "./simulate";
import { validateOrder } from "./validation";
import type {
  Action,
  Calculation,
  Evidence,
  ForecastResult,
  GuardResult,
  ProductFacts,
  RecDraft,
  Risk,
  RuleSet,
  SignalDraft,
  SimulationCandidate,
  SimulationResult,
  SupplierOffer,
} from "./types";

export type PrevDecision = {
  kind: string;
  recommended: number | null;
  approved: number | null;
  reason: string | null;
  date: string;
};

export type AnalysisContext = {
  asOf: string;
  rules: RuleSet;
  totalStockUnits: number;
  supplierNames: Record<string, string>;
  memory: {
    orderRatio: number | null;
    forecastBias: number | null;
    previous: Record<string, PrevDecision>;
  };
  /** Derived inventory per product from the event ledger, when available. */
  /** Current derived quantity per product, from the event ledger. */
  ledgerStock?: Record<string, { quantity: number; events: number }>;
  /** Lead times measured from the owner's own order→delivery pairs, keyed by supplier. */
  leadTimes?: Map<string, SupplierLeadTime>;
};

export type ConsolidatedOffer = {
  supplierId: string;
  price: number;
  leadTimeDays: number;
  moq: number | null;
  conflicted: boolean;
  /** Whether `leadTimeDays` is the supplier's promise or a median measured from real deliveries. */
  leadTimeSource?: "promised" | "observed" | "unknown";
  /** The lead time the supplier's own sheet claims, kept so the evidence can name both numbers. */
  promisedLeadDays?: number;
  observed?: SupplierLeadTime;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const n1 = (x: number) => String(Math.round(x * 10) / 10);
const pct = (x: number) => Math.round(x * 100);

/** Monte Carlo paths per candidate quantity. Enough to be stable, cheap enough to run inline. */
export const SIM_RUNS = 400;

/** Deterministic seed per product so the same product always gets the same simulation table. */
export function simulationSeed(productId: string): number {
  let h = 2166136261;
  for (let i = 0; i < productId.length; i++) {
    h ^= productId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const toCandidate = (row: SimRow, status: SimulationCandidate["validationStatus"]): SimulationCandidate => ({
  quantity: row.quantity,
  stockoutRisk: row.stockoutRisk,
  overstockRisk: row.overstockRisk,
  expectedDemand: row.expectedDemand,
  expectedUnitsSold: row.expectedUnitsSold,
  expectedLostUnits: row.expectedLostUnits,
  expectedPreDeliveryLostUnits: row.expectedPreDeliveryLostUnits,
  expectedLeftoverUnits: row.expectedLeftoverUnits,
  expectedCash: row.expectedCash,
  orderCost: row.orderCost,
  expectedLostSalesValue: row.expectedLostSalesValue,
  validationStatus: status,
});

/**
 * Pessimistic merge when a supplier appears more than once.
 * `leadTimes` are medians measured from the owner's own recorded deliveries: where a supplier has
 * delivered enough times, the promise in the spreadsheet stops being the number the plan uses.
 */
export function consolidateOffers(offers: SupplierOffer[], leadTimes: Map<string, SupplierLeadTime> = new Map()): ConsolidatedOffer[] {
  const by = new Map<string, SupplierOffer[]>();
  for (const o of usableOffers(offers)) by.set(o.supplierId, [...(by.get(o.supplierId) ?? []), o]);
  return [...by.entries()].map(([supplierId, g]) => {
    const promised = Math.max(...g.map((o) => o.leadTimeDays as number));
    const observed = leadTimes.get(supplierId);
    const eff = effectiveLeadDays(promised, observed);
    return {
      supplierId,
      price: Math.max(...g.map((o) => o.price as number)),
      leadTimeDays: eff.days ?? promised,
      moq: g.every((o) => o.moq === null) ? null : Math.max(...g.map((o) => o.moq ?? 0)),
      conflicted:
        g.length > 1 &&
        (new Set(g.map((o) => o.price)).size > 1 || new Set(g.map((o) => o.leadTimeDays)).size > 1),
      leadTimeSource: eff.source,
      promisedLeadDays: promised,
      observed,
    };
  });
}

/** Primary supplier = fastest delivery (ties → cheaper), restricted to allowed list when set. */
export function pickPrimary(c: ConsolidatedOffer[], allowed: string[]): ConsolidatedOffer | null {
  const pool = allowed.length ? c.filter((x) => allowed.includes(x.supplierId)) : c;
  const use = pool.length ? pool : c;
  return [...use].sort((a, b) => a.leadTimeDays - b.leadTimeDays || a.price - b.price)[0] ?? null;
}

const sName = (ctx: AnalysisContext, id: string) => ctx.supplierNames[id] ?? id;
const sumTail = (a: number[], n: number) => a.slice(-n).reduce((s, x) => s + x, 0);

export type ProductAnalysis = {
  signals: SignalDraft[];
  recs: RecDraft[];
  risk: RiskOutput | null;
  guard: GuardResult;
  primary: ConsolidatedOffer | null;
  consolidated: ConsolidatedOffer[];
};

export function analyzeProduct(
  f: ProductFacts,
  fc: ForecastResult,
  ctx: AnalysisContext,
): ProductAnalysis {
  const { rules } = ctx;
  const guard = assessInputs(f, rules);
  const consolidated = consolidateOffers(f.offers, ctx.leadTimes ?? new Map());
  const primary = pickPrimary(consolidated, rules.allowedSuppliers);
  const signals: SignalDraft[] = [];
  const recs: RecDraft[] = [];
  const recent28 = sumTail(f.series, 28);

  // ── Guarded: cannot recommend ─────────────────────────────────────────
  if (guard.verdict === "DATA_ERROR" || guard.verdict === "ABSTAIN" || !primary || f.stock === null) {
    const isData = guard.verdict === "DATA_ERROR";
    signals.push({
      productId: f.id,
      type: "inventory_risk",
      level: isData ? "DATA_ERROR" : "ABSTAIN",
      score: null,
      payload: { reasons: guard.reasons, needs: guard.needs, stock: f.stock },
    });
    if (isData || recent28 >= 3) {
      recs.push({
        dedupeKey: `${isData ? "data" : "abstain"}:${f.id}`,
        type: isData ? "inventory_warning" : "reorder",
        severity: "medium",
        title: f.name,
        summary: isData
          ? `Data problem: ${guard.reasons.join("; ")}. I won't make a recommendation on bad data. Please correct the stock count.`
          : `I don't have enough information to confidently recommend an order. ${guard.reasons.join("; ")}. ${f.name} sold ${recent28} units in the last 28 days, so this is worth fixing.`,
        productId: f.id,
        confidence: 0,
        abstain: true,
        verdict: guard.verdict === "OK" ? "ABSTAIN" : guard.verdict,
        needsInfo: guard.needs,
        evidence: [
          {
            source: "inventory",
            label: "Current stock",
            value: f.stock,
            status: f.stock === null ? "MISSING" : f.stock < 0 ? "CONFLICTING" : "CONFIRMED",
            explanation: f.stock === null ? "No inventory record found." : f.stock < 0 ? `Inventory shows ${f.stock} units — physically impossible, so I am not trusting it.` : `Inventory shows ${f.stock} units.`,
          },
          {
            source: "sales",
            label: "Units sold, last 28 days",
            value: recent28,
            status: "CONFIRMED",
            explanation: "Demand exists, so a decision would be valuable once data is fixed.",
          },
          ...f.offers.slice(0, 3).map<Evidence>((o) => ({
            source: "supplier",
            label: `Supplier ${sName(ctx, o.supplierId)}`,
            value: { price: o.price, leadTimeDays: o.leadTimeDays, moq: o.moq },
            status: (o.price === null || o.leadTimeDays === null ? "MISSING" : "CONFIRMED") as Evidence["status"],
            explanation: "Supplier record as imported (incomplete).",
          })),
        ],
        action: {
          kind: isData ? "fix_data" : "gather_info",
          label: isData ? "Correct inventory data" : "Provide the missing information",
          productId: f.id,
        },
        risks: [{ label: "Acting on incomplete data", detail: "Any number I gave you here would be a guess, so I'm abstaining." }],
        alternatives: [],
        validation: null,
        calculation: null,
      });
    }
    return { signals, recs, risk: null, guard, primary, consolidated };
  }

  // ── Normal path ───────────────────────────────────────────────────────
  const stock = f.stock;
  const effStock = stock + f.inbound;
  const rate = fc.dailyRate;
  const risk = stockoutRisk({
    stock: effStock,
    dailyRate: rate,
    dailySd: fc.dailySd,
    leadTimeDays: primary.leadTimeDays,
  });
  const lowConf = guard.flags.includes("LOW_CONFIDENCE");
  const conflict = guard.flags.includes("FLAG_CONFLICT");
  const confidence =
    Math.round(fc.confidence * (lowConf ? 0.6 : 1) * (conflict ? 0.8 : 1) * 100) / 100;
  const stockoutRuns = possibleStockoutRuns(f.series);
  const trendTxt = `${fc.trendPct >= 0 ? "up" : "down"} ${Math.abs(pct(fc.trendPct))}%`;
  const cheaper = consolidated
    .filter((o) => o.supplierId !== primary.supplierId && o.price < primary.price)
    .sort((a, b) => a.price - b.price)[0];

  signals.push({
    productId: f.id,
    type: "inventory_risk",
    level: risk.level,
    score: risk.probability,
    payload: {
      stock,
      inbound: f.inbound,
      daysOfCover: risk.daysOfCover,
      leadTimeDays: primary.leadTimeDays,
      demandDuringLead: risk.demandDuringLead,
      probability: risk.probability,
      dailyRate: rate,
      flags: guard.flags,
    },
  });

  const prev = ctx.memory.previous[f.id];
  const baseEvidence: Evidence[] = [
    {
      source: "sales",
      label: "Demand trend",
      value: { trendPct: fc.trendPct, recentDailyRate: rate },
      status: "CONFIRMED",
      explanation: `Demand is ${trendTxt} versus the previous 6 weeks (about ${n1(rate)} units/day expected).`,
      timestamp: ctx.asOf,
    },
    {
      source: "inventory",
      label: "Stockout risk",
      value: { probability: risk.probability, level: risk.level, daysOfCover: risk.daysOfCover, demandDuringLead: risk.demandDuringLead },
      status: "INFERRED",
      explanation: `${pct(risk.probability)}% chance demand exceeds available stock before a new order could arrive in ${primary.leadTimeDays} days (expected demand in that time: ${n1(risk.demandDuringLead)} units; stock covers ${risk.daysOfCover ?? "?"} days). Statistical estimate from your sales history, not a recorded fact.`,
      timestamp: ctx.asOf,
    },
    {
      source: "inventory",
      label: "Inventory",
      value: f.inbound > 0 ? { onHand: stock, inbound: f.inbound } : stock,
      status: "CONFIRMED",
      explanation:
        f.inbound > 0
          ? `${stock} units on hand plus ${f.inbound} units already on order.`
          : `${stock} units on hand.`,
      timestamp: ctx.asOf,
    },
    {
      source: "forecast",
      label: "Forecast (next 7 days)",
      value: { expected: fc.expected, low: fc.low, high: fc.high, confidence: fc.confidence, model: fc.model },
      status: "INFERRED",
      explanation: `Expected demand ${n1(fc.low)}–${n1(fc.high)} units (point estimate ${n1(fc.expected)}). Model: ${fc.model}. Forecast confidence ${pct(fc.confidence)}%.`,
      timestamp: ctx.asOf,
    },
    {
      source: "supplier",
      label: "Supplier lead time",
      value: primary.leadTimeDays,
      status: conflict ? "CONFLICTING" : primary.leadTimeSource === "observed" ? "INFERRED" : "CONFIRMED",
      explanation:
        primary.leadTimeSource === "observed" && primary.observed
          ? `${sName(ctx, primary.supplierId)}: planning on ${primary.leadTimeDays} days. ${leadTimeStatement(primary.observed)} The supplier's sheet says ${primary.promisedLeadDays} days.`
          : `${sName(ctx, primary.supplierId)} needs ${primary.leadTimeDays} days to deliver — the supplier's stated lead time.${conflict ? " Sources disagreed on this value; the slowest was used." : ""}${primary.observed ? ` ${leadTimeStatement(primary.observed)}` : " No delivery has been recorded against an order yet, so nothing has been measured."}`,
    },
    {
      source: "supplier",
      label: "Supplier price",
      value: primary.price,
      status: conflict ? "CONFLICTING" : "CONFIRMED",
      explanation: `${inr(primary.price)} per unit${primary.moq ? `, MOQ ${primary.moq}` : ""}.${conflict ? " Sources disagreed on this value; the highest price was used." : ""}`,
    },
    {
      source: "sales",
      label: "Possible stockouts (inferred)",
      value: stockoutRuns,
      status: "INFERRED",
      explanation: `${stockoutRuns} run(s) of 4+ consecutive zero-sales days for an item that normally sells — inferred, not recorded.`,
    },
  ];
  // Event ledger provenance: the current quantity is a fold over immutable events, so it
  // can be explained ("+30 received, −7 sold, −2 damaged → 21") rather than asserted.
  const led = ctx.ledgerStock?.[f.id];
  if (led && led.events > 0) {
    baseEvidence.push({
      source: "ledger",
      label: "Inventory derived from event ledger",
      value: led,
      status: "CONFIRMED",
      explanation: `${led.quantity} units, derived by folding ${led.events} immutable inventory event(s). The current quantity is never written directly — corrections are added as new events.`,
      timestamp: ctx.asOf,
    });
  }
  if (cheaper) {
    baseEvidence.push({
      source: "supplier",
      label: "Alternative supplier",
      value: { supplier: cheaper.supplierId, price: cheaper.price, leadTimeDays: cheaper.leadTimeDays, moq: cheaper.moq },
      status: "CONFIRMED",
      explanation: `${sName(ctx, cheaper.supplierId)} lists ${inr(cheaper.price)} per unit (${inr(primary.price - cheaper.price)} cheaper), lead time ${cheaper.leadTimeDays} days${cheaper.moq ? `, MOQ ${cheaper.moq}` : ""}.`,
    });
  }
  if (prev) {
    baseEvidence.push({
      source: "memory",
      label: "Previous decision",
      value: prev,
      status: "CONFIRMED",
      explanation:
        prev.kind === "modified"
          ? `On ${prev.date} you changed Sahaay's suggestion from ${prev.recommended} to ${prev.approved}${prev.reason ? ` ("${prev.reason}")` : ""}.`
          : `On ${prev.date} you ${prev.kind} a recommendation for this product${prev.reason ? ` ("${prev.reason}")` : ""}.`,
    });
  }
  if (conflict)
    baseEvidence.push({
      source: "supplier",
      label: "Supplier data conflict",
      value: guard.reasons.filter((r) => r.includes("listed")),
      status: "CONFLICTING",
      explanation: "Conflicting supplier terms were found; the most pessimistic values were used.",
    });

  // ── Reorder ───────────────────────────────────────────────────────────
  if (risk.level === "HIGH" || risk.level === "CRITICAL") {
    const q = computeOrderQuantity({
      dailyRate: rate,
      leadTimeDays: primary.leadTimeDays,
      reviewPeriodDays: rules.reviewPeriodDays,
      safetyBufferPct: rules.safetyBufferPct,
      stock: effStock,
      moq: primary.moq,
    });
    if (q.quantity > 0) {
      const validationInput = {
        quantity: q.quantity,
        unitPrice: primary.price,
        supplierId: primary.supplierId,
        moq: primary.moq,
        sellPrice: f.sellPrice,
        monthlyDemand: rate * 30,
        currentStock: stock,
        totalStockUnits: ctx.totalStockUnits,
      };
      const validation = validateOrder(validationInput, rules);
      const cost = q.quantity * primary.price;
      const calc: Calculation = {
        quantity: q.quantity,
        validationInput,
        context: {
          rate, coverDays: q.coverDays, lead: primary.leadTimeDays, review: rules.reviewPeriodDays,
          demand: q.demand, buffer: q.buffer, bufferPct: rules.safetyBufferPct, stock: effStock,
          raw: q.raw, moq: primary.moq, moqBinding: q.moqBinding,
        },
        steps: [
          { label: "Expected daily demand", value: rate, formula: "from forecast" },
          { label: "Cover window (days)", value: q.coverDays, formula: `${primary.leadTimeDays} lead + ${rules.reviewPeriodDays} review` },
          { label: "Demand over cover window", value: q.demand, formula: `${rate} × ${q.coverDays}` },
          { label: "Safety buffer", value: q.buffer, formula: `${q.demand} × ${rules.safetyBufferPct}% (rounded up)` },
          { label: "Stock available now", value: effStock },
          { label: "Raw need", value: q.raw, formula: `${q.demand} + ${q.buffer} − ${effStock}` },
          { label: "Supplier MOQ (floor)", value: primary.moq ?? "none" },
          { label: "Recommended quantity", value: q.quantity, formula: "max(raw need, MOQ)" },
        ],
      };

      // ── Simulate: compare candidate quantities over many business futures ──
      // A single stockout probability hides the trade-off. The owner asks "if I order 10,
      // 15 or 20, what happens?" so we answer that directly instead of only naming one number.
      const horizonDays = primary.leadTimeDays + rules.reviewPeriodDays;
      const simCandidates = new Set<number>([q.quantity]);
      const minQty = Math.max(primary.moq ?? 1, Math.ceil(rate * primary.leadTimeDays * (1 + rules.safetyBufferPct / 100) - effStock));
      if (minQty > 0) simCandidates.add(minQty);
      for (const step of [0.75, 1.5]) {
        const c = Math.max(1, Math.round(q.quantity * step));
        if (c !== q.quantity) simCandidates.add(c);
      }
      const simRows = simulateDecision({
        stock: effStock,
        inbound: 0, // already folded into effStock
        dailyRate: rate,
        dailySd: fc.dailySd,
        leadTimeDays: primary.leadTimeDays,
        horizonDays,
        candidates: [...simCandidates],
        unitPrice: primary.price,
        sellPrice: f.sellPrice,
        reorderLevel: f.reorderLevel ?? 0,
        runs: SIM_RUNS,
        seed: simulationSeed(f.id),
      });
      const simulation: SimulationResult = {
        runs: SIM_RUNS,
        seed: simulationSeed(f.id),
        horizonDays,
        leadTimeDays: primary.leadTimeDays,
        stockAtStart: effStock,
        candidates: simRows.map((row) =>
          toCandidate(row, validateOrder({ ...validationInput, quantity: row.quantity }, rules).status),
        ),
        method: `${SIM_RUNS} simulated futures per quantity. Daily demand drawn from a normal distribution (mean = forecast rate, sd = forecast error). The order lands after ${primary.leadTimeDays} days. Stockout risk counts only days after that delivery, because that is the period your order size controls; shortages during the lead time are shown separately, since no order quantity can undo a stock level that is already too low. Overstock = the horizon ended above your reorder level.`,
        limitations: [
          "Demand is simulated from a constant daily rate: weekday and festival effects are not modelled.",
          "Supplier delay and partial deliveries are not simulated — the order arrives exactly on time.",
          "Selling price is treated as fixed, so a price change or a markdown is not simulated.",
          "Stockout risk counts only the days after your new delivery arrives; shortages during the lead time are reported separately.",
          "Units lost before the new stock arrives are caused by today's stock level — no order quantity can prevent them.",
          "Stockouts are counted in units, not in lost customers who came for something else.",
        ],
      };
      const best = simRows.reduce((a, b) => (a.quantity === q.quantity ? a : b.expectedLostUnits < a.expectedLostUnits ? b : a), simRows[0]);
      const simWin = best && best.quantity !== q.quantity;
      // Every simulation figure quoted in the summary must be traceable, so the table itself
      // becomes evidence (grounding gate G3 reads this).
      baseEvidence.push({
        source: "forecast",
        label: "Simulated futures per candidate quantity",
        value: simulation,
        status: "INFERRED",
        explanation: `${SIM_RUNS} simulated futures per quantity over ${horizonDays} days, starting from ${effStock} units. Stockout risk is the share of futures where demand exceeded available stock; expected leftover is what the horizon ends with. A model of possible demand, not a forecast of what will happen.`,
        timestamp: ctx.asOf,
      });

      const alternatives: Action[] = [];
      if (minQty > 0 && minQty < q.quantity)
        alternatives.push({
          kind: "order", productId: f.id, supplierId: primary.supplierId, quantity: minQty, unitPrice: primary.price,
          estimatedCost: minQty * primary.price,
          label: `Order ${minQty} now (covers the ${primary.leadTimeDays}-day lead time) and reassess in 3 days`,
        });
      if (cheaper) {
        const cq = computeOrderQuantity({
          dailyRate: rate, leadTimeDays: cheaper.leadTimeDays, reviewPeriodDays: rules.reviewPeriodDays,
          safetyBufferPct: rules.safetyBufferPct, stock: effStock, moq: cheaper.moq,
        });
        if (cq.quantity > 0)
          alternatives.push({
            kind: "order", productId: f.id, supplierId: cheaper.supplierId, quantity: cq.quantity, unitPrice: cheaper.price,
            estimatedCost: cq.quantity * cheaper.price, leadTimeDays: cheaper.leadTimeDays,
            label: `Order ${cq.quantity} from ${sName(ctx, cheaper.supplierId)} at ${inr(cheaper.price)} (lead time ${cheaper.leadTimeDays} days — slower)`,
          });
      }
      const ratio = ctx.memory.orderRatio;
      if (ratio !== null && ratio < 0.97) {
        const pref = Math.max(primary.moq ?? 1, Math.round(q.quantity * ratio));
        if (pref !== q.quantity)
          alternatives.push({
            kind: "order", productId: f.id, supplierId: primary.supplierId, quantity: pref, unitPrice: primary.price,
            estimatedCost: pref * primary.price,
            label: `Your usual adjustment (~${pct(ratio)}% of my suggestion): order ${pref}`,
          });
      }
      const bias = ctx.memory.forecastBias;
      if (bias !== null && Math.abs(bias) >= 0.15) {
        const adj = computeOrderQuantity({
          dailyRate: rate * (1 + bias), leadTimeDays: primary.leadTimeDays, reviewPeriodDays: rules.reviewPeriodDays,
          safetyBufferPct: rules.safetyBufferPct, stock: effStock, moq: primary.moq,
        });
        if (adj.quantity > 0 && adj.quantity !== q.quantity)
          alternatives.push({
            kind: "order", productId: f.id, supplierId: primary.supplierId, quantity: adj.quantity, unitPrice: primary.price,
            estimatedCost: adj.quantity * primary.price,
            label: `Bias-adjusted: past forecasts were ${bias < 0 ? "too high" : "too low"} by ~${Math.abs(pct(bias))}% here → order ${adj.quantity}`,
          });
      }
      if (validation.status === "block" && q.quantity > rules.maxOrderQuantity)
        alternatives.push({
          kind: "order", productId: f.id, supplierId: primary.supplierId, quantity: rules.maxOrderQuantity, unitPrice: primary.price,
          estimatedCost: rules.maxOrderQuantity * primary.price,
          label: `Order up to your configured limit (${rules.maxOrderQuantity})`,
        });

      const risks: Risk[] = [
        { label: "Forecast may be wrong", detail: `Demand could fall anywhere in ${n1(fc.low)}–${n1(fc.high)} units over 7 days (forecast confidence ${pct(fc.confidence)}%).` },
        { label: "Cash committed", detail: `This order ties up ${inr(cost)}.` },
      ];
      risks.push({
        label: "Simulation is a model, not a promise",
        detail: `Figures come from ${SIM_RUNS} simulated futures, not from the future itself. ${simulation.limitations[0]}`,
      });
      if (simWin) {
        risks.push({
          label: "A smaller order looked safer in simulation",
          detail: `Across ${SIM_RUNS} futures, ordering ${best.quantity} left ${best.expectedLostUnits} units of unmet demand on average versus ${simRows.find((r) => r.quantity === q.quantity)?.expectedLostUnits ?? "?"} for ${q.quantity}. Ordering ${q.quantity} still buys certainty.`,
        });
      }
      if (conflict) risks.push({ label: "Conflicting supplier data", detail: "Please confirm price and lead time with the supplier before ordering." });
      if (lowConf) risks.push({ label: "Thin sales history", detail: guard.reasons.find((r) => r.startsWith("Only")) ?? "Little history." });
      if (validation.status !== "pass") risks.push({ label: "Safety rules", detail: validation.checks.filter((c) => c.status === "warn" || c.status === "block").map((c) => c.message).join(" ") });

      const levelWord = risk.level === "CRITICAL" ? "critical" : "high";
      const altTxt = cheaper
        ? ` An alternative supplier (${sName(ctx, cheaper.supplierId)}) appears ${inr(primary.price - cheaper.price)} cheaper per unit — I recommend checking availability before ordering.`
        : "";
      const chosen = simRows.find((r) => r.quantity === q.quantity) ?? simRows[0];
      const simTxt = ` I simulated ${SIM_RUNS} possible futures: with ${q.quantity} units ordered, the chance of running out after the delivery arrives is ${pct(chosen.stockoutRisk)}%, and you would end the ${horizonDays}-day window with about ${n1(chosen.expectedLeftoverUnits)} unit(s) left over; ${best && best.quantity !== q.quantity ? `ordering ${best.quantity} instead would cut expected unmet demand to ${n1(best.expectedLostUnits)} unit(s)` : "no other quantity I tested meaningfully reduced unmet demand"}. Separately, about ${n1(chosen.expectedPreDeliveryLostUnits)} unit(s) of demand would go unmet before any new stock could arrive — that is a function of stock you already have, not of how much you order today.`;
      recs.push({
        dedupeKey: `reorder:${f.id}`,
        type: "reorder",
        severity: "high",
        title: f.name,
        summary: `${f.name} has a ${levelWord} stockout risk (${pct(risk.probability)}%) before the ${primary.leadTimeDays}-day supplier lead time ends. Stock covers about ${risk.daysOfCover ?? "?"} days at the forecast rate. Consider ordering ${q.quantity} units (about ${inr(cost)}).${altTxt}${simTxt}`,
        productId: f.id,
        confidence,
        abstain: false,
        verdict: guard.verdict,
        needsInfo: [],
        evidence: baseEvidence,
        action: {
          kind: "order", label: `Order ${q.quantity} units from ${sName(ctx, primary.supplierId)}`, productId: f.id,
          supplierId: primary.supplierId, quantity: q.quantity, unitPrice: primary.price, estimatedCost: cost,
          leadTimeDays: primary.leadTimeDays,
        },
        risks,
        alternatives: alternatives.slice(0, 4),
        validation,
        calculation: calc,
        simulation,
      });
    }
  } else if (risk.level === "WATCH") {
    recs.push({
      dedupeKey: `watch:${f.id}`,
      type: "inventory_warning",
      severity: "medium",
      title: f.name,
      summary: `${f.name} is on watch: stockout risk ${pct(risk.probability)}% over the ${primary.leadTimeDays}-day lead time. ${stock} on hand covers about ${risk.daysOfCover ?? "?"} days. No order is needed yet, but re-check in a few days.`,
      productId: f.id,
      confidence,
      abstain: false,
      verdict: guard.verdict,
      needsInfo: [],
      evidence: baseEvidence,
      action: { kind: "watch", label: "Keep an eye on it and reassess in 3 days", productId: f.id },
      risks: [{ label: "Risk can escalate", detail: "If demand rises towards the top of the forecast range, this becomes a reorder." }],
      alternatives: [],
      validation: null,
      calculation: null,
    });
  }

  // ── Slow moving ───────────────────────────────────────────────────────
  const cover = rate > 0.02 ? stock / rate : 999;
  if (stock >= 5 && ((cover > 45 && fc.trendPct <= -0.15) || cover > 120)) {
    const tied = f.unitCost !== null ? stock * f.unitCost : null;
    signals.push({
      productId: f.id, type: "slow_moving", level: "WATCH", score: Math.min(1, cover / 180),
      payload: { stock, cover: Math.round(cover), trendPct: fc.trendPct, tiedCapital: tied },
    });
    recs.push({
      dedupeKey: `slow:${f.id}`,
      type: "slow_moving",
      severity: "medium",
      title: f.name,
      summary: `Demand for ${f.name} is ${trendTxt}, and ${stock} units in stock would last about ${cover >= 999 ? "forever" : `${Math.round(cover)} days`}. You may be overstocked${tied ? ` (about ${inr(tied)} of stock at cost)` : ""}. Pause reordering and consider a discount.`,
      productId: f.id,
      confidence,
      abstain: false,
      verdict: guard.verdict,
      needsInfo: [],
      evidence: [
        baseEvidence[0], baseEvidence[1], baseEvidence[2],
        { source: "inventory", label: "Days of cover", value: cover >= 999 ? null : Math.round(cover), explanation: `At ${n1(rate)} units/day, current stock lasts ${cover >= 999 ? "indefinitely" : `${Math.round(cover)} days`}.` },
      ],
      action: { kind: "pause_reorder", label: "Pause reordering; consider a markdown", productId: f.id },
      risks: [{ label: "Markdown reduces margin", detail: "Discounting clears stock but lowers per-unit profit." }, { label: "Trend may recover", detail: "A short-term dip may be seasonal." }],
      alternatives: [{ kind: "watch", label: "Wait two more weeks and re-check the trend", productId: f.id }],
      validation: null,
      calculation: null,
    });
  }

  // ── Demand surge (opportunity) ────────────────────────────────────────
  if (fc.trendPct >= 0.4 && rate >= 1 && risk.level === "SAFE") {
    signals.push({ productId: f.id, type: "demand_surge", level: "OPPORTUNITY", score: fc.trendPct, payload: { trendPct: fc.trendPct, dailyRate: rate } });
    recs.push({
      dedupeKey: `surge:${f.id}`,
      type: "opportunity",
      severity: "opportunity",
      title: f.name,
      summary: `Demand for ${f.name} is ${trendTxt}. Stock is currently safe (${stock} units), but this is a product to feature, and to keep an eye on the supplier lead time (${primary.leadTimeDays} days).`,
      productId: f.id,
      confidence,
      abstain: false,
      verdict: guard.verdict,
      needsInfo: [],
      evidence: baseEvidence.slice(0, 4),
      action: { kind: "promote", label: "Feature this product and watch stock", productId: f.id },
      risks: [{ label: "Could be a short spike", detail: "Check again next week before committing more cash." }],
      alternatives: [],
      validation: null,
      calculation: null,
    });
  }

  return { signals, recs, risk, guard, primary, consolidated };
}

// ── Supplier opportunities (cross-product) ──────────────────────────────
export type SupplierScanItem = { facts: ProductFacts; fc: ForecastResult; analysis: ProductAnalysis };

export function supplierOpportunities(items: SupplierScanItem[], ctx: AnalysisContext): RecDraft[] {
  const bySupplier = new Map<string, { productId: string; name: string; from: string; fromPrice: number; toPrice: number; monthlyUnits: number; saving: number; leadDelta: number; moq: number | null; conf: number }[]>();
  for (const { facts, fc, analysis } of items) {
    const p = analysis.primary;
    if (!p || analysis.guard.verdict === "DATA_ERROR" || analysis.guard.verdict === "ABSTAIN") continue;
    const allowed = ctx.rules.allowedSuppliers;
    const alt = analysis.consolidated
      .filter((o) => o.supplierId !== p.supplierId && o.price < p.price * 0.98 && (!allowed.length || allowed.includes(o.supplierId)))
      .sort((a, b) => a.price - b.price)[0];
    if (!alt) continue;
    const monthlyUnits = fc.dailyRate * 30;
    const saving = (p.price - alt.price) * monthlyUnits;
    if (saving <= 0) continue;
    bySupplier.set(alt.supplierId, [
      ...(bySupplier.get(alt.supplierId) ?? []),
      { productId: facts.id, name: facts.name, from: p.supplierId, fromPrice: p.price, toPrice: alt.price, monthlyUnits: Math.round(monthlyUnits), saving: Math.round(saving), leadDelta: alt.leadTimeDays - p.leadTimeDays, moq: alt.moq, conf: fc.confidence },
    ]);
  }
  const out: RecDraft[] = [];
  for (const [supplierId, rows] of bySupplier) {
    const total = rows.reduce((s, r) => s + r.saving, 0);
    if (total < 500) continue;
    rows.sort((a, b) => b.saving - a.saving);
    const top = rows.slice(0, 8);
    const slower = rows.filter((r) => r.leadDelta > 0).length;
    const avgConf = rows.reduce((s, r) => s + r.conf, 0) / rows.length;
    const name = sName(ctx, supplierId);
    out.push({
      dedupeKey: `supplier:${supplierId}`,
      type: "supplier_change",
      severity: "opportunity",
      title: `Supplier ${name}`,
      summary: `${name} lists lower prices on ${rows.length} product(s) you already buy. At current demand, switching could save about ${inr(total)} over 30 days. Lead times and MOQs differ for some items — check availability and quality before switching.`,
      productId: null,
      confidence: Math.round(avgConf * 0.7 * 100) / 100,
      abstain: false,
      verdict: "OK",
      needsInfo: [],
      evidence: top.map<Evidence>((r) => ({
        source: "supplier",
        label: r.name,
        value: { from: r.from, fromPrice: r.fromPrice, toPrice: r.toPrice, monthlyUnits: r.monthlyUnits, saving: r.saving },
        explanation: `${inr(r.fromPrice)} → ${inr(r.toPrice)} per unit × ~${r.monthlyUnits} units/month ≈ ${inr(r.saving)} saving${r.leadDelta > 0 ? `; lead time ${r.leadDelta} days longer` : ""}${r.moq ? `; MOQ ${r.moq}` : ""}.`,
      })),
      action: {
        kind: "switch_supplier", label: `Trial ${name} on ${rows.length} product(s)`, supplierId,
        estimatedCost: -total,
        details: { products: top, totalSaving: Math.round(total) },
      },
      risks: [
        { label: "Availability unverified", detail: "Listed prices are from supplier records; stock and quality are unknown." },
        ...(slower ? [{ label: "Slower delivery", detail: `${slower} product(s) would have longer lead times.` }] : []),
        { label: "Demand estimate", detail: "Savings assume demand continues at the forecast rate." },
      ],
      alternatives: [{ kind: "switch_supplier", label: `Trial ${name} on only the top 3 products`, supplierId }],
      validation: null,
      calculation: null,
    });
  }
  return out;
}
