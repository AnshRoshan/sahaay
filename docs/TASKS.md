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

## Phase 5 — Outcome loop
- [x] Outcome measurement + verdicts — **censored windows (stock fully sold) now yield `indeterminate`
      instead of a verdict, and are excluded from forecast-bias learning** (`src/lib/outcomes-core.ts`)
- [x] Preference learning
- [x] Time-machine simulation for demo
- [ ] Tune verdict thresholds with real outcomes after 4+ weeks of use
- [ ] Risk bands (`SAFE/WATCH/HIGH/CRITICAL` cut points) are hard-coded and global — expose them as
      rules, then tune only once a band's Wilson interval excludes its target at n ≥ 25 per band

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
- [ ] Model-assisted capture parsing behind the grounding gate (rules-only today; honest about it).
      Research says gate this behind the interview: browser ASR is the bigger error source
      (measured Hinglish WER 27–70%), and an unadapted Gemma-class model scores ~62 F1 on
      code-mixed NER vs ~79 for a fine-tuned encoder. If the model path is ever added it may emit
      **spans only** — `rawText.slice(start, end)` must match verbatim and the existing `UNITS`
      resolver re-reads the number, so the model never states a quantity (see `parseWithModel`,
      still unimplemented).
- [ ] Whole-shop simulation across products sharing a cash limit (today's is per-product)
- [ ] Receipt/photo OCR for hand-written bills (UdharBook lesson)

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
3. [ ] Show the simulation table in the morning briefing ("order 20 vs 27")
4. [ ] Whole-shop simulation across products sharing a cash limit
5. [ ] POS/Google Sheets sync (replace CSV)
6. [ ] Record real "order placed" events → learn the real primary supplier
7. [ ] Cash-flow-aware limits
