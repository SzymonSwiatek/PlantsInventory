<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Plant Management (S-03)

- **Plan**: context/changes/plant-management/plan.md
- **Mode**: Deep
- **Date**: 2026-06-19
- **Verdict**: REVISE
- **Findings**: 1 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL |

## Grounding

12/12 paths ✓ (existing references all present; both new files absent as expected),
symbols ✓ (`json`/`requireUser`/`UUID_RE`/`CLIENT_ERROR_CODES` in `@/lib/api`;
`signedPhotoUrl`/`signedPhotoUrls`/`removePhotos` in `@/lib/storage`; `Plant`/`PlantUpdate`/`AiSuggestion`
in `@/types`; `readValue`/`readString`/`emptyToNull`/`asPositiveInt` in `plants/index.ts`),
`assert_plant_location_same_user` trigger raises `check_violation` = SQLSTATE 23514 ✓ (in CLIENT_ERROR_CODES),
`upload-url` accepts a supplied `plantId` for the retake/replace path ✓, brief↔plan ✓.

## Findings

### F1 — Phase-body Success Criteria use `- [ ]` checkboxes

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: All four phases — "Success Criteria" blocks (lines 82-90, 124-130, 172-182, 216-224)
- **Detail**: The mechanical Progress contract requires phase blocks to contain plain `- ` bullets only; `- [ ]` / `- [x]` belong solely to the `## Progress` section. This plan puts `- [ ]` checkboxes in every phase-body Success Criteria list (e.g. line 82 `- [ ] Type checking passes`). The shipped, working `location-management` plan proves the correct shape: its phase bodies use plain `- ` bullets (lines 71-73, 78-80) and checkboxes appear only under `## Progress`. The `## Progress` section here (lines 262-321) is itself correctly formed and numbered (1.1–4.6) and mirrors the criteria one-to-one — so this is purely the phase-body lists.
- **Fix**: Convert the `- [ ]` bullets in all four phases' "Automated Verification:" / "Manual Verification:" lists to plain `- ` bullets. Leave the `## Progress` section's `- [ ] N.M` checkboxes untouched.
- **Decision**: FIXED (Fix in plan)

### F2 — `name` validation semantics ambiguous for a partial PATCH

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — `src/pages/api/plants/[id].ts` Intent/Contract (lines 108, 110)
- **Detail**: The PATCH is described two ways that pull in opposite directions: "build a PlantUpdate from only the whitelisted keys present in the body" (name optional) vs. "validating each like the create endpoint (name 1-100 after trim)" — and the explicit pattern to mirror, `src/pages/api/locations/[id].ts:24-29`, reads `name` unconditionally and 400s when absent. An implementer copying that sibling makes `name` mandatory on every PATCH, which breaks the core flow: editing only `species` (or any single non-name field) would 400 because the body carries no `name`. The whole slice is single-field-at-a-time edits, so this is a likely default-path break, not an edge case.
- **Fix**: State explicitly that `name` (and every whitelisted key) is validated *only when present* in the body — present-but-invalid → 400; absent key → omitted from the update — deliberately diverging from the locations sibling's always-required `name`.
- **Decision**: FIXED (Fix in plan)

### F3 — Island state goes stale after a location move

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — PlantDetail island (lines 156-158)
- **Detail**: Delete redirects to `/locations/<location_id>` sourced from the `plant` prop (SSR snapshot). If the user changes the location via the `<select>` and then deletes in the same session without a reload, the redirect (and the Phase-1 breadcrumb, if not re-rendered) points at the former location. Harmless — both are the user's own pages — but mildly surprising.
- **Fix**: Track current `location_id` in island state, updating it when the location select saves, and use it for the delete redirect. Or accept it (a reload after a move corrects it). Low priority.
- **Decision**: FIXED (Fix in plan)
