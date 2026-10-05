import Link from "next/link";
import { Bar, Card, EmptyState, LevelBadge, PageHeader, Td, Th } from "@/components/ui";
import { getInventoryRows } from "@/lib/server/data";

export const dynamic = "force-dynamic";

export default async function Inventory() {
  const rows = await getInventoryRows();
  if (!rows.length) return <EmptyState title="No inventory yet" body="Import products and inventory first."><Link href="/import" className="text-indigo-700 underline">Go to Import</Link></EmptyState>;
  const count = (l: string) => rows.filter((r) => r.level === l).length;
  return (
    <div className="space-y-6">
      <PageHeader title="Inventory intelligence" subtitle="Stockout risk = probability that demand during the supplier's lead time exceeds the stock you have (plus anything already on order). Levels: SAFE · WATCH · HIGH · CRITICAL. Items I can't assess are shown honestly as ABSTAIN or DATA ERROR." />
      <div className="flex flex-wrap gap-2 text-sm">{["CRITICAL", "HIGH", "WATCH", "SAFE", "ABSTAIN", "DATA_ERROR"].map((l) => <span key={l} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5"><LevelBadge level={l} /><b>{count(l)}</b></span>)}</div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><Th>Product</Th><Th>Status</Th><Th>Stock</Th><Th>Cover</Th><Th>Lead time</Th><Th>Forecast/day</Th><Th className="w-40">Stockout risk</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td><div className="font-medium">{r.name}</div><div className="text-xs text-slate-400">{r.category}</div>{r.reasons.length > 0 && <div className="text-xs text-slate-500">{r.reasons[0]}</div>}</Td>
                <Td><LevelBadge level={r.level} /></Td>
                <Td>{r.stock ?? "—"}{r.inbound > 0 && <span className="ml-1 text-xs text-sky-700">+{r.inbound} on order</span>}</Td>
                <Td>{r.daysOfCover !== null ? `${r.daysOfCover} d` : "—"}</Td>
                <Td>{r.leadTimeDays !== null ? `${r.leadTimeDays} d` : "—"}</Td>
                <Td>{r.dailyRate !== null ? r.dailyRate.toFixed(2) : "—"}</Td>
                <Td>{r.probability !== null ? <div className="flex items-center gap-2"><span className="w-9 text-xs font-semibold">{Math.round(r.probability * 100)}%</span><Bar value={r.probability} color={r.probability >= 0.6 ? "bg-red-500" : r.probability >= 0.25 ? "bg-amber-500" : "bg-emerald-500"} /></div> : <span className="text-xs text-slate-400">not assessed</span>}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
