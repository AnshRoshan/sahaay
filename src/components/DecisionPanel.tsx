"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ValidationList } from "./EvidenceList";
import { cn, inr } from "./ui";

type Act = { kind: string; label: string; quantity?: number; unitPrice?: number; estimatedCost?: number; supplierId?: string; leadTimeDays?: number };
type Report = { status: string; checks: { rule: string; status: string; message: string }[] };

export default function DecisionPanel({
  id, status, abstain, needsInfo, action, alternatives, productName, supplierNames, decision,
}: {
  id: string; status: string; abstain: boolean; needsInfo: string[]; action: Act; alternatives: Act[];
  productName: string; supplierNames: Record<string, string>;
  decision: { kind: string; recommendedQty: number | null; approvedQty: number | null; reason: string | null; supplierId: string | null; unitPrice: number | null; leadTimeDays: number | null; orderedAtDate: string | null; arrivedAt: string | null; receivedQty: number | null } | null;
}) {
  const router = useRouter();
  const isOrder = action.kind === "order";
  const [qty, setQty] = useState(String(action.quantity ?? ""));
  const [supplier, setSupplier] = useState(action.supplierId);
  const [price, setPrice] = useState(action.unitPrice);
  const [lead, setLead] = useState(action.leadTimeDays);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOrder || status !== "pending" || abstain) return;
    const q = Number(qty);
    const valid = Boolean(qty) && Number.isFinite(q);
    // Clear the stale report inside the timer so no setState happens synchronously in the effect
    // body (React 19 warns: that causes a cascading extra render).
    const t = setTimeout(async () => {
      if (!valid) {
        setReport(null);
        return;
      }
      const r = await fetch(`/api/recommendations/${id}/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: q, supplierId: supplier }) });
      if (r.ok) setReport(((await r.json()) as { validation: Report }).validation);
    }, 250);
    return () => clearTimeout(t);
  }, [qty, supplier, id, isOrder, status, abstain]);

  async function submit(kind: "approved" | "rejected") {
    setBusy(true);
    setErr("");
    const q = Number(qty);
    const modified = isOrder && kind === "approved" && (q !== action.quantity || supplier !== action.supplierId);
    const res = await fetch(`/api/recommendations/${id}/decision`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: modified ? "modified" : kind, quantity: isOrder && kind === "approved" ? q : undefined, supplierId: supplier, reason, confirmWarnings: confirm }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string; validation?: Report };
    if (!res.ok) { setErr(j.error ?? "Failed"); if (j.validation) setReport(j.validation); setBusy(false); return; }
    router.refresh();
    setBusy(false);
  }

  const draft = (q: number, sup: string | null | undefined, pr: number | null | undefined, ld: number | null | undefined) =>
    `Hello ${sup ? (supplierNames[sup] ?? sup) : "team"},\nPlease confirm availability and send ${q} × ${productName}${pr ? ` at ${inr(pr)}/unit` : ""}.${ld ? ` We need delivery within ${ld} days.` : ""}\nThank you.`;

  if (status !== "pending") {
    const q = decision?.approvedQty ?? null;
    return (
      <div className="space-y-3 text-sm">
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="font-semibold capitalize text-slate-900">Decision: {decision?.kind ?? status}</div>
          {decision && decision.recommendedQty !== null && <div className="text-slate-700">Recommended {decision.recommendedQty}{q !== null ? ` → you chose ${q}` : ""}</div>}
          {decision?.reason && <div className="text-slate-600">Reason: “{decision.reason}”</div>}
        </div>
        {q !== null && q > 0 && (
          <>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Order message draft (Sahaay never contacts suppliers by itself)</div>
              <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800">{draft(q, decision?.supplierId, decision?.unitPrice, decision?.leadTimeDays)}</pre>
              <button onClick={() => { navigator.clipboard.writeText(draft(q, decision?.supplierId, decision?.unitPrice, decision?.leadTimeDays)); setCopied(true); }} className="mt-1 text-xs font-medium text-indigo-700 hover:underline">{copied ? "Copied ✓" : "Copy message"}</button>
            </div>
            {status !== "executed" ? (
              <button disabled={busy} onClick={async () => { setBusy(true); const r = await fetch(`/api/recommendations/${id}/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); if (!r.ok) setErr((await r.json().catch(() => ({})))?.error ?? "Could not record the order."); router.refresh(); setBusy(false); }} className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-medium text-slate-800 hover:bg-slate-50">I placed this order ✓</button>
            ) : (
              <OrderArrived id={id} orderedQty={q} orderedAt={decision?.orderedAtDate ?? null} arrivedAt={decision?.arrivedAt} receivedQty={decision?.receivedQty ?? null} onDone={() => router.refresh()} />
            )}
          </>
        )}
      </div>
    );
  }

  if (abstain) {
    return (
      <div className="space-y-3 text-sm">
        <div className="rounded-lg bg-slate-50 p-3 text-slate-800">
          <div className="font-semibold">I abstained — I won&apos;t guess.</div>
          <ul className="mt-1 list-disc pl-5">{needsInfo.map((n, i) => <li key={i}>{n}</li>)}</ul>
          <p className="mt-2 text-slate-600">Fix this in your CSV (Import data), upload again, and I&apos;ll re-run the analysis.</p>
        </div>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for dismissing (optional)" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
        <button disabled={busy} onClick={() => submit("rejected")} className="rounded-lg border border-slate-300 px-3.5 py-2 font-medium hover:bg-slate-50">Dismiss</button>
        {err && <p className="text-red-600">{err}</p>}
      </div>
    );
  }

  const changed = isOrder && (Number(qty) !== action.quantity || supplier !== action.supplierId);
  const needsConfirm = report?.status === "warn";
  const blocked = report?.status === "block";
  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sahaay recommends</div>
        <div className="text-base font-semibold text-slate-900">{action.label}</div>
        {action.estimatedCost !== undefined && action.estimatedCost > 0 && <div className="text-slate-600">Estimated cost {inr(action.estimatedCost)}</div>}
      </div>
      {isOrder && (
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quantity {supplier && <span className="normal-case text-slate-400">· {supplierNames[supplier] ?? supplier}{price ? ` · ${inr(price)}/unit` : ""}</span>}</label>
          <div className="mt-1 flex items-center gap-2">
            <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-base font-semibold" />
            {changed && <span className="text-xs text-sky-700">Modified from {action.quantity}</span>}
            {changed && <button onClick={() => { setQty(String(action.quantity)); setSupplier(action.supplierId); setPrice(action.unitPrice); setLead(action.leadTimeDays); }} className="text-xs text-slate-500 underline">reset</button>}
          </div>
          {alternatives.filter((a) => a.kind === "order" && a.quantity).length > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Alternatives</div>
              {alternatives.filter((a) => a.kind === "order" && a.quantity).map((a, i) => (
                <button key={i} onClick={() => { setQty(String(a.quantity)); setSupplier(a.supplierId); setPrice(a.unitPrice); setLead(a.leadTimeDays ?? action.leadTimeDays); }} className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-slate-700 hover:border-indigo-300 hover:bg-indigo-50">{a.label}</button>
              ))}
            </div>
          )}
          {report && <div className="mt-3 rounded-lg border border-slate-200 p-3"><div className={cn("mb-1 text-xs font-bold uppercase", blocked ? "text-red-600" : needsConfirm ? "text-amber-600" : "text-emerald-600")}>Safety checks: {report.status}</div><ValidationList report={report} /></div>}
        </div>
      )}
      {!isOrder && alternatives.length > 0 && <ul className="list-disc pl-5 text-slate-600">{alternatives.map((a, i) => <li key={i}>Alternative: {a.label}</li>)}</ul>}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your reason {changed ? "(recorded in decision memory)" : "(optional)"}</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={changed ? "e.g. Expected weekend demand lower" : "Why?"} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
      </div>
      {needsConfirm && (
        <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-amber-900">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
          <span>I understand the warnings above and confirm this order.</span>
        </label>
      )}
      {err && <p className="text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button disabled={busy || blocked || (needsConfirm && !confirm)} onClick={() => submit("approved")} className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy ? "Saving…" : isOrder ? (changed ? "Approve modified order" : "Approve") : "Accept"}
        </button>
        <button disabled={busy} onClick={() => submit("rejected")} className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Reject</button>
      </div>
    </div>
  );
}

