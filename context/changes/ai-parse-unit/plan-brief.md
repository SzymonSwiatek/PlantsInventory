# Bootstrap Test Runner + AI-Parse Normalizer Unit Suite — Plan Brief

> Full plan: `context/changes/ai-parse-unit/plan.md`
> Research: `context/changes/ai-parse-unit/research.md`

## What & Why

Stand up the project's first test runner (Vitest) and write a unit suite proving the AI
suggestion normalizer `normalizeSuggestion` (`src/lib/ai/suggest.ts:137`) **never throws**
and **always emits a contract-valid care profile** when the provider returns missing,
extra, null, or differently-typed fields. This is Rollout Phase 1 of the test plan and
covers Risk #5 (Medium impact × High likelihood) — the builder's stated worry that the
"massaging code" between Gemini and the form mangles or crashes on odd responses.

## Starting Point

No test runner exists — no `test` script, no Vitest/Jest, no config. The normalizer is
already written and is **pure**: its only import is a type-erased DTO, so it can be
imported and exercised in complete isolation with no `astro:env` mock and no workerd shim.

## Desired End State

`npm test` runs a green Vitest suite that pins, against a sources-derived oracle, the
five care-profile invariants (never-throws, exact 5-key shape, watering = positive
integer or null, winterization = `YYYY-MM-DD` or null, empty strings → null). The
cookbook (§6.1) documents the reusable unit pattern, and a known calendar-invalid-date
gap is documented and escalated rather than silently fixed.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Test layer | Unit, `environment: "node"` | The normalizer is pure; integration would add setup cost with no added signal. | Research |
| Runner | Vitest 3.x | Vite-native, matches the repo-wide `vite ^7.3.2` override. | Research |
| Watering assertion | Property invariant + pin coercions (`"7"`→7, `7.5`→8) | Catches the DB-breaking regression *and* documents round-to-nearest as the contract. | Plan |
| Date assertion | Deterministic cases + non-ISO fallback pinned on Node | User chose to cover the fallback branch too, accepting Node-scoped coupling. | Plan |
| Date determinism | Pin `TZ=UTC` via a setup file | `new Date()` parses non-ISO strings as local time, then shifts to UTC — flaky without a fixed TZ. | Plan |
| Calendar-invalid date | Characterization test + §6.6 escalation note | Documents the known gap with a regression anchor; fixing it is a Lesson-5 change. | Plan |
| Empty strings | Assert `""`/`"  "`→null at the normalizer layer | The normalizer is the unit under test; invariant #5 is part of its own contract. | Plan |

## Scope

**In scope:** Vitest bootstrap (config, scripts, `TZ=UTC` setup); the full
`normalizeSuggestion` contract suite; cookbook §6.1 + §6.6 + §4 + §3 updates.

**Out of scope:** fixing the calendar-invalid-date bug (Lesson 5); the provider seam /
`ai_unavailable` path (Risk #1, Phase 3); integration/e2e infra (Phases 2–3); CI gating
(Phase 4); installing Stryker; AI suggestion quality.

## Architecture / Approach

One new test file (`src/lib/ai/suggest.test.ts`) + `vitest.config.ts` (node env, `@`
alias) + `vitest.setup.ts` (TZ=UTC). Assertions are parameterised invariant tables
(`it.each`) for the cross-domain guarantees, plus targeted policy tests for the watering,
date, empty-string, and calendar-invalid cases. Oracle comes from the PRD care-profile
contract, the `AiSuggestion` type, and the DB CHECK constraints — never from the
function's current output.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Bootstrap runner | Vitest installed; config + TZ setup; smoke test import-resolves the module | Alias not resolving at Vitest runtime; accidental need for an env shim |
| 2. Contract suite | Full oracle-driven `normalizeSuggestion` suite | Mirror-testing the implementation instead of the oracle; flaky TZ-dependent date assertions |
| 3. Cookbook + sync | §6.1 pattern, §6.6 escalation, §4 version pin, §3 status flip | Cookbook too vague to reuse; gap framed as "fixed" not "documented" |

**Prerequisites:** none beyond the existing toolchain (Node, npm, the `vite ^7.3.2`
override already in place). No Docker / Supabase needed for this phase.
**Estimated effort:** ~1–2 sessions across 3 phases (LOW complexity).

## Open Risks & Assumptions

- The non-ISO date assertions are pinned to **Node + UTC**; the workerd production
  runtime may parse non-ISO strings differently. Mitigated by `TZ=UTC` + an explicit
  comment scoping those assertions to the test runtime.
- Pinning `7.5 → 8` couples one test to the current round-to-nearest policy; if a future
  change prefers reject-non-integer, that single test is updated deliberately.
- The calendar-invalid characterization test encodes known-buggy behavior; relies on a
  clear label so a future reader does not mistake it for the intended contract.

## Success Criteria (Summary)

- `npm test` is green and the suite has teeth (breaking a helper turns a test red).
- The normalizer is proven to never throw and to emit only DB-valid care profiles across
  every provider shape variant.
- The cookbook lets the next contributor add a unit test without re-reading this plan,
  and the calendar-invalid gap is visible and escalated.
