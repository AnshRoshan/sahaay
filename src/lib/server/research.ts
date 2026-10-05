// External research via SerpApi. Output is always tagged origin:"external" and never
// merged into internal evidence. Only the product name is sent out — no business data.

export type ResearchItem = {
  title: string;
  url: string | null;
  snippet: string;
  source: string;
  priceInr: number | null;
  moq: number | null;
  relevance: number; // 0..1 keyword overlap
};

export type ResearchResult = {
  origin: "external";
  provider: "serpapi" | "simulated";
  simulated: boolean;
  query: string;
  fetchedAt: string;
  items: ResearchItem[];
  note?: string;
};

export const serpConfigured = () => !!process.env.SERPAPI_KEY;

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);

export async function researchSuppliers(productName: string): Promise<ResearchResult> {
  const query = `${productName} wholesale supplier India price MOQ`;
  const fetchedAt = new Date().toISOString();
  const key = process.env.SERPAPI_KEY;
  if (!key) {
    return {
      origin: "external", provider: "simulated", simulated: true, query, fetchedAt,
      note: "SERPAPI_KEY is not set. These candidates are SIMULATED for demonstration — they are not real web results.",
      items: [
        { title: "Supplier A (simulated)", url: null, snippet: "₹410 per unit, MOQ 20", source: "simulated", priceInr: 410, moq: 20, relevance: 0.8 },
        { title: "Supplier B (simulated)", url: null, snippet: "₹390 per unit, MOQ 25", source: "simulated", priceInr: 390, moq: 25, relevance: 0.8 },
        { title: "Supplier C (simulated)", url: null, snippet: "₹385 per unit, MOQ unknown", source: "simulated", priceInr: 385, moq: null, relevance: 0.6 },
      ],
    };
  }
  const url = `https://serpapi.com/search.json?engine=google&gl=in&hl=en&num=8&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`SerpApi HTTP ${res.status}`);
  const json = (await res.json()) as { organic_results?: { title?: string; link?: string; snippet?: string; displayed_link?: string; source?: string }[] };
  const qt = tokens(productName);
  const items: ResearchItem[] = (json.organic_results ?? []).slice(0, 8).map((r) => {
    const text = `${r.title ?? ""} ${r.snippet ?? ""}`;
    const price = /(?:₹|Rs\.?|INR)\s?([\d,]+(?:\.\d+)?)/i.exec(text);
    const moq = /(?:MOQ|min(?:imum)?\.?\s*order(?:\s*quantity)?)[^\d]{0,15}(\d+)/i.exec(text);
    const tt = new Set(tokens(text));
    return {
      title: r.title ?? "Untitled",
      url: r.link ?? null,
      snippet: r.snippet ?? "",
      source: r.source ?? r.displayed_link ?? "web",
      priceInr: price ? Number(price[1].replace(/,/g, "")) : null,
      moq: moq ? Number(moq[1]) : null,
      relevance: qt.length ? Math.round((qt.filter((t) => tt.has(t)).length / qt.length) * 100) / 100 : 0,
    };
  });
  return { origin: "external", provider: "serpapi", simulated: false, query, fetchedAt, items };
}
