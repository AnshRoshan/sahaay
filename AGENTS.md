# AGENTS.md — instructions for AI coding agents

Read `CONTEXT.md` first. This file is the operating manual.

## Mission
Sahaay is a **decision engine**, not a chatbot. Every change must support: *better operational decisions, explained, validated, approved by a human, and measured afterwards.*

## Non-negotiable invariants
1. **LLM never owns math or permissions.** Forecasts, inventory arithmetic, order quantities, validation, simulation → code in `src/lib/*` (pure). The LLM only rephrases (`src/lib/server/llm.ts`), and its output must pass `checkGrounding` or be discarded.
2. **Every quantity is validated** by `validateOrder` (`src/lib/validation.ts`) — both engine output and human edits (`decide()` in `src/lib/server/memory.ts`). `block` → HTTP 422, `warn` → HTTP 409 until `confirmWarnings`.
3. **Abstain, don't guess.** Missing stock/supplier/lead time → `ABSTAIN` rec with no quantity. Negative stock → `DATA_ERROR`. Conflicting supplier rows → `FLAG_CONFLICT` (pessimistic values, lower confidence). Thin history → `LOW_CONFIDENCE`. See `src/lib/guards.ts`.
4. **Never silently assume data.** Ingestion rejects/flags and records issues (`src/lib/server/ingest.ts`).
5. **Internal vs external is never blurred.** Web results live in `recommendations.research` / chat `external`, are labelled EXTERNAL, and are never added to `evidence`.
6. **Sahaay never acts on the world.** It drafts supplier messages; the human places orders.
7. **Honest status.** If an integration isn't live, the UI/docs say "fallback" or "SIMULATED". Never present simulated data as real.
8. **Business quantities are never written directly.** `ledger_events` is append-only; `src/lib/server/ledger.ts` exposes `appendEvents` and nothing else. Do **not** add an update/delete path, and do not fold AI output straight into a quantity — propose an event, then require owner confirmation.
9. **A capture line with a MISSING or CONFLICTING claim is refused, not completed.** `confirmCapture` must keep throwing in that case. Damage/loss is always signed negative — "2 damaged" can never increase stock.
10. **New user-visible numbers need evidence.** Anything quoted in a summary (including simulation figures) must be reachable from `evidence`/`calculation`/`action`/`simulation`, or grounding test G3 fails.

## Layout
```
src/lib/*              PURE logic (no DB/network): forecast-core, risk, guards, validation, analysis,
                       explain, grounding, csv, dates, demo-data, evals, types,
                       ledger (event reducer + claims), capture (message parser), simulate (Monte Carlo)
src/lib/server/*       DB/network: ingest, engine, forecast-service, memory, outcomes, demo, agent, llm,
                       research, workflows, briefing, observability, auth, rules, integrations, data,
                       ledger (append-only writes), capture (propose → confirm → append)
src/app/api/**         Route handlers (all wrapped in handle() → auth + error envelope)
src/app/**/page.tsx    Server components (read via src/lib/server/data.ts)
src/components/*       UI; client components only where interaction is needed
src/db/schema.ts       Drizzle schema (Postgres, JSONB for documents)
services/*             Optional external services (tabpfn, gemma docs, temporal worker) — excluded from tsc
tests/**               node:test via tsx
docs/**                Living documentation
```
Keep `src/lib/*.ts` free of imports from `src/lib/server` and `@/db` — tests and `/api/evaluation` depend on that purity.

## Commands
```bash
npm run dev
npx drizzle-kit generate                     # after editing src/db/schema.ts → SQL migration in drizzle/
npx drizzle-kit migrate                      # apply committed migrations (never from buildCommand)
npx tsx --test tests/**/*.test.ts            # safety/grounding/math/forecast/ledger/capture/simulator tests
npx next typegen && npm exec tsc -- --noEmit --pretty false
npm run build
```
Do **not** edit `package.json` by hand; use the package manager.

## Definition of done for any change
- [ ] Pure logic has/keeps tests (`tests/**`, `src/lib/evals.ts` for safety cases).
- [ ] New numeric claims in user-visible text are traceable to evidence (grounding test G3 still passes).
- [ ] New action paths go through validation + human approval.
- [ ] Any new inventory change goes through the ledger as an event, never a direct write.
- [ ] New user-visible claims carry a `status` and render with `ClaimStatusBadge`.
- [ ] `docs/FEATURES.md` and `docs/TASKS.md` updated; status labels honest.
- [ ] `tsc`, `npm run build` pass; `/api/health` OK.

## Workflow for adding a recommendation type
1. Add detection in `analyzeProduct`/`supplierOpportunities` (pure) producing a `RecDraft` with evidence, risks, alternatives, `validation`, `calculation`.
2. Add a safety case in `src/lib/evals.ts`.
3. Ensure `dedupeKey` is stable so re-analysis updates instead of duplicating.
4. Add UI label in `RecCard` (`TYPE_LABEL`) and agent handling in `agent.ts` if conversational.
5. Update docs.

## Style
TypeScript strict. Small pure functions. Comments explain *why*. No new dependency without a documented reason in `docs/decisions.md`.
