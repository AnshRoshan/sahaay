import Link from "next/link";
import { Card, EmptyState, PageHeader, Stat, Td, Th } from "@/components/ui";
import { ledgerOverview } from "@/lib/server/ledger";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  stock_count: "Count", sale: "Sold", receipt: "Received", adjustment: "Adjusted", return: "Returned", order_placed: "Ordered",
};

/**
 * The event ledger is append-only: there is no edit or delete anywhere in this app.
 * A wrong number is fixed by adding another event, so the reason a quantity is what it is
 * is always visible.
 */
export default async function LedgerPage() {
  const o = await ledgerOverview(40);
  if (!o.events) {
    return (
      <EmptyState title="No inventory events yet" body="Import an inventory export or confirm a captured message, and every movement will be recorded here.">
        <Link href="/capture" className="text-indigo-700 underline">Go to Capture</Link>
      </EmptyState>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Operational event ledger"
        subtitle="Business truth is reconstructed from immutable events, not written directly. Nothing here can be edited or deleted — a correction is another event, so you can always see why a quantity is what it is."
        actions={<Link href="/capture" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">+ Record an event</Link>}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Products" value={o.products} hint={`data as of ${o.asOf}`} />
        <Stat label="Events" value={o.events} hint={`${o.counts} count · ${o.movements} movement`} />
        <Stat label="Conflicts" value={o.conflicts.length} hint="sources disagree" />
        <Stat label="Negative stock" value={o.negative.length} hint="physically impossible" />
      </div>

      {o.futureDated.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <h2 className="font-semibold text-slate-900">Events dated after your data</h2>
          <p className="mt-1 text-sm text-slate-700">
            {o.futureDated.length} product(s) have an event dated after {o.asOf}, the latest date in your data. Check the date on that event — I have folded it in, but it may be wrong.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-slate-800">
            {o.futureDated.map((f) => <li key={f.productId}>⚠ {f.productId}: latest event dated {f.lastEventAt}</li>)}
          </ul>
        </Card>
      )}

      {o.conflicts.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <h2 className="font-semibold text-slate-900">Conflicting records</h2>
          <p className="mt-1 text-sm text-slate-700">Both versions are kept. Nothing is resolved automatically — tell me which is right and I will record the correction as a new event.</p>
          <ul className="mt-2 space-y-1 text-sm text-slate-800">
            {o.conflicts.map((c, i) => <li key={i}>⚠ {c.detail}</li>)}
          </ul>
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="font-semibold text-slate-900">Current state, derived from events</h2>
          <p className="text-xs text-slate-500">Quantity = fold over every event for that product, oldest first.</p>
        </div>
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><Th>Product</Th><Th>Quantity</Th><Th>Baseline</Th><Th>Events</Th><Th>How it got there</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {o.states.map((s) => (
              <tr key={s.productId} className="hover:bg-slate-50">
                <Td className="font-medium">{s.productName}<div className="text-xs text-slate-400">{s.productId}</div></Td>
                <Td className={s.quantity < 0 ? "font-bold text-red-700" : "font-semibold"}>{s.quantity}</Td>
                <Td>{s.futureDated ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">dated after data</span> : s.baselineQty === null ? <span className="text-xs text-slate-400">no count yet</span> : `${s.baselineQty} on ${s.baselineDate}`}</Td>
                <Td>{s.eventCount}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {s.trail.slice(-6).map((t, i) => (
                      <span key={i} title={`${t.at} · ${t.source}${t.note ? ` · ${t.note}` : ""}`} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                        {t.delta >= 0 ? "+" : ""}{t.delta}
                      </span>
                    ))}
                  </div>
                  <div className="text-xs text-slate-400">last event {s.lastEventAt ?? "—"}</div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-x-auto p-0">
        <div className="border-b border-slate-200 px-5 py-3"><h2 className="font-semibold text-slate-900">Recent events</h2></div>
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><Th>Date</Th><Th>Product</Th><Th>Event</Th><Th>Qty</Th><Th>Source</Th><Th>Note</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {o.recent.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <Td className="whitespace-nowrap">{e.at}</Td>
                <Td>{e.productName}</Td>
                <Td>{KIND_LABEL[e.kind] ?? e.kind}</Td>
                <Td className={e.kind === "sale" ? "text-red-700" : e.kind === "order_placed" ? "text-slate-500" : e.kind === "stock_count" ? "" : "text-emerald-700"}>
                  {e.kind === "stock_count"
                    ? e.qty
                    : e.kind === "order_placed"
                      ? `${e.qty} committed · not in stock`
                      : `${e.kind === "sale" ? "" : "+"}${e.kind === "sale" ? -Math.abs(e.qty) : e.qty}`}
                </Td>
                <Td><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600">{e.source}</span></Td>
                <Td><div className="max-w-xs truncate text-xs text-slate-500">{e.note ?? "—"}</div></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}