"use client";
import Link from "next/link";
import { useState } from "react";
import EvidenceList, { CalcTable, ValidationList, type EvidenceLike } from "./EvidenceList";
import SimulationTable from "./SimulationTable";
import { Bar, ConfidencePill } from "./ui";
import type { SimulationResult } from "@/lib/types";

export type DrawerRec = {
  id: string; title: string; summary: string; confidence: number; abstain: boolean;
  evidence: EvidenceLike[]; risks: { label: string; detail: string }[];
  calculation: { steps: { label: string; value: number | string; formula?: string }[] } | null;
  validation: { status: string; checks: { rule: string; status: string; message: string }[] } | null;
  simulation?: SimulationResult | null;
  recommendedQty?: number | null;
};

export default function EvidenceDrawer({ rec, label = "View reasoning" }: { rec: DrawerRec; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50">{label}</button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={() => setOpen(false)}>
          <aside className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-indigo-600">Why this recommendation?</div>
                <h2 className="mt-1 text-xl font-semibold text-slate-900">{rec.title}</h2>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Close">✕</button>
            </div>
            <p className="mt-3 text-sm text-slate-700">{rec.summary}</p>
            <h3 className="mt-5 text-sm font-semibold text-slate-900">Evidence</h3>
            <p className="text-xs text-slate-500">Every claim is labelled by how much it can be trusted: CONFIRMED (a recorded fact), INFERRED (computed), MISSING, or CONFLICTING (sources disagree).</p>
            <EvidenceList evidence={rec.evidence} />
            {rec.simulation && (
              <>
                <h3 className="mt-5 text-sm font-semibold text-slate-900">If you ordered different amounts</h3>
                <p className="mb-2 text-xs text-slate-500">{rec.simulation.runs} simulated futures per quantity. This is a model of possible demand, not a promise.</p>
                <SimulationTable simulation={rec.simulation} recommended={rec.recommendedQty ?? null} />
              </>
            )}
            {rec.calculation && (<><h3 className="mt-5 text-sm font-semibold text-slate-900">Calculation (deterministic)</h3><CalcTable steps={rec.calculation.steps} /></>)}
            {rec.validation && (<><h3 className="mt-5 text-sm font-semibold text-slate-900">Safety checks — {rec.validation.status.toUpperCase()}</h3><ValidationList report={rec.validation} /></>)}
            {rec.risks.length > 0 && (<><h3 className="mt-5 text-sm font-semibold text-slate-900">Risks</h3><ul className="mt-1 space-y-1 text-sm text-slate-700">{rec.risks.map((r, i) => <li key={i}>• <b>{r.label}:</b> {r.detail}</li>)}</ul></>)}
            <div className="mt-6 rounded-xl bg-slate-50 p-4">
              <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Recommendation confidence</div>
              <Bar value={rec.confidence} color="bg-indigo-600" />
              <div className="mt-2"><ConfidencePill value={rec.confidence} abstain={rec.abstain} /></div>
            </div>
            <Link href={`/decisions/${rec.id}`} className="mt-5 inline-block text-sm font-medium text-indigo-700 hover:underline">Open full decision page →</Link>
          </aside>
        </div>
      )}
    </>
  );
}
