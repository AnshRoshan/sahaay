import SettingsForm from "@/components/SettingsForm";
import { Card, PageHeader, cn } from "@/components/ui";
import { integrationStatus } from "@/lib/server/integrations";
import { loadRules } from "@/lib/server/rules";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const rules = await loadRules();
  const integrations = await integrationStatus();
  return (
    <div className="space-y-6">
      <PageHeader title="Business rules & permissions" subtitle="These rules are enforced by code on every recommendation and every human edit. The AI cannot override them." />
      <Card><SettingsForm rules={rules} /></Card>
      <Card>
        <h2 className="font-semibold text-slate-900">Your data</h2>
        <p className="mt-1 text-sm text-slate-700">Download everything Sahaay knows — products, suppliers, sales, the full event ledger, decisions, outcomes and rules — as one JSON file. The ledger is the source of record; nothing is locked in.</p>
        <a href="/api/export" className="mt-3 inline-block rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">⬇ Download full export (JSON)</a>
      </Card>
      <Card>
        <h2 className="font-semibold text-slate-900">Permissions</h2>
        <ul className="mt-2 space-y-1 text-sm text-slate-700">
          <li>✓ Sahaay can <b>read</b> your uploaded data and <b>propose</b> actions.</li>
          <li>✓ Sahaay can <b>draft</b> supplier messages for you to send.</li>
          <li>✕ Sahaay <b>never</b> places orders, contacts suppliers, or spends money on its own. Every consequential action needs your approval.</li>
          <li>✕ Sahaay never sends your sales, stock or price data to external services. Web research sends only a product name.</li>
        </ul>
      </Card>
      <Card>
        <h2 className="font-semibold text-slate-900">Integrations</h2>
        <ul className="mt-2 divide-y divide-slate-100">
          {integrations.map((i) => (
            <li key={i.name} className="flex flex-wrap items-start gap-3 py-2.5 text-sm">
              <span className={cn("mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase", i.state === "live" ? "bg-emerald-50 text-emerald-700" : i.state === "configured" ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-800")}>{i.state}</span>
              <div className="min-w-0 flex-1"><div className="font-medium text-slate-900">{i.name}</div><div className="text-xs text-slate-500">{i.role}</div><div className="text-xs text-slate-600">{i.detail}</div></div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
