// Deterministic safety layer. Every AI/engine/human quantity passes through here. Pure.
import type { RuleSet, ValidationCheck, ValidationInput, ValidationReport } from "./types";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function validateOrder(i: ValidationInput, rules: RuleSet): ValidationReport {
  const checks: ValidationCheck[] = [];
  const add = (rule: string, status: ValidationCheck["status"], message: string) =>
    checks.push({ rule, status, message });

  const q = i.quantity;
  if (!Number.isInteger(q) || q <= 0) {
    add("quantity_valid", "block", `Quantity must be a positive whole number (got ${q}).`);
    return { status: "block", checks };
  }
  add("quantity_valid", "pass", `Quantity ${q} is a valid whole number.`);

  if (q > rules.maxOrderQuantity)
    add("max_order_quantity", "block", `${q} exceeds the configured maximum order of ${rules.maxOrderQuantity} units.`);
  else add("max_order_quantity", "pass", `${q} ≤ configured maximum ${rules.maxOrderQuantity}.`);

  if (i.moq !== null) {
    if (q < i.moq) add("supplier_moq", "block", `${q} is below the supplier minimum order quantity of ${i.moq}.`);
    else add("supplier_moq", "pass", `${q} meets the supplier MOQ of ${i.moq}.`);
  } else add("supplier_moq", "skipped", "Supplier MOQ unknown — cannot verify.");

  if (i.unitPrice !== null) {
    const cost = q * i.unitPrice;
    if (cost > rules.cashLimit)
      add("cash_limit", "block", `Order cost ${inr(cost)} exceeds the cash limit of ${inr(rules.cashLimit)}.`);
    else add("cash_limit", "pass", `Order cost ${inr(cost)} is within the cash limit of ${inr(rules.cashLimit)}.`);
  } else add("cash_limit", "skipped", "Unit price unknown — cannot verify cash limit.");

  const afterTotal = i.totalStockUnits + q;
  if (afterTotal > rules.inventoryCapacity)
    add("inventory_capacity", "block", `Total stock would reach ${afterTotal} units, above capacity ${rules.inventoryCapacity}.`);
  else add("inventory_capacity", "pass", `Total stock after order ${afterTotal} ≤ capacity ${rules.inventoryCapacity}.`);

  if (i.sellPrice !== null && i.unitPrice !== null && i.sellPrice > 0) {
    const margin = ((i.sellPrice - i.unitPrice) / i.sellPrice) * 100;
    if (margin < rules.minMarginPct)
      add("minimum_margin", "warn", `Margin ${margin.toFixed(0)}% is below your minimum of ${rules.minMarginPct}%.`);
    else add("minimum_margin", "pass", `Margin ${margin.toFixed(0)}% meets your minimum of ${rules.minMarginPct}%.`);
  } else add("minimum_margin", "skipped", "Selling price unknown — margin not checked.");

  if (rules.allowedSuppliers.length > 0) {
    if (i.supplierId && !rules.allowedSuppliers.includes(i.supplierId))
      add("allowed_supplier", "block", `Supplier ${i.supplierId} is not on your allowed list.`);
    else add("allowed_supplier", "pass", "Supplier is on your allowed list.");
  } else add("allowed_supplier", "skipped", "No supplier restrictions configured.");

  const plausible = Math.max(rules.plausibilityMultiple * i.monthlyDemand, i.moq ?? 0);
  if (i.monthlyDemand > 0 && q + Math.max(0, i.currentStock) > plausible + 0.0001 && q > plausible)
    add("plausibility", "warn", `${q} units is more than ${rules.plausibilityMultiple}× expected monthly demand (${Math.round(i.monthlyDemand)}). Please confirm.`);
  else add("plausibility", "pass", `Quantity is plausible against expected monthly demand of ${Math.round(i.monthlyDemand)}.`);

  const status = checks.some((c) => c.status === "block")
    ? "block"
    : checks.some((c) => c.status === "warn")
      ? "warn"
      : "pass";
  return { status, checks };
}
