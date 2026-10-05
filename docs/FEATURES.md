# Feature list & status

Legend: ✅ implemented and exercised in the build sandbox · 🔌 adapter implemented; needs external service/credentials to go live (fallback active meanwhile) · 🔄 deliberate substitution · 🔭 future (not built, by design)

## A. Data foundation
| # | Feature | Status | Where |
|---|---|---|---|
| A1 | CSV upload (drag & drop, multi-file, auto-detect file type) | ✅ | `components/UploadForm`, `api/import`, `server/ingest` |
| A2 | Column detection with aliases (sku, qty, units, stock…) | ✅ | `ingest.ts` ALIASES |
| A3 | Row validation: invalid date / quantity / price / ids rejected & reported | ✅ | `ingest.ts` |
| A4 | Duplicate detection (transaction-id aware; identical rows reported as info) | ✅ | `ingest.ts` |
| A5 | Cross-table checks: missing supplier, missing lead time, conflicts, negative stock, missing inventory, unknown products | ✅ | `refreshCrossQuality` |
| A6 | "Data understanding" summary (records / products / suppliers / warnings) | ✅ | `/import`, Overview |
| A7 | Sample CSV downloads + demo dataset with deliberate edge cases | ✅ | `demo-data.ts`, `api/samples` |
| A8 | Persistence (PostgreSQL/Drizzle; JSONB documents) | ✅🔄 | `db/schema.ts` |

## B. Intelligence
| # | Feature | Status |
|---|---|---|
| B1 | Demand forecast: 7-day expected, range, confidence, trend | ✅ (local ensemble) |
| B2 | TabPFN structured prediction with quantiles + auto-fallback. Weights pinned to the v2 line for licensing; **Rules & settings probes the running service** instead of trusting the env var | 🔌 `services/tabpfn`, `forecast-service.ts` |
| B3 | Forecast evaluation: rolling-origin MAE/RMSE vs naive baseline, interval coverage | ✅ `/forecasts`, `/api/evaluation` |
| B4 | Inventory risk engine: SAFE/WATCH/HIGH/CRITICAL, stockout probability, days of cover | ✅ |
| B5 | Signals: stockout risk, slow-moving, demand surge, supplier saving | ✅ |
| B6 | Inferred historical stockouts (explicitly labelled "inferred") | ✅ |
| B7 | Inbound-order awareness (approved orders count as stock until delivered) | ✅ |
| B8 | **Decision simulator**: 400 seeded futures per candidate quantity → post-delivery stockout risk, overstock risk, unmet demand, pre-delivery loss, leftover, cash committed, net cash | ✅ `simulate.ts` |
| B9 | **Simulation limitations stated in the product**, not hidden (constant demand rate, no supplier delay, fixed price, pre-delivery loss excluded from risk) | ✅ `SimulationTable` |

