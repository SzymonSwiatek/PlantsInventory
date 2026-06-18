<!-- PLAN-REVIEW-REPORT -->

# Plan Review: First plant from a photo (S-01 north star)

- **Plan**: context/changes/first-plant-from-photo/plan.md
- **Mode**: Deep
- **Date**: 2026-06-09
- **Verdict**: REVISE → SOUND (after triage 2026-06-09: F1 fixed via Fix A, F2 fixed via Fix A, F3 fixed via option (i))
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | WARNING |
| Blind Spots           | WARNING |
| Plan Completeness     | PASS    |

## Grounding

6/6 modify-paths exist (`astro.config.mjs`, `.env.example`, `src/middleware.ts`, `src/lib/supabase.ts`, `src/types.ts`, `src/pages/dashboard.astro`); 6/6 symbols verified (`PROTECTED_ROUTES=["/dashboard"]`, `createClient` null-when-unconfigured, `AiSuggestion`/`PlantInsert` in `src/types.ts`, env-schema secret pattern, signin form-POST→redirect, dashboard `Astro.locals.user`); storage RLS first-segment = `auth.uid()` confirmed (`20260608174754_plant_photos_storage.sql:42`); `plants_name_check` 1–100 confirmed; **storage-js `createSignedUploadUrl` upsert semantics verified** (`node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts:365-385` — default rejects an existing key; `{ upsert: true }` required); Progress section well-formed (one `## Progress`, all five `### Phase N` match the body, `N.M` items map to each Success Criteria bullet, phase bodies use plain `-` bullets); brief↔plan consistent.

## Findings

### F1 — Retake "no per-retake orphan" contradicts the upload-url contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness (cross-phase contract break + promise gap)
- **Location**: Phase 4 §1 (`/api/plants/upload-url`) ⇄ Phase 5 §3 (`AddPlantForm`)
- **Detail**: Phase 4's `upload-url` ALWAYS does `plantId = crypto.randomUUID()` and `createSignedUploadUrl(path)` — no upsert option, no `plantId` input. Phase 5 says "Replace photo re-runs upload + suggest, upserting the same plantId (no per-retake orphan)." These can't both hold: (a) if retake re-calls `upload-url`, it mints a NEW plantId → new folder → the prior object is orphaned, contradicting the stated "no per-retake orphan" invariant; (b) if the form instead reuses the first plantId/path (as "upserting" implies) but the mint omits `{ upsert: true }`, the second PUT to an existing key FAILS — verified in storage-js (`StorageFileApi.ts:365-385`; the d.ts notes `upsert` has no effect on `uploadToSignedUrl`, only on `createSignedUploadUrl`). Whichever way the implementer resolves the ambiguity, one of the two breaks: a silent orphan-per-retake, or a failed retake PUT.
- **Fix A ⭐ Recommended**: Make `upload-url` retake-aware + upsert — accept an optional `plantId` (reuse on retake, mint only on first call) and call `createSignedUploadUrl(path, { upsert: true })`; the form sends its stored `plantId` on "Replace photo."
  - Strength: Delivers the claimed "no per-retake orphan" and the stable `<uid>/<plantId>/` folder; cheap (one optional param + one flag).
  - Tradeoff: `upload-url` now has two modes (first vs retake).
  - Confidence: HIGH — the upsert path is verified in the installed storage-js.
  - Blind spot: Form must pass the same plantId back; cover in success criterion 5.5.
- **Fix B**: Drop the "no per-retake orphan" promise — let each retake mint a fresh plantId+folder; remove the wording. Save uses the last id.
  - Strength: Zero endpoint change; consistent with the already-accepted "abandoned uploads orphan" caveat.
  - Tradeoff: Orphans accumulate per retake; plan text must change so the implementer isn't chasing a false invariant.
  - Confidence: HIGH.
  - Blind spot: Orphan growth is unbounded without the deferred cleanup.
- **Decision**: FIXED via Fix A — `upload-url` now accepts optional `plantId` + `createSignedUploadUrl(path, { upsert: true })`; form sends stored `plantId` on retake; criterion 5.5 updated.

### F2 — No upload-failure branch in the form state machine

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 5 §3 — `AddPlantForm`
- **Detail**: The state machine is `idle → (uploading ∥ suggesting) → editing → saving`. The AI-failure path is covered exhaustively, but there is no branch for the full-res PUT to Storage failing (network, RLS reject, size). If the PUT fails while suggest succeeds, the form advances to editing/saving and POSTs `/api/plants` with a `photoPath` whose object doesn't exist — the create endpoint stores it, and the list render's `signedPhotoUrl` then 404s on a "successfully saved" plant.
- **Fix A ⭐ Recommended**: Block save until the PUT confirms — add an `upload_failed` state; on PUT error show a retry Alert and gate Save until a full-res object is confirmed.
  - Strength: No plant is ever saved with a dangling `photo_path`.
  - Tradeoff: A transient Storage hiccup blocks save until retry.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Fix B**: Allow save with `photo_path = null` on upload failure — clear `photoPath` and let manual save proceed photo-less (schema allows null).
  - Strength: User never loses their typed data to a Storage outage.
  - Tradeoff: "First plant from a photo" can land photo-less; the Phase 2 list card needs a no-photo placeholder.
  - Confidence: MED — needs a no-photo card state not in Phase 2.
  - Blind spot: Phase 2 card render currently assumes a photo path.
- **Decision**: FIXED via Fix A — added an `upload_failed` state to the Phase 5 §3 state machine (retry Alert, Save gated until a full-res object is confirmed); new criterion 5.10 covers it.

### F3 — ai_suggestion snapshot is client-supplied (metric integrity)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 5 §1 (`/api/plants` create) ⇄ §3 (`AddPlantForm`)
- **Detail**: This slice exists to drive Success Criteria #1 (≥75% suggestions accepted) and #2 (≥75% via AI), both of which read `plants.ai_suggestion`. But the snapshot round-trips through the browser: `/suggest` returns it, the form holds it, and `/api/plants` trusts whatever `aiSuggestion` the client posts back. A buggy form that sends the _edited_ field values as the snapshot (instead of the original) makes the saved-vs-snapshot acceptance diff always zero — silently inflating the headline metric. Not a security issue (the user's own data); a fidelity risk for the one number this slice is meant to produce.
- **Fix**: Decide consciously — either accept the client-supplied snapshot for the MVP and note it, or stash the normalized suggestion server-side at `/suggest` time (keyed by the pre-minted plantId) so create reads the original rather than trusting the round-trip. Cheapest middle ground: keep the round-trip but add a test/assertion that the posted snapshot is byte-identical to `/suggest`'s response.
- **Decision**: FIXED via option (i) — accept the client-supplied snapshot for the MVP; added an explicit "MVP fidelity caveat (conscious decision)" to the plan's Critical Implementation Details `ai_suggestion` bullet, naming the server-side stash as the hardening follow-up.

## Notes

The plan is strong overall: risk-first phasing, the 10 ms-CPU "no bytes in the Worker" spine, layered RLS + FK-guard reasoning, and the "observe each seam alone before stitching" sequence are all sound. End-State Alignment and Lean Execution pass cleanly; no last-mile gap (the Phase 2 list-render code already exists, Phase 5 populates it). The substantive hole is F1 — a cross-phase contract break the installed storage-js confirms would fail under the literal reading. F2/F3 are missing-branch and fidelity gaps worth a decision before coding.
