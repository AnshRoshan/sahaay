# Demo script (≈ 5 minutes)

Preparation: open the app, **Overview → Reset demo shop**. Optional: start Ollama (Gemma) and set `GEMMA_BASE_URL`.

**Scene 1 — The problem (0:00).** Show the messy data (Import page after load): sales records, products, suppliers, plus warnings. "My friend has the data, but not the time to analyse it."

**Scene 2 — Upload.** On **Import data**, drag `sales.csv`, `inventory.csv`, `suppliers.csv`, `products.csv` (download links on the page). Show detected columns and the data-quality report: invalid dates *rejected, not guessed*, missing suppliers, negative stock.

**Scene 3 — Discovery.** **Overview**: "N things need attention", top 3 cards — 🔴 Blue Shirt M (stockout risk), then watch / slow-moving / 🟢 supplier saving. Play the voice briefing.

**Scene 4 — Prediction.** Click **Blue Shirt M** → forecast range, stock 7, stockout risk %, confidence.

**Scene 5 — Recommendation + Scene 6 — Why.** Open **View reasoning**: evidence bars, deterministic calculation, safety checks. In *Ask why* type **"Why 24?"** (use the actual number) → arithmetic from code. Show trace → deterministic tools, grounding gate.

**Scene 7 — Research.** Click **Search the web**: external results shown in a separate EXTERNAL box (simulated unless `SERPAPI_KEY` set). Compare with INTERNAL supplier terms (Bharat Garments ₹30 cheaper, slower).

**Scene 8 — Human approval.** Change quantity (e.g. 24 → 12), reason "Expected weekend demand lower". Try 500 → blocked live by rules. Approve → order message draft.

**Scene 9 — Memory.** **Decision history** + learned preference ("Owner prefers smaller orders when weekend demand is uncertain").

**Scene 10 — Monitoring.** Overview → **Simulate next 7 days** (labelled simulation). History shows actual vs forecast and whether your adjustment was closer.

**Scene 11 — Honesty.** Show abstentions (Rain Jacket L: lead time missing), DATA ERROR (Sweatshirt L), conflict (Linen Kurta M), low confidence (Silk Scarf).

**Scene 12 — Architecture.** **Architecture & traces**: pipeline, why each technology exists (live/fallback status), safety tests passing, agent traces.

Closing line: *"Sahaay follows the decision all the way to the outcome."*
