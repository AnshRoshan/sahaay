# Evaluation

All evaluation is executable: `npx tsx --test tests/**/*.test.ts`, live at **Architecture & traces** (safety) and **Forecasts** (backtest), and `GET /api/evaluation`.

## 1. Forecast evaluation
**Method:** rolling-origin backtest (origins 28/21/14/7 days before the as-of date), 7-day horizon, only products with ≥ 7 weeks history. Metrics: **MAE**, **RMSE**, interval coverage. **Baseline:** naive "next week = last week".
**Observed on the seeded demo shop:** MAE ≈ 2.6–2.8 vs baseline ≈ 3.1 (≈ 12–16 % better); RMSE ≈ 3.3–3.6 vs ≈ 3.9–4.0; coverage of the nominal-80 % interval ≈ 73–77 % (slightly under-dispersed — a known limitation; consider widening or TabPFN quantiles). Numbers vary with the demo's dates; the page shows current values.
**Test:** `tests/forecasting/forecast.test.ts` fails if the model is materially worse than the baseline.
**Caveat:** The harness evaluates the local engine. To compare TabPFN, run the same origins through `services/tabpfn` (task in TASKS.md).

## 2. Recommendation evaluation
| Question | Test |
|---|---|
| Mathematically valid? | M1: qty = max(raw, MOQ) and raw = ceil(demand + buffer − stock) |
| Respects constraints? | M3 + S3, S7, S8, S9 (max qty, cash, MOQ, allowed supplier) |
| Evidence available? | Every `RecDraft` carries evidence; G3 traces summary numbers to it |
| Contradicts business rules? | Validation runs before anything is shown; blocked items are labelled |
| Edge: MOQ floor | M2 |

## 3. Grounding evaluation
- G1: grounded model text accepted.
- G2: text with an invented number (₹9,999) rejected.
- G3: every numeric claim in a generated summary exists in evidence/calculation/action JSON. (This test caught a real gap — the stockout % was not in evidence — which was fixed.)
At runtime every Gemma answer is gated by `checkGrounding`; rejections are recorded in the trace note.

## 4. Abstention evaluation
- S1 missing lead time → ABSTAIN · S2 negative stock → DATA_ERROR · S4 conflict → FLAG_CONFLICT · S5 thin history → LOW_CONFIDENCE · S11 abstained recs contain **no quantity**.
- Demo data contains each case (Rain Jacket L, Sweatshirt L, Linen Kurta M, Silk Scarf Free, products without suppliers).

## 5. Safety test matrix (spec §44)
| Spec test | ID | Expected |
|---|---|---|
| Missing supplier lead time | S1 | ABSTAIN |
| Negative inventory | S2 | DATA ERROR |
| Quantity above configured limit | S3 | BLOCK |
| Supplier conflict | S4 | FLAG CONFLICT |
| Insufficient sales history | S5 | LOW CONFIDENCE |
| Extra: implausible vs demand | S6 | WARN (confirm) |
| Extra: cash limit / MOQ / allowed supplier / healthy order | S7–S10 | BLOCK / BLOCK / BLOCK / PASS |

## 6. Outcome evaluation (in product)
Each decision is measured after 7 days: actual vs forecast, error %, verdict (close ±20 %, over/under-estimated), and whether the owner's modification was closer to what was needed. Rejections get a counterfactual (did stock cover demand?). Aggregates feed `forecast_bias` and the north-star metrics.

## 7. Known limitations
- Backtest on synthetic demo data proves mechanics, not real-world accuracy — re-run on the friend's data.
- Stockout history is *inferred* from zero-sales runs (no true stockout log).
- Normal approximation for lead-time demand is crude for very slow movers.
- Seeded history stock levels are assumptions (labelled in evidence).
