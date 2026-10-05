# Security & privacy

| Principle | Implementation |
|---|---|
| Authentication | `SAHAAY_ACCESS_CODE` → HMAC-signed httpOnly cookie, constant-time compare, delayed failure. All pages + APIs gated except `/api/health`. A missing `SESSION_SECRET` is a hard error in production — the development fallback in `auth.ts` is published in this repository, so relying on it would let anyone forge a valid owner cookie. Unset access code = visible **OPEN MODE** badge. |
| Scheduled callers | `POST /api/cron/tick` authenticates with the `CRON_SECRET` bearer token and nothing else: it does **not** accept a session cookie, and it returns 503 when `CRON_SECRET` is unset rather than running open. GET is not exposed. |
| Destructive paths | `resetAll()` truncates every table, including the append-only ledger. Both it and the time-machine are behind `DEMO_MODE=1` (off in the blueprint) and require an explicit confirm once the database holds any records. |
| Roles / permissions | Single owner role. Permissions are encoded as capabilities: Sahaay reads + proposes + drafts; it cannot place orders or contact suppliers. Page: Rules & settings. |
| Minimise external transmission | Gemma/TabPFN are self-hostable. SerpApi receives only `"<product name> wholesale supplier India price MOQ"`. ElevenLabs receives only briefing text if enabled. |
| Clear external labelling | EXTERNAL tag in UI + `origin: "external"` in data; never merged into evidence. |
| Credentials | Environment variables only; `.env` git-ignored; `.env.example` provided. |
| Sensitive logging | Traces store inputs truncated (2 000 chars) and aggregate attrs; no raw CSV rows or secrets. Sentry events omit request bodies. |
| Input handling | Upload size cap 25 MB; CSV parsed defensively; all SQL via Drizzle parameterisation; user text never executed. |
| Unsafe actions | `validateOrder` blocks; warnings need explicit confirmation; guards abstain. |

## Known gaps / hardening TODO
- No rate limiting on login or `/api/ask` (add at proxy/CDN).
- Single shared access code; no per-user audit trail (add users table + SSO for teams).
- CSRF: cookie is `SameSite=Lax`; state-changing routes are POST/PUT JSON — add explicit CSRF token for multi-origin deployments.
- Row-level multi-tenancy absent (single business by design).
- Encrypt database at rest via the hosting provider.
