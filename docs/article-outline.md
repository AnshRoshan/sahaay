# Hacktoberfest article outline — "Let AI reason, let code verify, let humans decide"

1. **Hook:** my friend's spreadsheet and the Sunday-night reorder anxiety.
2. **Why not a chatbot:** question→answer vs data→decision→outcome.
3. **The loop:** Predict → Explain → Approve → Act → Monitor → Learn.
4. **Architecture:** pure deterministic core + LLM that can only rephrase (grounding gate; show the G2 test where an invented ₹9,999 is rejected).
5. **Abstention as a feature:** the five safety tests; screenshot of "I don't have enough information".
6. **Forecasts with humility:** ranges + confidence; backtest vs naive baseline; honest 73–77 % coverage.
7. **Decision memory:** 18 → 12, the reason, the outcome, the learned preference.
8. **Open-source argument:** own and inspect the intelligence layer; swap models; local inference; data stays home.
9. **What I'd do differently / limitations:** synthetic demo data, inferred stockouts, MongoDB→Postgres substitution, adapters awaiting credentials.
10. **How to contribute:** good-first-issues (see TASKS.md "Next"), tests to add, integrations to build.
