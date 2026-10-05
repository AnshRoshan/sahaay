// UTC-based date-string helpers (YYYY-MM-DD). Pure.

function toUtc(d: string): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

export function fmt(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(d: string, n: number): string {
  return fmt(toUtc(d) + n * 86400000);
}

/** a - b in whole days */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(a) - toUtc(b)) / 86400000);
}

export function weekdayOf(d: string): number {
  return new Date(toUtc(d)).getUTCDay();
}

export function todayStr(): string {
  return fmt(Date.now());
}

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, m - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return fmt(ms);
}

/**
 * Accepts ISO (2025-03-04, optional time) and day-first dd/mm/yyyy or dd-mm-yyyy.
 * Day-first is assumed for slashed dates (Indian convention) — documented in docs.
 * Anything else returns null and is reported — never guessed.
 */
export function parseDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return validYmd(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

export function formatDisplay(d: string): string {
  const dt = new Date(toUtc(d));
  return dt.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
