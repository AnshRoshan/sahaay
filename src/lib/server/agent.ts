// Sahaay Orchestrator: understand intent → call deterministic tools → compose facts →
// (optionally) let Gemma phrase them under a numeric-grounding gate → return with a trace.
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { consolidateOffers, pickPrimary } from "@/lib/analysis";
import { explainTemplate, type ExplainableRec } from "@/lib/explain";
import type { Action } from "@/lib/types";
import { getHistory, getInventoryRows, listRecs, type RecRow } from "./data";
import { learnedLeadTimes } from "./leadtime";
import { chatComplete, groundedAnswer, llmConfigured } from "./llm";
import { Tracer, type Span } from "./observability";
import { researchSuppliers, type ResearchResult } from "./research";
import { loadRules } from "./rules";

export type AgentContext = { recommendationId?: string; productId?: string };
export type Card = { id: string; title: string; severity: string; type: string; status: string; summary: string };
export type AgentResponse = {
  answer: string;
  source: "gemma" | "template";
  intent: string;
  cards: Card[];
  internal?: { heading: string; lines: string[] };
  external?: ResearchResult | null;
  recommendationId?: string;
  productId?: string;
  abstained?: boolean;
  note?: string;
  runId: string;
  spans: Span[];
};

const INTENTS = ["why_number", "cheaper_supplier", "last_decision", "overstock", "sales_decline", "reorder_advice", "inventory_status", "attention"] as const;
type Intent = (typeof INTENTS)[number] | "help";

function classify(t: string): Intent {
  if (/\bwhy\s+(?:did you recommend\s+|do you recommend\s+)?\d+\b|why (this|that|did you recommend|do you recommend)|explain (this|that|the)|how did you (get|calculate|arrive)/.test(t)) return "why_number";
  if (/cheaper|cheap\b|lower price|better price|alternative supplier|find .*supplier|another supplier/.test(t)) return "cheaper_supplier";
  if (/last decision|what happened|previous decision|my decisions?|outcome|how did .* go/.test(t)) return "last_decision";
  if (/overstock|slow.?moving|too much stock|excess|not selling|dead stock/.test(t)) return "overstock";
  if (/(sales|demand).*(fall|drop|declin|down|decreas|slow)|why .*(falling|dropping|declining)/.test(t)) return "sales_decline";
  if (/should i (order|reorder|buy)|what should i (order|buy)|order more|\breorder\b|how many .* order/.test(t)) return "reorder_advice";
  if (/run out|stock ?out|inventory|running low|low stock|which products/.test(t)) return "inventory_status";
  if (/attention|important|this week|today|briefing|happening|going on|worry|priorit|decisions/.test(t)) return "attention";
  return "help";
}

const tok = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

function findProduct(text: string, products: { id: string; name: string }[], recs: RecRow[]) {
  const words = new Set(tok(text));
  let best: { id: string; name: string; score: number }[] = [];
  let top = 0;
  for (const p of products) {
    const nt = tok(p.name).filter((w) => w.length > 1);
    const hit = nt.filter((w) => words.has(w)).length;
    if (hit < 2 && !(nt.length === 1 && hit === 1)) continue;
    const score = hit + (hit === nt.length ? 0.5 : 0);
    if (score > top) { top = score; best = [{ ...p, score }]; } else if (score === top) best.push({ ...p, score });
  }
  if (!best.length) return null;
  const rank: Record<string, number> = { high: 0, medium: 1, opportunity: 2 };
  best.sort((a, b) => {
    const ra = recs.find((r) => r.productId === a.id && r.status === "pending");
    const rb = recs.find((r) => r.productId === b.id && r.status === "pending");
    return (ra ? rank[ra.severity] : 9) - (rb ? rank[rb.severity] : 9);
  });
  return best[0];
}

const card = (r: RecRow): Card => ({ id: r.id, title: r.title, severity: r.severity, type: r.type, status: r.status, summary: r.summary.length > 170 ? r.summary.slice(0, 167) + "…" : r.summary });
const toExplainable = (r: RecRow): ExplainableRec => ({ title: r.title, type: r.type, summary: r.summary, confidence: r.confidence, abstain: r.abstain, needsInfo: r.needsInfo, evidence: r.evidence as ExplainableRec["evidence"], action: r.action as unknown as Action, risks: r.risks as ExplainableRec["risks"], alternatives: r.alternatives as unknown as Action[], calculation: r.calculation as unknown as ExplainableRec["calculation"] });
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

