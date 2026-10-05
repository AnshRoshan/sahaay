import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import * as s from "@/db/schema";
import ActionButton from "@/components/ActionButton";
import Chat from "@/components/Chat";
import DecisionPanel from "@/components/DecisionPanel";
import EvidenceList, { CalcTable, ValidationList, type EvidenceLike } from "@/components/EvidenceList";
import Lifecycle from "@/components/Lifecycle";
import ResearchPanel from "@/components/ResearchPanel";
import SimulationTable from "@/components/SimulationTable";
import { Card, ConfidencePill, SeverityBadge, StatusBadge, VerdictBadge, inr } from "@/components/ui";
import { getRecDetail, getSupplierData } from "@/lib/server/data";
import type { Action, SimulationResult } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DecisionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getRecDetail(id);
  if (!d) notFound();
  const { rec, decision, outcome, product } = d;
  const action = rec.action as unknown as Action;
  const alternatives = rec.alternatives as unknown as Action[];
  const calc = rec.calculation as { steps: { label: string; value: number | string; formula?: string }[] } | null;
  const validation = rec.validation as { status: string; checks: { rule: string; status: string; message: string }[] } | null;
  const risks = rec.risks as { label: string; detail: string }[];
  const simulation = rec.simulation as unknown as SimulationResult | null;
  const { names } = await getSupplierData();
  const offers = rec.productId ? await db.select().from(s.supplierOffers).where(eq(s.supplierOffers.productId, rec.productId)) : [];
  const qty = action.quantity;
  const suggestions = [qty ? `Why ${qty}?` : "Why did you recommend this?", "Find a cheaper supplier", "What happened after my last decision?"];

  return (
    <div className="space-y-6">
      <Link href="/decisions" className="text-sm text-slate-500 hover:text-slate-800">← All decisions</Link>
      <div>
        <div className="flex flex-wrap items-center gap-2"><SeverityBadge severity={rec.severity} /><StatusBadge status={rec.status} /><VerdictBadge verdict={rec.verdict} /><ConfidencePill value={rec.confidence} abstain={rec.abstain} /></div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{rec.title}</h1>
        <p className="text-sm text-slate-500">{product?.category ?? ""} {product ? `· ${product.id}` : ""}</p>
      </div>
      <Card><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Decision lifecycle</div><Lifecycle entries={rec.lifecycle} /></Card>
      <Card><p className="text-[15px] leading-relaxed text-slate-800">{rec.summary}</p></Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <h2 className="font-semibold text-slate-900">Why this recommendation?</h2>
            <p className="mb-1 text-xs text-slate-500">Every claim is grounded in your data and labelled by how much it can be trusted. Expand “Inspect underlying data” on any row.</p>
            <EvidenceList evidence={rec.evidence as EvidenceLike[]} />
          </Card>
          {simulation && simulation.candidates?.length > 0 && (
            <Card>
              <h2 className="font-semibold text-slate-900">What happens if you order a different amount?</h2>
              <p className="mb-3 text-xs text-slate-500">
                {simulation.runs} simulated futures for each quantity over {simulation.horizonDays} days, starting from {simulation.stockAtStart} units in stock.
                The order lands after {simulation.leadTimeDays} days. Change the quantity on the right to try one of these.
              </p>
              <SimulationTable simulation={simulation} recommended={qty ?? null} />
            </Card>
          )}
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Explanation</h2>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600">{rec.explanationSource === "gemma" ? "Gemma · numbers verified" : "Deterministic"}</span>
            </div>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-800">{rec.explanation}</pre>
            {calc && <div className="mt-4"><div className="mb-1 text-xs font-semibold uppercase text-slate-500">Calculation — computed by code, never by the model</div><CalcTable steps={calc.steps} /></div>}
            <div className="mt-4"><ActionButton endpoint={`/api/recommendations/${rec.id}/explain`} variant="secondary" done="explain">Re-explain with Gemma</ActionButton></div>
          </Card>
          {risks.length > 0 && <Card><h2 className="font-semibold text-slate-900">Risks</h2><ul className="mt-2 space-y-1.5 text-sm text-slate-700">{risks.map((r, i) => <li key={i}>⚠ <b>{r.label}:</b> {r.detail}</li>)}</ul></Card>}
          {validation && <Card><h2 className="font-semibold text-slate-900">Deterministic safety checks · <span className="uppercase">{validation.status}</span></h2><div className="mt-2"><ValidationList report={validation} /></div></Card>}
          {offers.length > 0 && (
            <Card>
              <h2 className="font-semibold text-slate-900">Supplier terms on file</h2>
              <div className="text-[11px] font-bold uppercase tracking-wide text-violet-700">INTERNAL DATA</div>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">{offers.map((o) => <li key={o.id}>• {names[o.supplierId] ?? o.supplierId}: {inr(o.price)}/unit · lead time {o.leadTimeDays ?? "unknown"} days · MOQ {o.moq ?? "unknown"}</li>)}</ul>
            </Card>
          )}
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-3 font-semibold text-slate-900">Your decision</h2>
            <DecisionPanel
              id={rec.id} status={rec.status} abstain={rec.abstain} needsInfo={rec.needsInfo} action={action} alternatives={alternatives}
              productName={product?.name ?? rec.title} supplierNames={names}
              decision={decision ? { kind: decision.kind, recommendedQty: decision.recommendedQty, approvedQty: decision.approvedQty, reason: decision.reason, supplierId: decision.supplierId, unitPrice: decision.unitPrice, leadTimeDays: decision.leadTimeDays, orderedAtDate: decision.orderedAtDate, arrivedAt: decision.arrivedAt, receivedQty: decision.receivedQty } : null}
            />
          </Card>
          {outcome && (
            <Card className="border-emerald-200 bg-emerald-50">
              <h2 className="font-semibold text-slate-900">Outcome measured</h2>
              <p className="mt-1 text-sm text-slate-800">{outcome.note}</p>
              <p className="mt-1 text-xs text-slate-500">Verdict: {outcome.verdict.replace("_", " ")}</p>
            </Card>
          )}
          {decision && !outcome && decision.recommendedQty !== null && <Card><h2 className="font-semibold text-slate-900">Monitoring</h2><p className="mt-1 text-sm text-slate-600">Sahaay is watching. The outcome is measured once {decision.outcomeWindowDays} days of sales exist after {decision.decisionDate}.</p><div className="mt-2"><ActionButton endpoint="/api/outcomes/measure" variant="secondary" done="outcomes">Check outcomes now</ActionButton></div></Card>}
          {rec.productId && (
            <Card>
              <h2 className="mb-2 font-semibold text-slate-900">Research</h2>
              <ResearchPanel id={rec.id} initial={rec.research as never} />
            </Card>
          )}
          <Card>
            <h2 className="mb-2 font-semibold text-slate-900">Ask why</h2>
            <Chat compact context={{ recommendationId: rec.id, productId: rec.productId ?? undefined }} suggestions={suggestions} />
          </Card>
        </div>
      </div>
    </div>
  );
}
