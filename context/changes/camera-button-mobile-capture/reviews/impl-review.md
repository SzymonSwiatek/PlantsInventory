<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Add Camera Capture Button for Mobile Photo Input

- **Plan**: context/changes/camera-button-mobile-capture/plan.md
- **Scope**: Phase 1 & 2 of 2 (full plan)
- **Date**: 2026-06-23
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success Criteria Evidence

- `npm run lint` — PASS (0 errors; 8 pre-existing `no-console` warnings in `src/lib/reminders/scheduled.ts` and `src/worker.ts`, unrelated to this change).
- `npm run test:run` — PASS (168 tests, 17 files).
- `npm run build` — PASS (clean Cloudflare SSR build).
- Manual items 1.4–1.6, 2.4–2.6 — user-attested per the plan's pause-for-confirmation gate. Camera behavior is inherently unverifiable from a diff (no camera device in headless Playwright, per plan note).

## Findings

### F1 — Camera label doesn't mirror the upload-progress icon/text swap

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/plants/PlantDetail.tsx:189-198
- **Detail**: The existing "Replace photo" label swaps to a Loader2 spinner + "Uploading…" text while `uploadStatus === "uploading"` (lines 174-179). The new "Take photo" camera label only dims via `cursor-not-allowed`/`opacity-60` — it keeps showing the Camera icon + "Take photo". During an in-flight upload the two sibling controls read slightly differently (one shows progress, one just dims). This MATCHES the plan's literal contract ("same cursor-not-allowed/opacity treatment while uploading") — the disabled gating and opacity are correctly mirrored; the icon/text swap was not part of the contract. Noted as cosmetic polish only, not a defect.
- **Fix**: Mirror the conditional — show Loader2 + "Uploading…" on the camera label too while `uploadStatus === "uploading"`.
- **Decision**: FIXED — mirrored Loader2 + "Uploading…" swap onto camera label
