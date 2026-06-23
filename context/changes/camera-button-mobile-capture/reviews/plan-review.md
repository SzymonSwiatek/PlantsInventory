<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Add Camera Capture Button for Mobile Photo Input

- **Plan**: context/changes/camera-button-mobile-capture/plan.md
- **Mode**: Deep
- **Date**: 2026-06-23
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

2/2 paths ✓ (AddPlantForm.tsx, PlantDetail.tsx), 3/3 symbols ✓ (`ALLOWED_TYPES`, `handlePhotoChange` reading `e.target.files?.[0]`, `accept={ALLOWED_TYPES}`), Progress↔Phase ✓ (one `## Progress`, both phases match by name, all criteria mapped, no stray checkboxes), brief↔plan ✓. Pipeline confirmed `File`-agnostic (`downscaleToBase64` client canvas + direct Storage PUT).

## Findings

### F1 — Nested-`<label>` trap in AddPlantForm not called out

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — AddPlantForm photo picker (Contract)
- **Detail**: In AddPlantForm the existing `id="photo"` input is nested INSIDE a large `<label htmlFor="photo">` that wraps the whole preview/empty state (lines 269–293). The plan says place the new affordance "within the existing Photo `<div className='space-y-2'>` block" — which is correct (sibling of the big label, the line 267 div). But it never warns that putting the new `<label htmlFor="photo-camera">` / input INSIDE the existing `<label>` would produce invalid nested labels and ambiguous click behavior (tapping the camera button could also fire the gallery input). A copy-paste implementer is likely to nest, since that mirrors the existing input's structure. PlantDetail's label (167–188) is small, so the trap is AddPlantForm-specific.
- **Fix**: In the Phase 1 contract, state explicitly that the new label+input must be a SIBLING of the existing `<label htmlFor="photo">`, placed after it but inside the same `<div className="space-y-2">` — never nested within it.
- **Decision**: FIXED (added a "Placement (do not nest)" note to the Phase 1 contract)

### F2 — Manual tests don't exercise a full-res camera capture

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Testing Strategy — Manual Testing Steps
- **Detail**: Camera captures are typically larger than the gallery images the pipeline is used to. `AddPlantForm.tsx:32` documents a ~10 MB stall-abort ceiling, and `downscaleToBase64` runs the file through `createImageBitmap`/canvas. Both apply equally to "Take photo" — so nothing new is broken — but a high-res capture exercises that timeout + canvas path harder than a typical gallery pick. The manual steps don't deliberately capture at full device resolution, so this path goes unverified for the new affordance.
- **Fix**: Add a manual step: capture at full device resolution and confirm the photo uploads (doesn't hit the stall-abort) and the AI downscale succeeds.
- **Decision**: ACCEPTED (will keep in mind during testing; no plan edit)