## B2. Operational event ledger & capture
| # | Feature | Status |
|---|---|---|
| J1 | Append-only `ledger_events`: `stock_count` / `sale` / `receipt` / `adjustment` / `return`, with source and note | ✅ `ledger.ts`, `schema.ts` |
| J2 | Deterministic reducer: current quantity = fold over events in `(at, id)` order, with a running-balance trail | ✅ `reduceEvents` |
| J3 | No update/delete path: corrections are new events; duplicate event ids are rejected | ✅ `server/ledger.ts` |
| J4 | Conflict detection: two sources reporting the same movement differently → both kept, owner asked | ✅ `detectConflicts` |
| J5 | Future-dated events flagged so a wrongly-dated snapshot cannot silently discard history | ✅ `summarise(events, asOf)` |
| J6 | Inventory CSV export recorded as a dated `stock_count` baseline instead of an overwrite | ✅ `ingest.ts` |
| J7 | `/ledger` page: derived state per product, balance trail, conflicts, negative stock, recent events | ✅ |
| J8 | Typed + spoken capture ("Kal 30 blue shirt aaya aur 3 shirt bik gaye"), Hindi/Urdu + English number words. Devanagari script tokenises correctly now (marks kept with their consonant). Browser speech recognition is **single-language** — pick English(India) or हिन्दी per session; Hindi-English mixes get numbers wrong, so the transcript is editable before parsing | ✅ `/capture` |
| J9 | **Claim labels** on every extracted fact: CONFIRMED / INFERRED / MISSING / CONFLICTING, with the reason shown verbatim | ✅ `ClaimStatusBadge` |
| J10 | Human confirmation gate: a MISSING or CONFLICTING line is refused, not filled in; per-line corrections supported | ✅ `confirmCapture` |
| J11 | Unmatched text is surfaced to the owner instead of being dropped silently | ✅ |
| J12 | Claim labels on recommendation evidence rows (stockout risk = INFERRED, supplier conflict = CONFLICTING, inventory = CONFIRMED) | ✅ `EvidenceList` |
| J13 | Simulated deliveries/sales also appended as ledger events so derived state and inventory cannot drift | ✅ `simulateDays` |

## C. Decision engine
| # | Feature | Status |
|---|---|---|
| C1 | Recommendation object: type, evidence, action, confidence, risks, alternatives, status, validation, calculation | ✅ |
| C2 | Types: reorder, supplier_change, inventory_warning, slow_moving, opportunity | ✅ |
| C3 | Deterministic order quantity (demand + buffer − stock, MOQ floor) with visible arithmetic | ✅ |
| C4 | Alternatives: minimal order, cheaper supplier, owner's usual adjustment, forecast-bias-adjusted, limit-capped | ✅ |
| C5 | Evidence drawer (bars, source tags INTERNAL/EXTERNAL, raw data inspection) | ✅ |
| C6 | Explanation: deterministic template; Gemma rephrase gated by numeric grounding | ✅ / 🔌 Gemma |
| C7 | Ask Why ("Why 18?") answered from stored calculation | ✅ |
| C8 | Uncertainty: abstain / DATA_ERROR / FLAG_CONFLICT / LOW_CONFIDENCE | ✅ |
| C9 | Deterministic safety layer: max order, MOQ, cash limit, capacity, margin, allowed supplier, plausibility | ✅ |
| C10 | Dedupe/update on re-analysis; stale items expire | ✅ |

## D. Human loop & memory
| # | Feature | Status |
|---|---|---|
| D1 | Approve / Modify (quantity, supplier) / Reject with reason | ✅ |
| D2 | Live re-validation while editing; block → refuse, warn → explicit confirm | ✅ |
| D3 | Order message draft (copy) — Sahaay never contacts suppliers | ✅ |
| D4 | "I placed this order" → EXECUTED + an append-only `order_placed` event (commits cash, moves **no** stock; id derived from the decision so a double click cannot order twice) | ✅ |
| D4b | "Goods arrived" → RECEIVED + a correlated `receipt` event, with the date and the units that actually landed (partial/over delivery supported). The order→receipt gap is the raw material for learned lead time | ✅ |
| D5 | Decision lifecycle visible in UI — only stages that genuinely happened are stamped (an abstaining rec shows no SIMULATED/VALIDATED chip) | ✅ |
| D6 | Decision history: recommended vs human vs outcome | ✅ |
| D7 | Outcome monitoring: actual vs forecast, verdicts, comparison of owner's edit vs recommendation. Windows where the available stock all sold are **censored** (recorded sales understate demand), so those get an `indeterminate` verdict and are excluded from forecast-bias learning | ✅ `outcomes-core.ts` |
| D8 | Preference learning (order-size ratio, reason themes, forecast bias) → shown, only influences alternatives | ✅ |
| D9 | North-star metrics (decisions with measurable outcomes) | ✅ |
| D10 | Demo time-machine (simulate N days, deliveries, outcome measurement). Gated behind `DEMO_MODE=1`: it appends synthetic sales/receipts to the **real** ledger, so it is off wherever real data lives | ✅ (SIMULATION) |

