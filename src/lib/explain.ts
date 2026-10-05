// Deterministic explanations. The system calculates; models only rephrase. Pure.
import type { Action, Calculation, Evidence, Risk } from "./types";

export type ExplainableRec = {
  title: string;
  type: string;
  summary: string;
  confidence: number;
  abstain: boolean;
  needsInfo: string[];
  evidence: Evidence[];
  action: Action;
  risks: Risk[];
  alternatives: Action[];
  calculation: Calculation | null;
};

export function confidenceLabel(c: number): "High" | "Medium" | "Low" {
  return c >= 0.75 ? "High" : c >= 0.5 ? "Medium" : "Low";
}

const n1 = (x: unknown) => (typeof x === "number" ? String(Math.round(x * 10) / 10) : String(x));

export function explainTemplate(rec: ExplainableRec): string {
  if (rec.abstain) {
    return `I can't confidently recommend an action for ${rec.title}.\n${rec.needsInfo.length ? `Please provide:\n${rec.needsInfo.map((n) => `• ${n}`).join("\n")}` : rec.summary}`;
  }
  const c = rec.calculation?.context as
    | { rate: number; coverDays: number; lead: number; review: number; demand: number; buffer: number; bufferPct: number; stock: number; raw: number; moq: number | null; moqBinding: boolean }
    | undefined;
  if (rec.action.kind === "order" && c && rec.calculation?.quantity !== undefined) {
    const q = rec.calculation.quantity;
    return [
      `${q} was recommended because:`,
      `• Expected demand is ${n1(c.rate)} units/day, so ${n1(c.demand)} units over the ${c.coverDays}-day cover window (${c.lead}-day supplier lead time + ${c.review}-day review period).`,
      `• A ${c.bufferPct}% safety buffer adds ${c.buffer} units.`,
      `• You have ${c.stock} units available, so the raw need is ${c.raw}.`,
      c.moq ? `• The supplier minimum order quantity is ${c.moq}${c.moqBinding ? `, which raises the order to ${q}` : ", which is not binding here"}.` : "• No supplier MOQ applies.",
      `Calculation: ${n1(c.demand)} + ${c.buffer} − ${c.stock} = ${c.raw}${c.moqBinding ? ` → raised to MOQ ${c.moq}` : ""} → ${q}.`,
      `Confidence: ${confidenceLabel(rec.confidence)} (${Math.round(rec.confidence * 100)}%).`,
    ].join("\n");
  }
  return [
    `${rec.title}: ${rec.action.label}.`,
    ...rec.evidence.slice(0, 5).map((e) => `• ${e.label}: ${e.explanation}`),
    `Confidence: ${confidenceLabel(rec.confidence)} (${Math.round(rec.confidence * 100)}%).`,
  ].join("\n");
}

/** Plain-text facts handed to a language model. Contains every number it may use. */
export function factsText(rec: ExplainableRec): string {
  return [
    `Product: ${rec.title}`,
    `Recommendation: ${rec.action.label}`,
    `Confidence: ${Math.round(rec.confidence * 100)}%`,
    ...(rec.calculation?.steps ?? []).map((s) => `${s.label}: ${s.value}${s.formula ? ` (${s.formula})` : ""}`),
    ...rec.evidence.map((e) => `${e.label}: ${e.explanation}`),
    ...rec.risks.map((r) => `Risk — ${r.label}: ${r.detail}`),
    ...rec.alternatives.map((a) => `Alternative: ${a.label}`),
    `Summary: ${rec.summary}`,
  ].join("\n");
}
