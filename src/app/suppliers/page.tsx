import Link from "next/link";
import { Card, EmptyState, PageHeader, Td, Th, inr } from "@/components/ui";
import { getSupplierData, listRecs } from "@/lib/server/data";

export const dynamic = "force-dynamic";

export default async function Suppliers() {
  const [d, recs] = await Promise.all([getSupplierData(), listRecs(["pending"])]);
  if (!d.suppliers.length) return <EmptyState title="No suppliers yet" body="Import suppliers.csv to compare prices and lead times." />;
  const opps = recs.filter((r) => r.type === "supplier_change");
  return (
    <div className="space-y-6">
      <PageHeader title="Supplier intelligence" subtitle="Internal supplier records only. External web research is available per-decision and is always labelled separately." />
      {opps.length > 0 && (
        <Card className="border-emerald-200 bg-emerald-50">
          <h2 className="font-semibold text-emerald-900">🟢 Opportunities</h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-800">{opps.map((o) => <li key={o.id}>• <Link href={`/decisions/${o.id}`} className="font-medium text-indigo-700 hover:underline">{o.title}</Link>: {o.summary}</li>)}</ul>
        </Card>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {d.suppliers.map((s) => (
          <Card key={s.id}><div className="font-semibold">{s.name}</div><div className="text-xs text-slate-400">ID {s.id}</div>
            <div className="mt-2 text-sm text-slate-700">{s.products} product(s) · avg lead time {s.avgLead ?? "unknown"} d</div>
            {s.missingLead > 0 && <div className="text-xs text-amber-700">⚠ {s.missingLead} offer(s) missing lead time</div>}</Card>
        ))}
      </div>
      <Card className="overflow-x-auto p-0">
        <div className="p-4 pb-0"><h2 className="font-semibold text-slate-900">Price comparison (products with 2+ suppliers)</h2></div>
        <table className="mt-2 w-full">
          <thead className="border-y border-slate-200 bg-slate-50"><tr><Th>Product</Th><Th>Offers (price · lead · MOQ)</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {d.comparisons.map((c) => {
              const min = Math.min(...c.offers.map((o) => o.price ?? Infinity));
              return (
                <tr key={c.productId}><Td className="font-medium">{c.name}</Td>
                  <Td><div className="flex flex-wrap gap-2">{c.offers.map((o, i) => <span key={i} className={`rounded-lg border px-2 py-1 text-xs ${o.price === min ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200"}`}><b>{d.names[o.supplierId] ?? o.supplierId}</b> {inr(o.price)} · {o.lead ?? "?"}d · MOQ {o.moq ?? "?"}</span>)}</div></Td></tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