## E. Assistant
| # | Feature | Status |
|---|---|---|
| E1 | Natural-language investigation: attention, inventory, reorder, why, overstock, sales decline, cheaper supplier, last decision | ✅ |
| E2 | Context carry-over (follow-up "Why 18?" on a decision page) | ✅ |
| E3 | Gemma intent fallback + grounded phrasing | 🔌 |
| E4 | Voice question input (browser SpeechRecognition) | ✅ (browser support varies) |
| E5 | Trace per answer | ✅ |

## F. External research
| # | Feature | Status |
|---|---|---|
| F1 | SerpApi supplier research with source, timestamp, query, relevance | 🔌 (needs `SERPAPI_KEY`) |
| F2 | Simulated candidates when no key — loudly labelled | ✅ |
| F3 | INTERNAL vs EXTERNAL separation in UI and data model | ✅ |
| F4 | Privacy: only product name leaves the system | ✅ |

## G. Automation & infrastructure
| # | Feature | Status |
|---|---|---|
| G1 | Workflows: weekly review, morning briefing, monthly slow-movers, outcome check | ✅ |
| G2 | Persisted step state + retries with backoff + failure capture | ✅ |
| G3 | Schedules + `/api/cron/tick` (Render cron / any scheduler) | ✅ |
| G4 | Temporal worker | 🔭 reference code in `services/worker`, **not deployed** — the in-app durable runner (G1–G3) is what actually runs schedules |
| G5 | Morning briefing (text) with attention-time estimate | ✅ |
| G6 | Voice briefing: ElevenLabs TTS / browser fallback | 🔌 / ✅ |
| G7 | Observability: per-run spans in-app (agent_runs) | ✅ |
| G8 | Sentry error forwarding | 🔌 adapter exists; deliberately off — forwarding errors would ship the owner's business data to a third party |
| G9 | Owner auth (access code, signed cookie) + open-mode warning. `SESSION_SECRET` missing in production is a hard error rather than the published dev fallback, and `/api/cron/tick` requires `CRON_SECRET` instead of falling back to session auth | ✅ |
| G10 | Render blueprint, Dockerfile, docker-compose. Paid Postgres plan (free plan self-deletes at 30 days); migrations committed under `drizzle/` and applied with `drizzle-kit migrate`, never from `buildCommand` | ✅ (files) |
| G11 | `/api/health` | ✅ |

## H. Quality
| # | Feature | Status |
|---|---|---|
| H1 | Safety suite S1–S11 (spec tests 1–5 + extras) | ✅ |
| H2 | Math suite M1–M3 | ✅ |
| H3 | Grounding suite G1–G3 | ✅ |
| H4 | Forecast backtest test vs baseline | ✅ |
| H5 | Live evaluation page | ✅ `/system` |
| H6 | Event ledger suite (reducer, baseline, conflicts, future-dated, claim labels) | ✅ `tests/ledger` |
| H7 | Capture parser suite (quantity extraction, missing quantity, unknown product, negation, damage sign) | ✅ `tests/ledger` |
| H8 | Simulator suite (reproducibility, ranges, monotonicity, trade-off, order credited once) | ✅ `tests/ledger` |

## I. Future (explicitly out of MVP scope)
🔭 WhatsApp Business API ingestion · receipt/photo OCR (the UdharBook lesson) · POS / Shopify / WooCommerce / Square / Razorpay / Google Sheets sync · multi-product and cash-constrained simulation (today's simulator is per-product) · model-assisted capture parsing behind the numeric-grounding gate · payment & cash-flow-aware decisions · supplier integrations · autonomous procurement · mobile app · Arduino UNO Q inventory device · multi-business · vertical packs · MongoDB Atlas adapter.
