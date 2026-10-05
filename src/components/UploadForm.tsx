"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "./ui";

type Report = { kind: string | null; filename: string | null; rowsTotal: number; rowsOk: number; rowsRejected: number; detectedColumns: Record<string, string>; issues: { code: string; severity: string; message: string }[]; error?: string };

export default function UploadForm() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [err, setErr] = useState("");

  async function upload() {
    setBusy(true);
    setErr("");
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    const res = await fetch("/api/import", { method: "POST", body: fd });
    const j = (await res.json().catch(() => ({}))) as { reports?: Report[]; error?: string };
    if (!res.ok) setErr(j.error ?? "Upload failed");
    else { setReports(j.reports ?? []); setFiles([]); router.refresh(); }
    setBusy(false);
  }

  return (
    <div>
      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); setFiles(Array.from(e.dataTransfer.files).filter((f) => f.name.endsWith(".csv"))); }}
        className={cn("flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition", drag ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-slate-50 hover:border-indigo-400")}
      >
        <div className="text-3xl">⇪</div>
        <div className="mt-2 font-semibold text-slate-800">Drag sales.csv, inventory.csv, products.csv, suppliers.csv here</div>
        <div className="text-sm text-slate-500">or click to choose files — columns are detected automatically</div>
        <input type="file" accept=".csv,text/csv" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
      </label>
      {files.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {files.map((f) => <span key={f.name} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">{f.name} · {(f.size / 1024).toFixed(0)} KB</span>)}
          <button onClick={upload} disabled={busy} className="ml-auto rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">{busy ? "Analysing…" : "Import & analyse"}</button>
        </div>
      )}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {reports && (
        <div className="mt-4 space-y-3">
          {reports.map((r, i) => (
            <div key={i} className={cn("rounded-xl border p-4 text-sm", r.error ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50")}>
              <div className="font-semibold text-slate-900">{r.filename} → {r.kind ?? "unrecognised"}</div>
              {r.error ? <div className="mt-1 text-red-700">{r.error}</div> : (
                <>
                  <div className="text-slate-700">✓ {r.rowsOk.toLocaleString()} of {r.rowsTotal.toLocaleString()} rows imported{r.rowsRejected ? ` · ${r.rowsRejected} rejected` : ""}</div>
                  <div className="mt-1 text-xs text-slate-500">Detected columns: {Object.entries(r.detectedColumns).map(([k, v]) => `${k}←${v}`).join(", ")}</div>
                  {r.issues.map((x, k) => <div key={k} className={x.severity === "error" ? "text-red-700" : x.severity === "warning" ? "text-amber-800" : "text-slate-600"}>{x.severity === "info" ? "ℹ" : "⚠"} {x.message}</div>)}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
