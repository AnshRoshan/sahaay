// Minimal RFC-4180-ish CSV parser. Pure.

export type ParsedCsv = {
  headers: string[]; // normalised: lower_snake
  rows: Record<string, string>[];
  rowCount: number;
};

export function normaliseHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s\-/]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"]
    .map((d) => ({ d, n: firstLine.split(d).length }))
    .sort((a, b) => b.n - a.n)[0].d;

  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushRow = () => {
    row.push(field);
    field = "";
    if (row.some((x) => x.trim() !== "")) records.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else field += c;
  }
  if (field !== "" || row.length) pushRow();

  if (records.length === 0) return { headers: [], rows: [], rowCount: 0 };
  const headers = records[0].map(normaliseHeader);
  const rows = records.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      o[h] = (r[i] ?? "").trim();
    });
    return o;
  });
  return { headers, rows, rowCount: rows.length };
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n") + "\n";
}
