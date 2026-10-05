// Executable safety + grounding evaluation (spec §43–44). Pure; used by tests, /api/evaluation and /system.
import { analyzeProduct, type AnalysisContext } from "./analysis";
import { assessInputs } from "./guards";
import { checkGrounding } from "./grounding";
import { computeOrderQuantity } from "./risk";
import { validateOrder } from "./validation";
import { DEFAULT_RULES, type ForecastResult, type ProductFacts, type SupplierOffer } from "./types";

export type EvalCase = { id: string; name: string; expected: string; actual: string; pass: boolean; category: "safety" | "grounding" | "math" };

const offer = (p: Partial<SupplierOffer> = {}): SupplierOffer => ({
  supplierId: "A", productId: "p1", price: 420, leadTimeDays: 6, moq: 10, ...p,
});
const series = (n: number, v: number) => Array.from({ length: n }, () => v);
const facts = (p: Partial<ProductFacts> = {}): ProductFacts => ({
  id: "p1", name: "Blue Shirt M", category: "Shirts", unitCost: 420, sellPrice: 799, stock: 7, inbound: 0,
  reorderLevel: 5, offers: [offer()], series: series(90, 2), historyDays: 90, totalUnits: 180, ...p,
});
const forecast = (p: Partial<ForecastResult> = {}): ForecastResult => ({
  productId: "p1", horizonDays: 7, expected: 14, low: 9, high: 19, dailyRate: 2, dailySd: 1.4,
  trendPct: 0.2, confidence: 0.8, model: "local-ensemble", historyDays: 90, ...p,
});
const ctx = (): AnalysisContext => ({
  asOf: "2025-06-01", rules: DEFAULT_RULES, totalStockUnits: 500, supplierNames: { A: "Anand" },
  memory: { orderRatio: null, forecastBias: null, previous: {} },
});

export function runSafetyCases(): EvalCase[] {
  const cases: EvalCase[] = [];
  const add = (c: Omit<EvalCase, "pass">) => cases.push({ ...c, pass: c.expected === c.actual });
  const rules = DEFAULT_RULES;

  add({ id: "S1", category: "safety", name: "Missing supplier lead time", expected: "ABSTAIN",
    actual: assessInputs({ name: "X", stock: 7, offers: [offer({ leadTimeDays: null })], historyDays: 90, totalUnits: 100 }, rules).verdict });
  add({ id: "S2", category: "safety", name: "Negative inventory", expected: "DATA_ERROR",
    actual: assessInputs({ name: "X", stock: -3, offers: [offer()], historyDays: 90, totalUnits: 100 }, rules).verdict });
  add({ id: "S3", category: "safety", name: "Quantity above configured limit (200 vs max 100)", expected: "block",
    actual: validateOrder({ quantity: 200, unitPrice: 420, supplierId: "A", moq: 10, sellPrice: 799, monthlyDemand: 40, currentStock: 5, totalStockUnits: 100 }, rules).status });
  add({ id: "S4", category: "safety", name: "Conflicting supplier information", expected: "FLAG_CONFLICT",
    actual: assessInputs({ name: "X", stock: 7, offers: [offer({ price: 420 }), offer({ price: 470 })], historyDays: 90, totalUnits: 100 }, rules).verdict });
  add({ id: "S5", category: "safety", name: "Insufficient sales history", expected: "LOW_CONFIDENCE",
    actual: assessInputs({ name: "X", stock: 7, offers: [offer()], historyDays: 9, totalUnits: 5 }, rules).verdict });
  add({ id: "S6", category: "safety", name: "Implausible vs demand but under cap (150 vs monthly 40, max raised)", expected: "warn",
    actual: validateOrder({ quantity: 150, unitPrice: 100, supplierId: "A", moq: 10, sellPrice: 799, monthlyDemand: 40, currentStock: 5, totalStockUnits: 100 }, { ...rules, maxOrderQuantity: 500 }).status });
  add({ id: "S7", category: "safety", name: "Cash limit exceeded", expected: "block",
    actual: validateOrder({ quantity: 90, unitPrice: 900, supplierId: "A", moq: 10, sellPrice: 1999, monthlyDemand: 100, currentStock: 5, totalStockUnits: 100 }, rules).status });
  add({ id: "S8", category: "safety", name: "Below supplier MOQ", expected: "block",
    actual: validateOrder({ quantity: 5, unitPrice: 420, supplierId: "A", moq: 10, sellPrice: 799, monthlyDemand: 40, currentStock: 5, totalStockUnits: 100 }, rules).status });
  add({ id: "S9", category: "safety", name: "Supplier not on allowed list", expected: "block",
    actual: validateOrder({ quantity: 20, unitPrice: 420, supplierId: "Z", moq: 10, sellPrice: 799, monthlyDemand: 40, currentStock: 5, totalStockUnits: 100 }, { ...rules, allowedSuppliers: ["A"] }).status });
  add({ id: "S10", category: "safety", name: "Healthy order passes (no false positive)", expected: "pass",
    actual: validateOrder({ quantity: 20, unitPrice: 420, supplierId: "A", moq: 10, sellPrice: 799, monthlyDemand: 40, currentStock: 5, totalStockUnits: 100 }, rules).status });

  const abst = analyzeProduct(facts({ offers: [offer({ leadTimeDays: null })] }), forecast(), ctx());
  add({ id: "S11", category: "safety", name: "Abstaining recommendation carries no order quantity", expected: "abstain-no-qty",
    actual: abst.recs[0]?.abstain && abst.recs[0].action.quantity === undefined ? "abstain-no-qty" : "invented-quantity" });

  const hi = analyzeProduct(facts(), forecast(), ctx());
  const rec = hi.recs.find((r) => r.type === "reorder");
  const calc = rec?.calculation?.context as { demand: number; buffer: number; stock: number; raw: number } | undefined;
  add({ id: "M1", category: "math", name: "Order quantity = demand + buffer − stock (floored at MOQ)", expected: "valid",
    actual: rec && calc && rec.action.quantity === Math.max(calc.raw, 10) && Math.ceil(calc.demand + calc.buffer - calc.stock) === calc.raw ? "valid" : "invalid" });
  const q = computeOrderQuantity({ dailyRate: 0.2, leadTimeDays: 5, reviewPeriodDays: 7, safetyBufferPct: 12, stock: 1, moq: 25 });
  add({ id: "M2", category: "math", name: "MOQ acts as a floor when raw need is small", expected: "25",
    actual: String(q.quantity) });
  add({ id: "M3", category: "math", name: "Recommendation respects configured rules", expected: "not-block",
    actual: rec?.validation?.status === "block" ? "block" : "not-block" });

  const factsTxt = "Order 18 units. Forecast 16 units. Stock 7. Lead time 6 days. Price ₹420.";
  add({ id: "G1", category: "grounding", name: "Grounded LLM text is accepted", expected: "accept",
    actual: checkGrounding("Order 18 units because forecast is 16 and you hold 7; lead time is 6 days.", factsTxt).ok ? "accept" : "reject" });
  add({ id: "G2", category: "grounding", name: "LLM text with an invented number is rejected", expected: "reject",
    actual: checkGrounding("Order 18 units; this should save you ₹9,999.", factsTxt).ok ? "accept" : "reject" });
  add({ id: "G3", category: "grounding", name: "Every numeric claim in a generated summary traces to evidence", expected: "accept",
    actual: rec ? (checkGrounding(rec.summary, JSON.stringify(rec.evidence) + JSON.stringify(rec.calculation) + JSON.stringify(rec.action)).ok ? "accept" : "reject") : "reject" });
  return cases;
}
