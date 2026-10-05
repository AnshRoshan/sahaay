"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RuleSet } from "@/lib/types";

const FIELDS: { key: keyof RuleSet; label: string; hint: string }[] = [
  { key: "maxOrderQuantity", label: "Max order quantity (units)", hint: "Orders above this are blocked." },
  { key: "cashLimit", label: "Cash limit per order (₹)", hint: "Orders costing more are blocked." },
  { key: "minMarginPct", label: "Minimum margin (%)", hint: "Below this you get a warning to confirm." },
  { key: "inventoryCapacity", label: "Inventory capacity (total units)", hint: "Orders that would exceed storage are blocked." },
  { key: "safetyBufferPct", label: "Safety buffer (%)", hint: "Added on top of forecast demand when sizing orders." },
  { key: "reviewPeriodDays", label: "Review period (days)", hint: "Days between your ordering cycles; added to lead time." },
  { key: "plausibilityMultiple", label: "Plausibility multiple (×)", hint: "Warn when an order exceeds this × monthly demand." },
  { key: "minHistoryDays", label: "Minimum history (days)", hint: "Below this, forecasts are flagged low-confidence." },
];

export default function SettingsForm({ rules }: { rules: RuleSet }) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(Object.entries(rules).map(([k, x]) => [k, Array.isArray(x) ? x.join(", ") : String(x)])));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const body: Record<string, unknown> = {};
    for (const f of FIELDS) body[f.key] = Number(v[f.key]);
    body.allowedSuppliers = v.allowedSuppliers.split(",").map((x) => x.trim()).filter(Boolean);
    const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setMsg(res.ok ? "Saved. Re-run analysis to apply to open recommendations." : "Could not save");
    setBusy(false);
    router.refresh();
  }
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="block text-sm">
            <span className="font-medium text-slate-800">{f.label}</span>
            <input type="number" value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            <span className="text-xs text-slate-500">{f.hint}</span>
          </label>
        ))}
        <label className="block text-sm sm:col-span-2">
          <span className="font-medium text-slate-800">Allowed suppliers (IDs, comma-separated)</span>
          <input value={v.allowedSuppliers} onChange={(e) => setV({ ...v, allowedSuppliers: e.target.value })} placeholder="empty = any supplier" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          <span className="text-xs text-slate-500">Orders to suppliers not on this list are blocked.</span>
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">Save rules</button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </div>
  );
}
