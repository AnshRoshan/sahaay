import { handle, HttpError } from "@/lib/server/http";
import { getDataSummary } from "@/lib/server/data";
import { runAnalysis } from "@/lib/server/engine";
import { ingestCsv, type IngestReport, type Kind } from "@/lib/server/ingest";

export const dynamic = "force-dynamic";
const MAX = 25 * 1024 * 1024;

// Accepts multipart/form-data (files[]) or JSON { kind?, filename?, text }.
export async function POST(req: Request) {
  return handle(async () => {
    const reports: IngestReport[] = [];
    let analyze = true;
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const b = (await req.json()) as { kind?: Kind; filename?: string; text?: string; analyze?: boolean };
      if (!b.text) throw new HttpError(400, "text is required");
      if (b.text.length > MAX) throw new HttpError(413, "File too large");
      reports.push(await ingestCsv(b.text, { kind: b.kind, filename: b.filename }));
      analyze = b.analyze !== false;
    } else {
      const form = await req.formData();
      const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
      if (!files.length) throw new HttpError(400, "No files uploaded");
      // Import order matters for cross-checks: products → inventory → suppliers → sales
      const rank = (n: string) => (/product/i.test(n) ? 0 : /inventory|stock/i.test(n) ? 1 : /supplier|vendor/i.test(n) ? 2 : 3);
      files.sort((a, b) => rank(a.name) - rank(b.name));
      for (const f of files) {
        if (f.size > MAX) throw new HttpError(413, `${f.name} is too large`);
        reports.push(await ingestCsv(await f.text(), { filename: f.name }));
      }
      analyze = form.get("analyze") !== "false";
    }
    const summary = await getDataSummary();
    const ok = reports.some((r) => !r.error);
    const analysis = analyze && ok && summary.hasData && summary.salesRecords > 0 ? await runAnalysis().catch((e) => ({ error: String(e.message ?? e) })) : null;
    return { reports, summary, analysis };
  });
}
