// Grounding checker: every number an LLM writes must exist in the structured facts. Pure.

export function extractNumbers(text: string): number[] {
  const cleaned = text
    .replace(/^\s*\d+[.)]\s/gm, "") // list markers
    .replace(/(\d),(?=\d{3}\b)/g, "$1"); // thousands separators
  const out: number[] = [];
  for (const m of cleaned.matchAll(/-?\d+(?:\.\d+)?/g)) out.push(Number(m[0]));
  return out;
}

function matches(x: number, allowed: number[]): boolean {
  const ax = Math.abs(x);
  return allowed.some((b0) => {
    const b = Math.abs(b0);
    return (
      Math.abs(ax - b) <= 0.051 ||
      Math.round(b) === ax ||
      Math.round(b * 10) / 10 === ax ||
      Math.round(b * 100) === ax || // 0.87 → 87%
      Math.abs(ax - b) / Math.max(b, 1) <= 0.002
    );
  });
}

export type GroundingResult = { ok: boolean; ungrounded: number[]; checked: number };

export function checkGrounding(text: string, factsText: string, extraAllowed: number[] = []): GroundingResult {
  const allowed = [...extractNumbers(factsText), ...extraAllowed];
  const nums = extractNumbers(text);
  const ungrounded = nums.filter((n) => !matches(n, allowed));
  return { ok: ungrounded.length === 0, ungrounded, checked: nums.length };
}
