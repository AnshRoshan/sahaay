import Chat from "@/components/Chat";
import { Card, PageHeader } from "@/components/ui";
import { llmConfigured, llmModel } from "@/lib/server/llm";

export const dynamic = "force-dynamic";

export default function Ask() {
  return (
    <div className="space-y-6">
      <PageHeader title="Ask Sahaay" subtitle="A decision-investigation layer. Questions run deterministic tools over your data; the language model (Gemma) only phrases the result and is blocked if it writes a number that isn't in the evidence." />
      <Card><Chat /></Card>
      <p className="text-xs text-slate-500">Language model: {llmConfigured() ? `Gemma via ${llmModel()}` : "not configured — answers are deterministic (set GEMMA_BASE_URL to enable Gemma phrasing)"}. Every answer has a trace you can open.</p>
    </div>
  );
}
