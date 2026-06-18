<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: First plant from a photo (S-01 north star)

- **Plan**: context/changes/first-plant-from-photo/plan.md
- **Scope**: All 5 phases (full plan)
- **Date**: 2026-06-10
- **Verdict**: APPROVED
- **Findings**: 0 critical · 2 warnings · 2 observations

Build (`npm run build`) and lint (`npm run lint`) both pass. All five phases'
manual criteria are checked off with commit shas. Security posture verified:
auth self-guards on every `/api/*`, photo-path defense-in-depth, direct-to-Storage
upload (bytes never touch the Worker), uniform AI degradation, no service-role
leak, RLS-scoped reads, object-URL cleanup. All 16 planned line-items landed as
intended (the `requestSuggestion(apiKey, …)` signature is an adaptation the plan
anticipated); the "What we're NOT doing" boundaries are fully respected.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — N+1 signed-URL minting on the location plant list

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (performance)
- **Location**: src/pages/locations/[id].astro:26-31
- **Detail**: The plant list mints one signed read URL per plant — `Promise.all(rows.map(p => signedPhotoUrl(supabase, p.photo_path)))` fires a separate `createSignedUrl` round-trip to Supabase Storage for every row. Promise.all makes them concurrent, but it is still O(n) external calls per SSR request. This is the list-page pattern S-02/S-03 will copy, so the cost compounds as locations grow.
- **Fix**: Batch with the plural `createSignedUrls(paths[], ttl)` (storage-js supports it) — collapse N round-trips to one. Add a `signedPhotoUrls(supabase, paths)` helper beside `signedPhotoUrl` in src/lib/storage.ts and map results back by path.
  - Strength: One round-trip regardless of plant count; sets the efficient pattern before S-02/S-03 inherit it.
  - Tradeoff: New helper + the call site re-maps url↔path; slightly more code than the current one-liner.
  - Confidence: MED — createSignedUrls exists in storage-js, but confirm the exact return shape (array of {path,signedUrl,error}) against the installed version before wiring.
  - Blind spot: Haven't checked whether mixed null photo_paths need filtering out of the batch input.
- **Decision**: FIXED — added `signedPhotoUrls()` batch helper (storage.ts); call site collects non-null paths, mints once, maps back by path.

### F2 — Direct-to-Storage PUT has no timeout; a stall traps the form

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/components/plants/AddPlantForm.tsx:115-119
- **Detail**: The raw full-res `PUT mint.signedUrl` has no AbortController, unlike the suggest call (15 s client timeout) and the mint. A silently stalled connection never rejects, so `uploadStatus` stays "uploading" forever — Save remains disabled and the retry Alert (which only shows on "failed") never appears. The user is stuck with no escape.
- **Fix**: Wrap the PUT in an AbortController with a generous timeout (~30-60 s for a 10 MB upload); on abort, fall into the existing `catch` → setUploadStatus("failed") so the retry UI surfaces.
- **Decision**: FIXED — added `UPLOAD_TIMEOUT_MS` (60 s) AbortController over the whole mint→PUT sequence; abort → catch → setUploadStatus("failed") surfaces the retry Alert. `clearTimeout` in `finally`.

### F3 — Stale AI snapshot persisted on a failed retake

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (data safety)
- **Location**: src/components/plants/AddPlantForm.tsx:132-160
- **Detail**: `runSuggest` only sets `snapshot` on success (via applySuggestion). If the user picks photo A (AI fills + snapshots), then retakes with photo B and B's suggest fails (`ai_unavailable`), the old snapshot from A survives and is posted as `aiSuggestion` for the plant whose stored photo is B. The write-once adoption/acceptance metric would then describe a different photo than the one saved. Low impact — the snapshot is an audit/metric field, not user-facing care data.
- **Fix**: `setSnapshot(null)` at the top of `runSuggest` (or in handlePhotoChange) so the snapshot always matches the saved photo; it is only repopulated if the new suggest succeeds.
- **Decision**: FIXED — `setSnapshot(null)` added at the top of `runSuggest` (after the `aiUnavailable` reset); snapshot is repopulated only on a successful suggest.

### F4 — Provider retry/backoff added beyond the plan

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/ai/suggest.ts:46-108
- **Detail**: The plan specified a single Gemini fetch; the implementation adds MAX_ATTEMPTS=3 with backoff for 429/5xx. It is well-built and abort-aware (the `sleep` rejects on the signal, so total time stays inside the endpoint's 12 s budget and still collapses to `ai_unavailable` on exhaustion) — the client contract is unchanged. Benign hardening, flagged only because it is undocumented scope.
- **Fix**: Leave as-is; optionally note the retry policy as a one-line plan addendum so future reviews don't re-flag it.
- **Decision**: SKIPPED — benign, abort-aware hardening; client contract unchanged. Left as-is, no addendum.

## Folded-in nits (not raised as findings)

- On a non-OK retry the response body isn't drained before retry/throw (src/lib/ai/suggest.ts:99-104) — minor connection-hold on the Workers runtime; consider `await res.body?.cancel()` on the non-OK path.
- `/api/plants` trusts that `photoPath` points at a real object (only the uid-prefix is checked, src/pages/api/plants/index.ts:56) — accepted: the list degrades to the 🌱 placeholder, and the plan already tolerates orphaned objects.
