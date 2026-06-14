---
change_id: ai-parse-unit
title: Bootstrap test runner + AI-parse normalizer unit suite
status: implemented
created: 2026-06-14
updated: 2026-06-14
archived_at: null
---

## Notes

Rollout Phase 1 of `context/foundation/test-plan.md` §3.

- **Goal:** Stand up the test runner; prove the suggestion normalizer never throws and emits a contract-valid care profile across provider shape variants.
- **Risk covered:** #5 — the suggestion normalizer throws, or emits a malformed / garbage care profile, when the provider returns missing, extra, or differently-typed fields (Medium impact × High likelihood).
- **Test type:** unit (the normalizer is pure — confirmed in the S-01 plan).
- **Oracle:** expected values come from the PRD care-profile contract (species, watering interval, sunlight, winterization cutoff, description) — NOT from re-reading the function's current output (avoid the snapshot tautology).
- **Stack (per §4):** Vitest (recommended, Vite-native; pin version at plan time).
- **Cookbook to update on landing:** §6.1 (adding a unit test).
