<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Domain Schema with RLS (F-02)

- **Plan**: context/changes/domain-schema-with-rls/plan.md
- **Mode**: Deep
- **Date**: 2026-06-05
- **Verdict**: REVISE → SOUND (after triage; all 6 findings fixed in plan)
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension             | Verdict              |
| --------------------- | -------------------- |
| End-State Alignment   | PASS                 |
| Lean Execution        | PASS                 |
| Architectural Fitness | WARNING (F1)         |
| Blind Spots           | WARNING (F5, F6)     |
| Plan Completeness     | WARNING (F2, F3, F4) |

## Grounding

5/6 paths ✓ (`src/types.ts` absent — plan said "empty"; corrected via F4), symbols ✓ (`createServerClient` in `src/lib/supabase.ts:9`; `.gitignore`-derived eslint ignores via `includeIgnoreFile` in `eslint.config.js:2,72`), foundation cites ✓ (10ms CPU `infrastructure.md`, RLS-silent risk `roadmap.md:91`, isolation/retention NFRs `prd.md:156,158`, FR-015 `prd.md:132`), brief↔plan ✓. Progress↔Phase ✓ (1 Progress block, 3 phases mapped, 17 criteria → 17 items). Verification done inline (greenfield schema; trivial blast radius — only existing file touched is `src/lib/supabase.ts`; nothing references the new tables yet).

## Findings

### F1 — Same-user FK guard missing on care_events.plant_id

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — Critical Implementation Details / care_events table
- **Detail**: The plan invents a `BEFORE INSERT OR UPDATE` same-user guard for `plants.location_id` but does not apply it to `care_events.plant_id`, which has the identical exposure (FK checks existence only; insert `with check` passes because `user_id` defaults to `auth.uid()`). A user could create a care_event they own that references another user's plant. Same class of bug the plan names, fixed in one place and missed in the other.
- **Fix**: Add a parallel `BEFORE INSERT OR UPDATE` trigger on `care_events` asserting `(select user_id from plants where id = new.plant_id) = new.user_id`, mirroring the plants/location guard.
  - Strength: Closes the identical hole on the only other owning FK; same pattern, one parallel trigger.
  - Tradeoff: A second trigger + one row lookup per care_event write (cheap — append-mostly).
  - Confidence: HIGH — same mechanism the plan specifies for plants; with RLS on plants the subquery returns NULL for another user's plant, so the guard fires deny-by-default.
  - Blind spot: None significant.
- **Decision**: FIXED — Critical Implementation Details generalized to both owning FKs; Phase 1 contract adds the parallel care_events trigger; manual check 1.6 + Progress 1.6 updated.

### F2 — Load-bearing manual deny check is underspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Testing Strategy → Manual Testing Steps (steps 2–3)
- **Detail**: Automated success criteria only prove RLS is _enabled_ (`rowsecurity=true`) and ≥4 policies _exist_ — neither proves predicates are correct (a `using (true)` policy passes both). Isolation correctness rests entirely on the manual two-session deny check, but the procedure ("two SQL sessions with different `auth.uid()` JWT claims") gives no mechanism: raw `psql` has `auth.uid()` = NULL, and there is no domain UI yet to create rows. The brief flags this gate as "easy to skip"; the roadmap names "RLS gaps are silent" as THE foundation risk.
- **Fix**: Add the concrete local impersonation recipe to Manual Testing Steps — create two `auth.users`, then per `psql` session `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';` before each op, with expected zero-row results documented. Note that the Storage deny check needs an authenticated client/session, not raw SQL.
  - Strength: Turns the skip-prone, load-bearing gate into a copy-paste runbook; satisfies the roadmap's mandatory deny-by-default check.
  - Tradeoff: A few lines of plan text; relies on local Supabase up (already a prerequisite).
  - Confidence: HIGH — documented Supabase RLS-testing pattern.
  - Blind spot: Storage deny check (2.4) needs its own client-based recipe.
- **Decision**: FIXED — Manual Testing Steps rewritten with a two-user impersonation harness, transaction-scoped GUCs for seeding, cross-user deny + both same-user-guard checks, CASCADE, and a separate authenticated-session note for the Storage check.

### F3 — Generated-types ignore route silently breaks CI build

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §1–2 / Critical Implementation Details (last bullet)
- **Detail**: The plan says "add it to the ESLint ignore list (and Prettier ignore)." This repo has no ESLint ignore list — `eslint.config.js:72` derives ignores from `.gitignore` via `includeIgnoreFile` (line 2), and `.gitignore` already has a `# generated types` section (→ `.astro/`), so the natural move is to add the new file there. That breaks the build: Phase 3 §2 makes `src/lib/supabase.ts` import `Database` from `@/db/database.types`, and `ci.yml` runs `npm run build` _without_ generating types — so the file must be committed. `.gitignore`-ing it drops it from the commit → CI build fails. No `.prettierignore` exists yet.
- **Fix**: State explicitly: (a) commit `src/db/database.types.ts`; (b) exclude from lint via a new flat-config `{ ignores: ["src/db/database.types.ts"] }` object in `eslint.config.js` — NOT via `.gitignore`; (c) create `.prettierignore` with the path.
  - Strength: Blocks the natural-but-wrong `.gitignore` route that fails CI build with a non-obvious "cannot find module" error.
  - Tradeoff: None — pure clarification.
  - Confidence: HIGH — `eslint.config.js:2,72` + `.gitignore` "generated types" section + `ci.yml` build-without-gen-types all confirmed.
  - Blind spot: None significant.
- **Decision**: FIXED — Critical Implementation Details bullet and Phase 3 §1 contract both rewritten to mandate commit + flat-config `ignores` + new `.prettierignore`, with an explicit "do not `.gitignore` it" warning.

### F4 — Current State says src/types.ts is "empty"; it doesn't exist

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Current State Analysis / Phase 3 §3
- **Detail**: Grounding shows `src/types.ts` is absent, not empty. Phase 3 "expose DTOs from `src/types.ts`" reads as editing an existing file; the implementer must create it (CLAUDE.md places shared types there).
- **Fix**: Reword to "create `src/types.ts`" and correct the Current State note.
- **Decision**: FIXED — Current State note and Phase 3 §3 file marker both updated to "(new — does not exist yet)".

### F5 — Orphaned Storage objects on plant/location/user delete

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 CASCADE / Phase 2 bucket
- **Detail**: CASCADE removes plant rows but not the Storage objects at `photo_path` (no DB→Storage cascade). Deleted plants leave orphaned photos in the bucket. Reasonably deferrable to the slices that own upload/delete (S-01/S-03), but currently falls through the cracks.
- **Fix**: Add a one-line note under "What We're NOT Doing" pointing storage orphan-cleanup at S-03 (plant delete) / S-02 (location delete).
- **Decision**: FIXED — new "No Storage orphan cleanup" bullet added under "What We're NOT Doing" assigning it to S-03 / S-02.

### F6 — ai_suggestion called "immutable snapshot" but nothing enforces it

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — plants.ai_suggestion
- **Detail**: The plan describes `ai_suggestion` as an "immutable snapshot" backing the FR-015 "original suggestion" view, but the update policy permits writing any column including `ai_suggestion`. A slice that overwrites it silently breaks FR-015.
- **Fix A (chosen)**: Clarify that immutability is an app convention enforced by S-01, not the DB. Keeps the schema lean.
- **Fix B**: Add a trigger blocking `ai_suggestion` changes once set (DB-enforced; more DB logic).
- **Decision**: FIXED via Fix A — column comment reworded to "write-once by convention, enforced by the slices, not the DB; no slice should include `ai_suggestion` in a plant-edit update."