/**
 * Purchase-order completion. "I placed this order" records an order that moves no stock; this
 * records the delivery, which is the only moment stock changes — and the gap between the two is
 * the supplier's real lead time, which replaces the "fastest delivery" assumption in ADR-010.
 */
function OrderArrived({ id, orderedQty, orderedAt, arrivedAt, receivedQty, onDone }: {
  id: string; orderedQty: number; orderedAt?: string | null; arrivedAt?: string | null; receivedQty?: number | null; onDone: () => void;
}) {
  const [at, setAt] = useState(orderedAt ?? "");
  const [qty, setQty] = useState(String(orderedQty));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const leadDays = arrivedAt && orderedAt ? Math.round((Date.parse(arrivedAt) - Date.parse(orderedAt)) / 86400000) : null;

  if (arrivedAt) {
    return (
      <div className="rounded-lg bg-teal-50 p-3 text-sm text-teal-900">
        <div className="font-semibold">Delivered — {receivedQty ?? orderedQty} unit(s) received on {arrivedAt}</div>
        {leadDays !== null && <div className="mt-0.5 text-teal-800">Actual lead time for this order: {leadDays} day{leadDays === 1 ? "" : "s"} (supplier promised {orderedAt ? "" : "no date"}). Sahaay learns the real figure from deliveries like this one.</div>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-xs font-semibold uppercase text-slate-500">When the goods actually arrived</div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">Date
          <input type="date" value={at} onChange={(e) => setAt(e.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1" />
        </label>
        <label className="text-xs text-slate-600">Units received
          <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 block w-28 rounded border border-slate-300 px-2 py-1" />
        </label>
        <button
          disabled={busy || !at || !(Number(qty) > 0)}
          onClick={async () => {
            setBusy(true); setErr("");
            const r = await fetch(`/api/recommendations/${id}/receive`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ at, qty: Number(qty) }) });
            if (!r.ok) setErr(((await r.json().catch(() => ({})))?.error) ?? "Could not record the delivery.");
            else onDone();
            setBusy(false);
          }}
          className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "Recording…" : "Goods arrived — add to stock"}
        </button>
      </div>
      {Number(qty) !== orderedQty && Number(qty) > 0 && <div className="mt-1 text-xs text-amber-700">You ordered {orderedQty} but are recording {qty} — noted as a {Number(qty) < orderedQty ? "partial" : "over"} delivery, and stock will move by {qty}.</div>}
      {err && <div className="mt-1 text-xs text-red-600">{err}</div>}
      <p className="mt-2 text-xs text-slate-500">Nothing is added to stock until you press this. Sahaay does not assume a delivery happened because an order was approved.</p>
    </div>
  );
}
