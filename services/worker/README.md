# Sahaay Temporal worker (optional production orchestration)

Temporal owns **durability** (schedules, retries, timeouts, history). Sahaay owns the **business steps**.
Each Temporal workflow is one activity that calls `POST /api/workflows/{name}/run?trigger=temporal`.

```bash
cd services/worker && npm install
export TEMPORAL_ADDRESS=localhost:7233   # or Temporal Cloud address
export SAHAAY_URL=https://your-sahaay.onrender.com
export CRON_SECRET=...                    # same secret as the web service
npm run worker       # start worker
npm run schedules    # create Sunday / daily / monthly schedules (IST)
```

Without Temporal the app still runs schedules via `/api/cron/tick` (Render Cron Job) and its built-in persisted-step runner with retries.
This folder is excluded from the web app's TypeScript build (`tsconfig.json` → `exclude: ["services"]`).