type Result = { facts: string; cards?: Card[]; internal?: AgentResponse["internal"]; external?: ResearchResult | null; recommendationId?: string; productId?: string; abstained?: boolean };

export async function runAgent(message: string, context: AgentContext = {}): Promise<AgentResponse> {
  const t = new Tracer("ask", message);
  try {
    t.note("user.request", { chars: message.length });
    const text = message.toLowerCase().trim();
    const [products, recs] = await t.span("tool:load_context", async (set) => {
      const p = await db.select({ id: s.products.id, name: s.products.name }).from(s.products);
      const r = await listRecs();
      set({ products: p.length, recommendations: r.length });
      return [p, r] as const;
    });
    if (!products.length) {
      const r = { facts: "I don't have any business data yet. Import your CSV files (or load the demo shop) on the Import page, and I'll start analysing.", cards: [] } as Result;
      return await finish(t, "help", message, r);
    }

    let intent = await t.span("agent.intent", async (set) => {
      let i = classify(text);
      if (i === "help" && llmConfigured()) {
        try {
          const out = await chatComplete([{ role: "system", content: `Classify the shop owner's question into exactly one of: ${INTENTS.join(", ")}, help. Reply with the single word only.` }, { role: "user", content: message }], 8000);
          const w = out?.trim().toLowerCase().replace(/[^a-z_]/g, "");
          if (w && (INTENTS as readonly string[]).includes(w)) i = w as Intent;
          set({ via: "gemma" });
        } catch { set({ via: "rules", llm: "unavailable" }); }
      }
      set({ intent: i });
      return i;
    });

    const ctxRec = context.recommendationId ? recs.find((r) => r.id === context.recommendationId) : undefined;
    const product =
      findProduct(text, products, recs) ??
      (context.productId ? (products.find((p) => p.id === context.productId) ?? null) : null) ??
      (ctxRec?.productId ? (products.find((p) => p.id === ctxRec.productId) ?? null) : null);
    const pending = recs.filter((r) => r.status === "pending");
    const productRec = product ? pending.find((r) => r.productId === product.id && (r.type === "reorder" || r.abstain)) ?? pending.find((r) => r.productId === product.id) : undefined;

    const result: Result = await t.span(`tool:${intent}`, async (set) => {
      set({ product: product?.id ?? null });
      switch (intent) {
        case "attention": {
          const top = pending.slice(0, 5);
          if (!top.length) return { facts: "Nothing needs your attention right now. All products are within safe levels, and no open recommendations are pending." };
          return {
            facts: `${pending.length} item${pending.length > 1 ? "s" : ""} need${pending.length > 1 ? "" : "s"} your attention. The most important:\n${top.map((r, i) => `${i + 1}. [${r.severity.toUpperCase()}] ${r.title}: ${r.summary}`).join("\n")}`,
            cards: top.map(card),
          };
        }
        case "inventory_status": {
          const rows = await getInventoryRows();
          const flagged = rows.filter((r) => ["CRITICAL", "HIGH", "WATCH"].includes(r.level));
          const bad = rows.filter((r) => r.level === "DATA_ERROR" || r.level === "ABSTAIN");
          const counts = ["CRITICAL", "HIGH", "WATCH", "SAFE"].map((l) => `${rows.filter((r) => r.level === l).length} ${l.toLowerCase()}`).join(", ");
          const lines = flagged.slice(0, 6).map((r) => `• ${r.name}: ${r.level} — stockout risk ${Math.round((r.probability ?? 0) * 100)}%, ${r.stock} in stock (~${r.daysOfCover ?? "?"} days of cover, lead time ${r.leadTimeDays} days)`);
          const gaps = bad.length ? `\nI can't assess ${bad.length} product(s) because of missing or invalid data: ${bad.slice(0, 4).map((b) => b.name).join(", ")}${bad.length > 4 ? "…" : ""}.` : "";
          return {
            facts: `Inventory right now across ${rows.length} products: ${counts}.${lines.length ? "\n" + lines.join("\n") : "\nNo product is at risk of stocking out."}${gaps}`,
            cards: pending.filter((r) => flagged.some((f) => f.id === r.productId) || bad.some((b) => b.id === r.productId)).slice(0, 5).map(card),
          };
        }
        case "reorder_advice": {
          if (product && productRec) {
            const a = productRec.action as unknown as Action;
            return {
              facts: productRec.abstain ? `I can't confidently recommend an order for ${product.name}. ${productRec.summary}${productRec.needsInfo.length ? `\nPlease provide: ${productRec.needsInfo.join("; ")}.` : ""}` : `${productRec.summary}${a.quantity ? ` Recommended order: ${a.quantity} units.` : ""}`,
              cards: [card(productRec)], recommendationId: productRec.id, productId: product.id, abstained: productRec.abstain,
            };
          }
          if (product) {
            const row = (await getInventoryRows()).find((r) => r.id === product.id);
            return { facts: `No order is currently recommended for ${product.name}. Risk level: ${row?.level ?? "unknown"}${row?.stock !== null && row?.stock !== undefined ? `, ${row.stock} units in stock` : ""}${row?.daysOfCover ? ` (about ${row.daysOfCover} days of cover)` : ""}.`, productId: product.id };
          }
          const orders = pending.filter((r) => r.type === "reorder" && !r.abstain);
          if (!orders.length) return { facts: "No reorders are recommended right now." };
          const total = orders.reduce((a, r) => a + ((r.action as unknown as Action).estimatedCost ?? 0), 0);
          return {
            facts: `${orders.length} reorder${orders.length > 1 ? "s are" : " is"} recommended (about ${inr(total)} in total):\n${orders.slice(0, 6).map((r) => `• ${r.title}: order ${(r.action as unknown as Action).quantity}`).join("\n")}`,
            cards: orders.slice(0, 5).map(card),
          };
        }
        case "why_number": {
          const num = /\b(\d+)\b/.exec(text)?.[1];
          const rec =
            ctxRec ??
            productRec ??
            (num ? pending.find((r) => (r.action as unknown as Action).quantity === Number(num)) : undefined) ??
            pending.find((r) => r.type === "reorder");
          if (!rec) return { facts: "There is no open recommendation to explain. Run an analysis first." };
          const q = (rec.action as unknown as Action).quantity;
          const mismatch = num && q !== undefined && Number(num) !== q ? `Note: the current recommendation for ${rec.title} is ${q}, not ${num}.\n` : "";
          return { facts: mismatch + explainTemplate(toExplainable(rec)), cards: [card(rec)], recommendationId: rec.id, productId: rec.productId ?? undefined, abstained: rec.abstain };
        }
        case "cheaper_supplier": {
          const target = product ?? (ctxRec?.productId ? products.find((p) => p.id === ctxRec.productId) : null);
          if (!target) {
            const sw = pending.filter((r) => r.type === "supplier_change");
            return { facts: sw.length ? `Which product do you want a cheaper supplier for? Meanwhile, I already found ${sw.length} supplier saving opportunit${sw.length > 1 ? "ies" : "y"} in your own supplier records:\n${sw.map((r) => `• ${r.title}: ${r.summary}`).join("\n")}` : "Which product do you want a cheaper supplier for? Name it and I'll compare your supplier records and search the web.", cards: sw.map(card) };
          }
          const offers = await db.select().from(s.supplierOffers).where(eq(s.supplierOffers.productId, target.id));
          const names = Object.fromEntries((await db.select().from(s.suppliers)).map((x) => [x.id, x.name]));
          const rules = await loadRules();
          const cons = consolidateOffers(offers, await learnedLeadTimes());
          const primary = pickPrimary(cons, rules.allowedSuppliers);
          const lines = cons.sort((a, b) => a.price - b.price).map((o) => `${names[o.supplierId] ?? o.supplierId}: ${inr(o.price)}/unit, lead time ${o.leadTimeDays} days${o.leadTimeSource === "observed" && o.observed ? ` (measured from ${o.observed.n} of your deliveries; their sheet says ${o.promisedLeadDays})` : " (as promised on your sheet)"}${o.moq ? `, MOQ ${o.moq}` : ""}${primary && o.supplierId === primary.supplierId ? " (Sahaay's pick)" : ""}`);
          const cheaper = primary ? cons.filter((o) => o.price < primary.price) : [];
          const facts = !cons.length ? `I have no usable supplier records for ${target.name}.` : cheaper.length ? `For ${target.name}, ${names[cheaper[0].supplierId] ?? cheaper[0].supplierId} in your records is ${inr(primary!.price - cheaper[0].price)} cheaper per unit than ${names[primary!.supplierId] ?? primary!.supplierId} (${inr(cheaper[0].price)} vs ${inr(primary!.price)}), but check lead time and MOQ.` : `Among the suppliers in your records, none is cheaper than ${primary ? (names[primary.supplierId] ?? primary.supplierId) : "your current one"} for ${target.name}.`;
          let external: ResearchResult | null = null;
          try { external = await t.span("tool:serpapi.research", async (st) => { const r = await researchSuppliers(target.name); st({ provider: r.provider, items: r.items.length, simulated: r.simulated }); return r; }); } catch { external = null; }
          return { facts, internal: { heading: "INTERNAL DATA — your supplier records", lines }, external, productId: target.id, recommendationId: productRec?.id, cards: productRec ? [card(productRec)] : [] };
        }
        case "last_decision": {
          const h = await getHistory();
          const d = h.decisions[0];
          if (!d) return { facts: "You haven't made any decisions yet. Approve, modify or reject a recommendation and I'll track what happens afterwards." };
          const head = `Your most recent decision: you ${d.kind} the recommendation for ${d.productName ?? "an item"} on ${d.decisionDate}${d.recommendedQty !== null ? ` (I recommended ${d.recommendedQty}${d.approvedQty !== null ? `; you ordered ${d.approvedQty}` : ""})` : ""}${d.reason ? `. Your reason: "${d.reason}"` : ""}.`;
          const tail = d.outcome ? d.outcome.note : "The outcome has not been measured yet — I need 7 days of sales data after the decision.";
          const pref = h.preferences[0] ? `\nWhat I've learned: ${h.preferences[0].statement}` : "";
          return { facts: `${head}\n${tail}${pref}`, recommendationId: d.recommendationId };
        }
        case "overstock": {
          const sl = pending.filter((r) => r.type === "slow_moving");
          if (!sl.length) return { facts: "No products are currently flagged as overstocked or slow-moving." };
          return { facts: `${sl.length} product(s) look overstocked:\n${sl.slice(0, 6).map((r) => `• ${r.title}: ${r.summary}`).join("\n")}`, cards: sl.slice(0, 5).map(card) };
        }
        case "sales_decline": {
          const fcs = await db.select().from(s.forecasts);
          const pm = new Map(products.map((p) => [p.id, p.name]));
          const falling = fcs.filter((f) => f.trendPct <= -0.15 && (!product || f.productId === product.id)).sort((a, b) => a.trendPct - b.trendPct).slice(0, 6);
          if (!falling.length) return { facts: product ? `Demand for ${product.name} is not declining meaningfully.` : "I don't see any product with a meaningful decline in demand versus the previous six weeks." };
          return {
            facts: `Demand is lower than the previous six weeks for:\n${falling.map((f) => `• ${pm.get(f.productId)}: down ${Math.abs(Math.round(f.trendPct * 100))}% (now about ${f.dailyRate} units/day)`).join("\n")}\nI can show that sales fell, but not why. I don't have data on price changes, season, competitors or promotions, so I won't guess a cause.`,
            cards: pending.filter((r) => r.type === "slow_moving").slice(0, 3).map(card),
          };
        }
        default:
          return {
            facts: "I can help with decisions about your inventory. Try: “What needs my attention?”, “Which products might run out?”, “Should I order Blue Shirt M?”, “Why 18?”, “Which products are overstocked?”, “Find a cheaper supplier for Blue Shirt M”, or “What happened after my last decision?”.",
          };
      }
    });
    if (intent === "help") intent = "help";
    return await finish(t, intent, message, result);
  } catch (e) {
    await t.finish("error", null, e);
    throw e;
  }
}

async function finish(t: Tracer, intent: string, question: string, r: Result): Promise<AgentResponse> {
  const g = await groundedAnswer({ facts: r.facts, fallback: r.facts, question, tracer: t });
  t.note("response.compose", { source: g.source });
  const resp: AgentResponse = {
    answer: g.text, source: g.source, intent, cards: r.cards ?? [], internal: r.internal, external: r.external,
    recommendationId: r.recommendationId, productId: r.productId, abstained: r.abstained, note: g.note,
    runId: t.id, spans: t.spans,
  };
  await t.finish("ok", { intent, source: g.source, answerPreview: g.text.slice(0, 200) });
  return resp;
}
