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
- [~] TabPFN service + client (run `services/tabpfn`, set `TABPFN_URL`)

## Phase 3 — Decision engine
- [x] Recommendation objects, evidence, calculations, alternatives
- [x] Deterministic validation engine
- [x] Guards: abstain / data error / conflict / low confidence
- [x] Grounded explanation templates

## Phase 4 — Human loop
- [x] Approve / modify / reject with live validation
- [x] Decision lifecycle UI
- [x] Order draft + executed marker

## Phase 5 — Outcome loop
- [x] Outcome measurement + verdicts
- [x] Preference learning
- [x] Time-machine simulation for demo
- [ ] Tune verdict thresholds with real outcomes after 4+ weeks of use

## Phase 5b — Event ledger, claim verification, simulation
- [x] Append-only `ledger_events` + deterministic reducer with balance trail (`src/lib/ledger.ts`)
- [x] Conflict detection across sources; future-dated events flagged against the as-of date
- [x] Inventory CSV export recorded as a dated `stock_count` baseline, not an overwrite
- [x] Typed/voice capture with Hindi+English number words, product matching, per-field claim labels (`src/lib/capture.ts`)
- [x] Human confirmation gate — MISSING/CONFLICTING lines refused; per-line corrections
- [x] Seeded Monte Carlo decision simulator over candidate quantities (`src/lib/simulate.ts`)
- [x] Simulation + ledger provenance attached to reorder recommendations; comparison table in UI
- [x] `/ledger` and `/capture` pages, `/api/ledger`, `/api/capture`
- [x] Tests: ledger reducer/conflicts/future-dating, capture parser, simulator invariants
- [ ] **Run the interview with the friend on the capture flow** — does he actually speak these
      sentences, or does he prefer tapping quantities?
- [ ] Model-assisted capture parsing behind the grounding gate (rules-only today; honest about it)
- [ ] Whole-shop simulation across products sharing a cash limit (today's is per-product)
- [ ] Receipt/photo OCR for hand-written bills (UdharBook lesson)

## Phase 6 — Agent
- [x] Orchestrator with intents, tools, traces
- [x] Context carry-over, abstention in chat
- [~] Gemma phrasing + intent fallback (run Ollama, set `GEMMA_BASE_URL`)
- [x] Browser voice input

## Phase 7 — Infrastructure
- [x] Workflow runner, schedules, tick endpoint
- [~] Temporal worker (`services/worker`)
- [x] In-app tracing; [~] Sentry forwarding (`SENTRY_DSN`)
- [x] Auth, Render blueprint, Docker files

## Phase 8 — Optional integrations
- [~] SerpApi research (`SERPAPI_KEY`); [x] simulated fallback clearly labelled
- [~] ElevenLabs voice (`ELEVENLABS_API_KEY`); [x] browser fallback

## Phase 9 — Documentation
- [x] README, AGENTS, CONTEXT, FEATURES, TASKS
- [x] architecture, decisions (ADRs), evaluation, security, api
- [x] demo script, article outline

## Next (post-hackathon, in order)
1. [ ] Deploy to Render; set `SAHAAY_ACCESS_CODE`; verify cron tick
2. [ ] Bring up TabPFN + Gemma; compare TabPFN vs local backtest on the friend's data
3. [ ] Show the simulation table in the morning briefing ("order 20 vs 27")
4. [ ] Whole-shop simulation across products sharing a cash limit
5. [ ] POS/Google Sheets sync (replace CSV)
6. [ ] Record real "order placed" events → learn the real primary supplier
7. [ ] Cash-flow-aware limits
