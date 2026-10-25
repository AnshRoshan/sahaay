# Task tracker

`[x]` done and verified in the build sandbox · `[~]` implemented, needs external credentials/service to verify live · `[ ]` open

## Phase 0 — Friend research
- [x] Interview guide with the 10 questions + how answers change the product → `docs/friend-interview.md`
- [ ] **Run the interview with the real friend** and fill in answers
- [ ] Collect his real CSV/Excel exports; confirm column names map
- [ ] Capture real rules (max order, cash limit, storage) in Settings

## Phase 1 — Data foundation
- [x] Schema (Drizzle/Postgres)
- [x] CSV parser (quotes, BOM, delimiters)
- [x] Column detection + validation + quality report
- [x] Demo dataset with edge cases

## Phase 2 — Intelligence
- [x] Local forecast engine + confidence + intervals
- [x] Backtest harness vs baseline
- [x] Stockout risk engine
- [x] Signals (slow-moving, surge, supplier saving)
- [~] TabPFN service + client (run `services/tabpfn`, set `TABPFN_URL`). Weights pinned to
      `tabpfn>=2.0,<3`: the newer line is non-commercially licensed and ADR-017 refuses to serve it.
      Never benchmarked against the local engine — see docs/evaluation.md

## Phase 3 — Decision engine
- [x] Recommendation objects, evidence, calculations, alternatives
- [x] Deterministic validation engine
- [x] Guards: abstain / data error / conflict / low confidence
- [x] Grounded explanation templates

## Phase 4 — Human loop
- [x] Approve / modify / reject with live validation
- [x] Decision lifecycle UI
- [x] Order draft + executed marker
- [x] **Approve the funded whole-shop cash plan in one click** (`/api/recommendations/batch`):
      one human approval for the basket, but every order re-validated through the individual
      `decide()` gate at approval time; blocked refused, warnings never auto-confirmed (skipped
      for individual approval), downsizes recorded as `modified` with the trade-off in the reason.
      Verified live against the demo shop

## Phase 5 — Outcome loop
- [x] Outcome measurement + verdicts — **censored windows (stock fully sold) now yield `indeterminate`
      instead of a verdict, and are excluded from forecast-bias learning** (`src/lib/outcomes-core.ts`)
- [x] Preference learning
- [x] Time-machine simulation for demo
- [ ] Tune verdict thresholds with real outcomes after 4+ weeks of use
- [x] Risk bands (`SAFE/WATCH/HIGH/CRITICAL` cut points) are now owner-tunable rules
      (`riskWatchPct`/`riskHighPct`/`riskCriticalPct` in Settings, defaults 25/60/90; sorted and
      clamped defensively). Verified live: a stricter HIGH band escalates the same probabilities.
      Tuning the *values* still needs 4+ weeks of real outcomes per band

## Phase 5b — Event ledger, claim verification, simulation
- [x] Append-only `ledger_events` + deterministic reducer with balance trail (`src/lib/ledger.ts`)
- [x] Conflict detection across sources; future-dated events flagged against the as-of date
- [x] Inventory CSV export recorded as a dated `stock_count` baseline, not an overwrite
- [x] Typed/voice capture with Hindi+English number words, product matching, per-field claim labels (`src/lib/capture.ts`)
- [x] Human confirmation gate — MISSING/CONFLICTING lines refused; per-line corrections
- [x] Seeded Monte Carlo decision simulator over candidate quantities (`src/lib/simulate.ts`)
- [x] **Simulator realism from the owner's own data**: weekday demand multipliers (from recent
      sales, shrunk toward even — used only when a stable pattern exists) and supplier-delay
      variability (1.4826 × MAD of measured order→receipt gaps). Both degrade to the simple
      model when data is absent, and the per-product limitations text says which happened
      (9 tests, `tests/simulator`)
- [x] Simulation + ledger provenance attached to reorder recommendations; comparison table in UI
- [x] `/ledger` and `/capture` pages, `/api/ledger`, `/api/capture`
- [x] Tests: ledger reducer/conflicts/future-dating, capture parser, simulator invariants
- [ ] **Run the interview with the friend on the capture flow** — does he actually speak these
      sentences, or does he prefer tapping quantities? The research note stands: browser ASR is
      the bigger error source (measured Hinglish WER 27–70%), which is why model assistance is
      spans-only and the transcript stays editable
- [x] Whole-shop cash allocation across pending orders sharing the cash limit (`src/lib/budget.ts`,
      11 tests, `tests/budget`) — see Phase 4 for the one-click approval built on it
