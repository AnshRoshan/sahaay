# API reference

All routes except `/api/health` require the session cookie (when `SAHAAY_ACCESS_CODE` is set). Errors: `{ "error": string, ...details }`.

| Method & path | Purpose |
|---|---|
| `GET /api/health` | DB liveness |
| `POST /api/auth/login` `{code}` / `POST /api/auth/logout` | Session |
| `POST /api/import` | multipart `files[]` (auto-detects type) or JSON `{kind?, filename?, text, analyze?}` → reports, summary, analysis. An inventory upload also records a dated `stock_count` event. |
| `POST /api/capture` `{text, channel?}` | Parse a typed/spoken shop update → **proposed** events with per-field claim labels (CONFIRMED/INFERRED/MISSING/CONFLICTING) and unmatched text. Writes nothing. |
| `POST /api/capture` `{action:"confirm", id, accept:[i], corrections?}` | Write the accepted lines as immutable events. `422` if a line has no product/quantity; `409` if already confirmed. |
| `POST /api/capture` `{action:"reject", id}` | Discard a proposal |
| `GET /api/capture` | Recent captures with their parse results |
| `GET /api/ledger` | Read-only ledger: derived state per product with balance trail, conflicts, future-dated events, negative stock, recent events. No write endpoint exists by design. |
| `GET /api/samples/{sales,inventory,products,suppliers}.csv` | Demo CSVs |
| `POST /api/demo/load` `{confirm?}` | Reset + load demo shop + seed history + analyse. **403 unless `DEMO_MODE=1`**; 409 `needsConfirmation` with the row count when the database already holds records |
| `POST /api/demo/simulate` `{days}` | **Simulation**: advance clock, deliver orders, measure outcomes, re-analyse. **403 unless `DEMO_MODE=1`** |
| `POST /api/analysis/run` | Re-run forecast → risk → recommendations |
| `GET /api/recommendations?status=pending,approved` | List |
| `GET /api/recommendations/{id}` | Detail + decision + outcome + `simulation` (candidate-quantity comparison, when computed) |
| `POST /api/recommendations/{id}/decision` `{decision: approved\|modified\|rejected, quantity?, supplierId?, reason?, confirmWarnings?}` | Human decision. `422` blocked by rules (returns `validation`); `409` needs confirmation |
| `POST /api/recommendations/{id}/validate` `{quantity, supplierId?}` | Live safety check |
| `POST /api/recommendations/{id}/execute` | Mark order placed |
| `POST /api/recommendations/{id}/research` | External supplier research (stored on the rec) |
| `POST /api/recommendations/{id}/explain` | (Re-)explain via Gemma w/ grounding gate, else template |
| `POST /api/ask` `{message, context?}` | Agent answer + cards + internal/external blocks + trace |
| `POST /api/outcomes/measure` | Measure due outcomes, relearn preferences |
| `GET/PUT /api/settings` | Business rules + integration status |
| `GET /api/workflows` · `POST /api/workflows/{name}/run[?trigger=temporal]` | Schedules, runs, manual/Temporal trigger |
| `POST /api/cron/tick` | Run due workflows (`Authorization: Bearer $CRON_SECRET`). POST only, and **503 when `CRON_SECRET` is unset** — it no longer falls back to "is this a logged-in browser?", which left it open on any instance without an access code |
| `GET /api/briefing` · `POST /api/voice/briefing` | Briefing text · audio (ElevenLabs) or 501 → browser fallback |
| `GET /api/evaluation` | Safety/grounding/math cases + forecast backtest |

Workflow names: `weekly_analysis`, `morning_briefing`, `monthly_slow_moving`, `outcome_check`.
