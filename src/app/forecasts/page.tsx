import { Bar, Card, EmptyState, PageHeader, Stat, Td, Th } from "@/components/ui";
import { getForecastEvaluation, getForecastRows } from "@/lib/server/data";

export const dynamic = "force-dynamic";

export default async function Forecasts() {
  const [rows, ev] = await Promise.all([getForecastRows(), getForecastEvaluation()]);
  if (!rows.length) return <EmptyState title="No forecasts yet" body="Run an analysis from the overview page." />;
  const model = rows[0].model;
  return (
    <div className="space-y-6">
      <PageHeader title="Demand forecasts" subtitle="A prediction answers “what is likely to happen?” — it never decides the action. Forecasts are shown as ranges with a confidence score, not as facts." />
      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">Active model: {model === "tabpfn" ? "TabPFN" : "Local statistical ensemble"}</span>
          <span className="text-slate-500">{model === "tabpfn" ? "Pooled tabular in-context regression with quantiles." : "TabPFN service not configured (TABPFN_URL) — using the built-in fallback. Evaluation below always measures the local engine."}</span>
        </div>
      </Card>
      {ev && (
        <Card>
          <h2 className="font-semibold text-slate-900">Forecast evaluation — rolling-origin backtest vs naive baseline</h2>
          <p className="text-xs text-slate-500">{ev.n} forecasts over {ev.products} products with ≥7 weeks history. Baseline: “next week = last week”.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Stat label="MAE (model)" value={ev.model.mae} hint={`baseline ${ev.baseline.mae}`} />
            <Stat label="RMSE (model)" value={ev.model.rmse} hint={`baseline ${ev.baseline.rmse}`} />
            <Stat label="Improvement vs baseline" value={`${ev.improvementPct}%`} hint="lower MAE is better" />
            <Stat label="Interval coverage" value={`${Math.round(ev.intervalCoverage * 100)}%`} hint="target ≈ 80%" />
          </div>
          {ev.worst.length > 0 && <p className="mt-3 text-xs text-slate-500">Hardest products (highest MAE): {ev.worst.map((w) => `${w.name} (${w.model} vs ${w.baseline})`).join(" · ")}</p>}
        </Card>
      )}
      <Card className="overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><Th>Product</Th><Th>Next 7 days</Th><Th>Range</Th><Th>Trend</Th><Th className="w-40">Confidence</Th><Th>History</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((f) => (
              <tr key={f.id} className="hover:bg-slate-50">
                <Td><div className="font-medium">{f.name}</div><div className="text-xs text-slate-400">{f.category}</div></Td>
                <Td className="font-semibold">{f.expected.toFixed(1)}</Td>
                <Td className="text-slate-600">{f.low.toFixed(0)}–{f.high.toFixed(0)} units</Td>
                <Td className={f.trendPct >= 0.1 ? "text-emerald-700" : f.trendPct <= -0.1 ? "text-red-700" : "text-slate-500"}>{f.trendPct >= 0.1 ? "↑" : f.trendPct <= -0.1 ? "↓" : "→"} {Math.round(f.trendPct * 100)}%</Td>
                <Td><div className="flex items-center gap-2"><span className="w-9 text-xs font-semibold">{f.confidence.toFixed(2)}</span><Bar value={f.confidence} /></div></Td>
                <Td className="text-xs text-slate-500">{f.historyDays} d</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
