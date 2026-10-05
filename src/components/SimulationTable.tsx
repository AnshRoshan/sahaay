import type { SimulationResult } from "@/lib/types";
import { Bar, Td, Th, inr } from "./ui";

/**
 * "If I order 10, 15 or 20 — what actually happens?"
 * Every number here is the mean over N simulated futures, seeded so the table is reproducible.
 */
export default function SimulationTable({ simulation, recommended }: { simulation: SimulationResult; recommended?: number | null }) {
  if (!simulation?.candidates?.length) return null;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <Th>Order</Th>
              <Th>Stockout risk after delivery</Th>
              <Th>Overstock risk</Th>
              <Th>Unmet demand</Th>
              <Th>Lost before delivery</Th>
              <Th>Expected leftover</Th>
              <Th>Cash committed</Th>
              <Th>Expected net cash</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {simulation.candidates.map((c) => {
              const rec = recommended != null && c.quantity === recommended;
              return (
                <tr key={c.quantity} className={rec ? "bg-indigo-50/60" : undefined}>
                  <Td className="font-semibold">
                    {c.quantity}
                    {rec && <span className="ml-2 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">RECOMMENDED</span>}
                    {c.validationStatus === "block" && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">BLOCKED</span>}
                    {c.validationStatus === "warn" && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">WARN</span>}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="w-9 text-xs font-semibold">{Math.round(c.stockoutRisk * 100)}%</span>
                      <Bar value={c.stockoutRisk} color={c.stockoutRisk >= 0.6 ? "bg-red-500" : c.stockoutRisk >= 0.25 ? "bg-amber-500" : "bg-emerald-500"} />
                    </div>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="w-9 text-xs font-semibold">{Math.round(c.overstockRisk * 100)}%</span>
                      <Bar value={c.overstockRisk} color={c.overstockRisk >= 0.5 ? "bg-orange-500" : "bg-slate-400"} />
                    </div>
                  </Td>
                  <Td>{c.expectedLostUnits} unit{c.expectedLostUnits === 1 ? "" : "s"}</Td>
                  <Td className="text-slate-500">{c.expectedPreDeliveryLostUnits}</Td>
                  <Td>{c.expectedLeftoverUnits} units</Td>
                  <Td>{inr(c.orderCost)}</Td>
                  <Td className="font-medium">{inr(c.expectedCash)}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">{simulation.method}</p>
      <p className="text-xs text-slate-400">&ldquo;Lost before delivery&rdquo; is the same for every quantity: ordered units cannot arrive in time, so it reflects the stock you already hold.</p>
      {simulation.limitations.length > 0 && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-500">What this simulation does not model</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {simulation.limitations.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}