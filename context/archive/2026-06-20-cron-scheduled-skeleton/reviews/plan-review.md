<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Cron scheduled() Worker Handler Skeleton (F-03)

- **Plan**: context/changes/cron-scheduled-skeleton/plan.md
- **Mode**: Deep
- **Date**: 2026-06-20
- **Verdict**: REVISE
- **Findings**: 1 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL |

## Grounding

6/6 paths ✓ (wrangler.jsonc, adapter `dist/entrypoints/server.js`, generated `dist/server/wrangler.json`, `src/lib/storage.test.ts`, `vitest.config.ts`, `vitest.setup.ts`; new files `src/worker.ts` + `src/lib/reminders/` correctly absent), 4/4 symbols ✓ (`entrypointResolution:"auto"` at adapter `dist/index.js:299`; `{ fetch: handle }` default export; no `scheduled|triggers|cron|workerEntryPoint` in adapter dist; `@astrojs/cloudflare/entrypoints/server` subpath is exported and importable — runtime ESM import only fails on the `cloudflare:` scheme, confirming the Vitest test-boundary rationale), brief↔plan ✓. Adapter 13.7.0. No `lessons.md` / `contract-surfaces.md` (skipped).

## Findings

### F1 — Phase-body Success Criteria use checkboxes (Progress contract violation)

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §Success Criteria (lines 131–139), Phase 2 §Success Criteria (lines 165–170)
- **Detail**: The mechanical Progress contract requires Phase blocks to contain plain `- ` bullets only — `- [ ]` / `- [x]` checkboxes may appear ONLY in the `## Progress` section. This plan puts `- [ ]` checkboxes in the phase-body Success Criteria (e.g. line 131 "- [ ] Build succeeds: `npm run build`"). Because those bullets sit BEFORE the Progress section in document order, the parser rule "next pending step = first `- [ ]` in document order" can resolve to a phase-body bullet (no N.M index, no SHA tracking) instead of Progress step 1.1 — so `/10x-implement` may mis-parse state. The just-completed `plant-management/plan.md` confirms the correct style: phase-body Success Criteria use plain `- ` bullets; checkboxes appear only from the Progress section onward.
- **Fix**: Convert the `- [ ]` bullets under each `#### Automated Verification:` / `#### Manual Verification:` in the phase bodies to plain `- ` bullets. Leave the `## Progress` section's `- [ ] N.M …` rows untouched (already correct).
- **Decision**: FIXED — converted all `- [ ]` bullets in Phase 1 and Phase 2 phase-body Success Criteria to plain `- ` bullets.

### F2 — Config-guard test doesn't guard the risk it's named for

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 1 §5 (config-guard test) + Testing Strategy (line 184)
- **Detail**: The slice's stated purpose is to stop "a future adapter upgrade [from] silently drop[ping] the cron." But the config-guard test reads the SOURCE `wrangler.jsonc` and asserts `main` + `triggers.crons`. An adapter upgrade wouldn't touch the source config — it would change how that source is processed into `dist/server/wrangler.json`. So the test actually guards against a human reverting the source, not adapter drift. The only check on the GENERATED config (criterion 1.2) is a manual/post-build step with no CI net — yet line 184 calls the source test "the regression net for the adapter-drop risk," overstating coverage.
- **Fix**: Add (or repoint) an automated check that asserts the GENERATED `dist/server/wrangler.json` has a non-empty `triggers.crons` after a build — e.g. a post-build test or a script step on the CI deploy gate. Keep the source guard (still valid against human revert) but stop labeling it as the adapter-drift net.
  - Strength: Closes the exact regression the slice exists to prevent; the source-only guard cannot.
  - Tradeoff: Needs a build to have run, so it can't live in the hermetic unit suite — separate post-build step.
  - Confidence: HIGH — verified `dist/server/wrangler.json` is the effective deploy config and currently shows `"triggers":{}`.
  - Blind spot: Whether CI already has a post-build hook to hang this on (deploy job not inspected).
- **Decision**: FIXED — added §6 (post-build generated-config assertion as CI deploy gate step), updated §5 intent to clarify it guards source revert not adapter drift, corrected Testing Strategy to accurately describe both guards.

### F3 — "Propagates automatically" rests on misread evidence; no fallback

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Current State Analysis (line 23) / Key Discoveries
- **Detail**: The plan cites `"triggers":{}` in the current generated config as proof that a root `triggers.crons` "propagates automatically." Verified: the current root `wrangler.jsonc` has NO `triggers` block at all, yet the generated config still shows `"triggers":{}` — that `{}` is wrangler's normalization default, not evidence of inheritance. Propagation is in fact likely (the generated file re-serializes the full normalized config — assets, kv_namespaces, etc. all preserved), but the plan's stated confidence isn't backed by the cited evidence, and there is no documented plan-B if `triggers.crons` does not survive the build.
- **Fix**: Reframe the evidence (the `{}` is a default; propagation is inferred from wrangler's full-config re-serialization) and add a one-line fallback note: if criterion 1.2 shows the generated config lacks the cron, fall back to [chosen mechanism] rather than leaving the implementer stuck mid-build.
  - Strength: Turns the slice's headline risk into a decision with a known exit instead of a silent dead-end.
  - Tradeoff: Minor planning effort for a low-probability failure.
  - Confidence: HIGH — confirmed the `{}` appears with no root triggers block.
  - Blind spot: The exact fallback mechanism (post-build patch vs. alternate entry) isn't yet chosen.
- **Decision**: FIXED — corrected Key Discoveries entry: `{}` is wrangler's normalization default, not proof of inheritance; propagation is inferred from full-config re-serialization; added fallback (patch `dist/server/wrangler.json` as post-build script if propagation fails).

### F4 — JSONC parsing approach for the guard test underspecified

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §5 (config-guard test contract)
- **Detail**: `wrangler.jsonc` contains both `//`-style comments and trailing commas (verified), so a plain `JSON.parse(readFileSync(...))` in the guard test will throw. The plan hand-waves "strip JSONC comments, or read via a tolerant parser" without naming one.
- **Fix**: Specify a tolerant parser. `wrangler` is already a dep and bundles a JSONC parser; alternatively parse with a small known lib. Avoid a naive regex strip (trailing-comma handling is where it breaks).
- **Decision**: FIXED — named `jsonc-parser` as the specific JSONC parser (install with `npm install -D jsonc-parser`); noted that naive regex strips break on trailing commas.
