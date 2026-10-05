import Link from "next/link";
import CaptureForm from "@/components/CaptureForm";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { listCaptures } from "@/lib/server/capture";

export const dynamic = "force-dynamic";

export default async function CapturePage() {
  const captures = await listCaptures(10);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Capture"
        subtitle="Tell me what happened in the shop — by typing or speaking — and I'll propose the inventory events. Nothing is recorded until you confirm each line."
      />
      <Card><CaptureForm /></Card>

      <Card>
        <h2 className="font-semibold text-slate-900">How this works</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li><b>Capture</b> — your message is the source. I read quantities, products and dates out of it.</li>
          <li><b>Verify</b> — each extracted fact is labelled CONFIRMED (you said it), INFERRED (I worked it out), MISSING (not in the message) or CONFLICTING (sources disagree). A line with a missing number is never filled in by me.</li>
          <li><b>Confirm</b> — you accept the lines you agree with. They become immutable events.</li>
          <li><b>Reduce</b> — the current quantity is derived by folding those events. Nothing overwrites history.</li>
        </ol>
        <p className="mt-2 text-xs text-slate-500">Try: “Kal 20 basmati carton aaya”, “3 blue shirt M bik gaye”, “2 cotton kurta damaged”, or “Sweatshirt L stock 4 hai”.</p>
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Recent captures</h2>
        {captures.length === 0 ? (
          <EmptyState title="Nothing captured yet" body="Your confirmed and discarded captures will appear here." />
        ) : (
          <ul className="space-y-2">
            {captures.map((c) => (
              <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">{c.channel}</span>
                  <span className="font-medium text-slate-800">{c.rawText}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${c.status === "confirmed" ? "bg-emerald-50 text-emerald-700" : c.status === "rejected" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-800"}`}>
                    {c.status}
                  </span>
                  <span className="ml-auto text-xs text-slate-400">{new Date(c.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
                </div>
                {c.status === "confirmed" && c.appliedEventIds.length > 0 && (
                  <div className="mt-1 text-xs text-slate-500">Recorded {c.appliedEventIds.length} event(s) — <Link href="/ledger" className="text-indigo-700 underline">see the ledger</Link></div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}