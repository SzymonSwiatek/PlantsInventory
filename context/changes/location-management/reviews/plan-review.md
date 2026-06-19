<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Location Management (S-02)

- **Plan**: context/changes/location-management/plan.md
- **Mode**: Deep
- **Date**: 2026-06-18
- **Verdict**: REVISE → SOUND (all 3 findings fixed in plan.md during triage 2026-06-18)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

8/8 existing referenced paths ✓; new paths (src/components/locations/, src/pages/api/locations/) correctly absent ✓; symbols verified (UUID_RE & CLIENT_ERROR_CODES in plants/index.ts, plants(count) FK relationship, plants.photo_path, plants.location_id ON DELETE CASCADE, updated_at trigger) ✓; brief↔plan consistent ✓; Progress↔Phase mechanical contract holds (one `## Progress`, all phases and success-criteria bullets mapped) ✓.

## Findings

### F1 — CLIENT_ERROR_CODES / UUID_RE aren't in src/lib/api.ts; extract-vs-duplicate undecided

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Key Discoveries (line 23); Phase 2 §2 contract (line 109)
- **Detail**: The plan's Key Discoveries says to reuse "src/lib/api.ts (json(), requireUser(), CLIENT_ERROR_CODES for SQLSTATE → 400 vs 500 mapping)." That's inaccurate — api.ts exports only `json()` and `requireUser()`. `CLIENT_ERROR_CODES` is a local const in `plants/index.ts:25`, and `UUID_RE` is already duplicated between `plants/index.ts:20` and `upload-url.ts:23`. An implementer trusting the plan will look in api.ts, not find these, and must choose extract-vs-duplicate. The plan never makes that call, so the new endpoint becomes the third copy of UUID_RE by default.
- **Fix A ⭐ Recommended**: Extract UUID_RE + CLIENT_ERROR_CODES into src/lib/api.ts; all three consumers import them.
  - Strength: Three consumers now justify it; makes the plan's api.ts description accurate and kills the existing duplication.
  - Tradeoff: Touches two existing files beyond this slice's scope (small, mechanical).
  - Confidence: HIGH — pure constants, no behavior change.
  - Blind spot: None significant.
- **Fix B**: Duplicate both consts locally in [id].ts and correct line 23's claim.
  - Strength: Zero blast radius outside this slice; matches the existing UUID_RE duplication precedent.
  - Tradeoff: A third copy to keep in sync; the api.ts claim still needs correcting either way.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — extracted UUID_RE + CLIENT_ERROR_CODES into src/lib/api.ts; plan §1 added to Phase 2, consumers updated, line 23 corrected.

### F2 — Phase 3 row restructuring is underspecified (whole-row <a> wraps the row today)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §3 (lines 157–161)
- **Detail**: Today each row is a single `<a href="/locations/{id}">` that is the full-width flex container wrapping name + "→" (dashboard.astro:66–72). The plan says mount `<LocationActions>` "within each `<li>`" and "ensure the action controls don't nest inside the anchor (no button-in-a)." The constraint is right, but the plan stops there — it doesn't say how to recompose the row. To satisfy it the anchor must shrink (wrap only name/arrow) and the actions become a sibling in a flex `<li>`; the implementer also must decide what stays click-to-navigate vs. button surface. Left vague, this is the "refactor the row as needed" that spirals.
- **Fix**: Specify the new row structure in the contract — e.g. `<li class="flex items-center justify-between …">` with `<a href>` wrapping only the name (+ count badge) on the left and `<LocationActions>` as a right-aligned sibling; drop the standalone "→" since the name link carries navigation; note the inline-rename input replaces the name link while editing.
- **Decision**: FIXED — Phase 3 §3 contract now specifies the split-row structure (li carries flex/card styling; a wraps name + count badge; LocationActions sibling; rename input swaps in while editing).

### F3 — Phase 2 standalone verification leans on auth'd requests + a conditional test

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 Manual Verification (lines 120–125); Automated 2.3
- **Detail**: Phase 2 ships no UI, so its manual checks (PATCH/DELETE "verify via dashboard reload" / crafted cross-user request) need a valid cookie session — non-trivial to drive by curl with magic-link auth. The one automated lever, the unit test (2.3), is hedged as "if a test is added." That risks Phase 2 being "verified" only once Phase 3's UI exists, collapsing the phase boundary.
- **Fix**: Make the `removePhotos` + validation unit tests non-optional for Phase 2 (drop the "if added" hedge), mirroring `suggest.fault.test.ts`, so Phase 2 has a real standalone gate before the island lands.
- **Decision**: FIXED — Phase 2 Automated criteria + Testing Strategy now mark the removePhotos + validation unit tests as required (not optional), as Phase 2's standalone gate.