- [~] **Model-assisted capture parsing is implemented behind the grounding gate** (`ParseHints` in
      `src/lib/capture.ts` + `modelParseHints` in `server/capture.ts`): the model may only emit
      spans that exist **verbatim** in the message — movement segments and product words.
      Anything non-verbatim is discarded wholesale (no partial trust); the model never states a
      quantity (the number is still read from the owner's words by `quantityNearProduct`) and
      never classifies the movement; its involvement is visible as an INFERRED `product_span`
      claim; every parse carries a `parseSource` label. 7 tests (`tests/capture/model-spans`).
      Marked `[~]` because verifying with a real model needs Gemma live (`GEMMA_BASE_URL`);
      until then every parse is rules-only by construction
- [x] **Whole-shop paired simulation** (`src/lib/shop-sim.ts`): futures are paired across
      products so the totals describe the basket — expected total unmet demand (p50/p90),
      leftover, cash committed, net cash; deferred products included at quantity 0 so the cost
      of deferral is explicit. Returned with the batch approval. Honest scope: a portfolio
      summary over stored forecasts (constant rate per product); per-product realism inputs
      (weekday pattern, delay variability) are not re-simulated in the outlook
- [ ] Receipt/photo OCR for hand-written bills (UdharBook lesson) — **needs a service decision
      first**: no OCR engine is available in this repo, and the honest-fallback rule (invariant 7)
      forbids shipping a fake one. Blocked on choosing/self-hosting an OCR provider

## Phase 6 — Agent
- [x] Orchestrator with intents, tools, traces
- [x] Context carry-over, abstention in chat
- [~] Gemma phrasing + intent fallback (run Ollama, set `GEMMA_BASE_URL`)
- [x] Browser voice input

## Phase 7 — Infrastructure
- [x] Workflow runner, schedules, tick endpoint
- [x] In-app durable runner + `/api/cron/tick` is the real scheduler
- [~] Temporal worker (`services/worker`) — reference code, deliberately **not deployed**.
      Self-hosting needs a server + persistence DB + visibility store, and Temporal Cloud has a
      $500/mo minimum. Nothing in `src/` depends on it
- [x] In-app tracing; [~] Sentry forwarding (`SENTRY_DSN`)
- [x] Auth, Render blueprint, Docker files
- [x] **Data ownership export** (`/api/export`): full JSON download of business truth + decision
      memory, linked from Settings; verified live (11 tables)
- [x] Learned lead times visible per supplier on `/suppliers` with honest confidence labels

## Phase 8 — Optional integrations
- [~] SerpApi research (`SERPAPI_KEY`); [x] simulated fallback clearly labelled
- [~] ElevenLabs voice (`ELEVENLABS_API_KEY`); [x] browser fallback

## Phase 9 — Documentation
- [x] README, AGENTS, CONTEXT, FEATURES, TASKS
- [x] architecture, decisions (ADRs), evaluation, security, api
- [x] demo script, article outline

## Next (post-hackathon, in order)
1. [ ] Deploy to Render; set `SAHAAY_ACCESS_CODE`; verify cron tick. Blueprint now uses a **paid**
      Postgres plan (free plan self-deletes at 30 days), applies schema with `drizzle-kit migrate`
      outside the build, keeps `DEMO_MODE=0`, and the cron pinger POSTs with the bearer secret
2. [ ] Bring up TabPFN + Gemma; compare TabPFN vs local backtest on the friend's data
3. [x] Simulation trade-off in the morning briefing: every reorder line now carries the order's
      cost, and when the cash limit binds the plan quotes the downsize verbatim ("order 26 instead
      of 35 — +0.1 unmet units per the simulation") straight from the stored table
4. [x] Whole-shop cash allocation across pending orders sharing the cash limit — see Phase 5b.
      Greedy allocator (`budget.ts`) + paired whole-shop outlook (`shop-sim.ts`) + one-click
      approval of the funded set; all verified live against the demo shop
5. [ ] POS/Google Sheets sync (replace CSV)
6. [~] Record real "order placed" events → learn the real primary supplier — lifecycle +
      measurement implemented (`order_placed`/`receipt` events, `leadtime.ts`, 11 tests); needs the
      owner's real deliveries to have anything to learn from
7. [~] Cash-flow-aware limits — the whole-shop cash plan (`src/lib/budget.ts`) allocates the
      configured limit across pending orders; a cash-aware *simulator* (joint Monte Carlo) remains open
