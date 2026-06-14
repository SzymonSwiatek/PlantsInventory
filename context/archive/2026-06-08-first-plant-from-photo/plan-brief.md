# First plant from a photo (S-01 north star) — Plan Brief

> Full plan: `context/changes/first-plant-from-photo/plan.md`
> Research: `context/changes/first-plant-from-photo/research.md`

## What & Why

The product's north-star slice: a signed-in user creates a location, uploads a plant photo, gets an AI-suggested species + care profile within ~10 s, accepts/edits/replaces any field, and saves the plant into the location — visible immediately in that location's plant list, with a manual fallback when AI is unavailable. It's the smallest end-to-end proof of the core thesis (AI vision + cataloging) and directly drives Success Criteria #1 (≥75% AI suggestions accepted) and #2 (≥75% of plants created via the AI path).

## Starting Point

F-01 (magic-link auth) and F-02 (domain schema + RLS + private `plant-photos` bucket + DTOs) are landed and verified. The `plants` row is already shaped for this slice (every AI-fillable field plus a write-once `ai_suggestion jsonb`); only `name` + `location_id` are required on insert. What's missing is everything user-facing: no AI dependency or key, no JSON API endpoint, no `fetch`-based form, no domain list/CRUD UI, and only `Button` from shadcn. This slice establishes all of those conventions.

## Desired End State

From `/dashboard` a user creates a location, opens it, taps "Add plant," uploads a photo, and sees the form pre-fill with the AI's guess. They edit any field, can replace the photo to re-run the suggestion, or fill it manually when AI is down — then save and land back on the location page with the plant rendered. The original suggestion is snapshotted verbatim in `ai_suggestion` (null on manual), enabling both metrics with no schema change.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| AI provider | Gemini Flash (free tier) | $0 at this scale; browser sends a downscaled copy so the full-res 10 MB stays out of the Worker | Plan |
| Image delivery | Browser downscale → base64 to AI route; full-res → Storage directly | Gemini needs base64 inline; the 10 ms CPU limit forbids decoding 10 MB in-Worker | Plan |
| Upload ordering | Pre-mint `plantId` + signed upload URL; insert with explicit id on save | Keeps the `<uid>/<plant_id>/<file>` key convention; cleanly decouples upload from insert | Plan |
| Photo retake (FR-013) | In scope — replace photo + re-run AI | PRD must-have; a bad photo otherwise locks in a bad suggestion | Plan |
| AI failure UX | ~15 s client timeout → graceful manual fallback | One predictable path for timeout/error/missing-key; honors the AI-outage guardrail | Plan |
| Pages | Dedicated: `/dashboard`, `/locations/[id]`, `/locations/[id]/plants/new` | Clean SSR foundation S-02/S-03 extend directly | Plan |
| Field UI | Text/number inputs + "no winterization" toggle | Faithfully carries the AI's prose; matches the free-text schema; minimal new components | Plan |
| Testing | Static + manual (no test runner) | Matches repo state + speed goal; Module 3 `/10x-test-plan` owns the test rollout | Plan |
| Instrumentation | `ai_suggestion IS NOT NULL` proxy (no schema change) | The snapshot column was designed for exactly this; both metrics computable from existing columns | Plan |

## Scope

**In scope:** Create a location (FR-004); location plant-list page (FR-014); photo upload to Storage (FR-008); Gemini suggestion (FR-009); accept/edit/replace fields (FR-010); manual fallback (FR-011); location assigned by route (FR-012); replace photo + re-suggest (FR-013); `ai_suggestion` snapshot for metrics.

**Out of scope:** Reminders / today-list / cron (S-04/S-05; reminder columns left NULL); location rename/delete/counts (S-02); plant detail / edit-in-place / delete / note surface (S-03); orphaned-object cleanup; a test runner; a `created_via_ai` column; multi-photo, search, location-override picker.

## Architecture / Approach

Image handling is the spine: the **full-res photo goes browser → Storage directly** (raw `PUT` to a signed upload URL — never through the Worker), while a **browser-downscaled ≤1024px base64 copy** goes to the AI route, which relays it to Gemini. Four new endpoints, all self-guarding auth (`/api/*` is outside `PROTECTED_ROUTES`): `POST /api/locations` (native form), `POST /api/plants/upload-url` (mint signed upload), `POST /api/plants/suggest` (Gemini → normalized `AiSuggestion`), `POST /api/plants` (create with explicit id + snapshot). One `fetch`-based island (`AddPlantForm`) composes upload + suggest + edit + retake + save. RLS + the same-user FK-guard trigger enforce isolation; the create endpoint never sets `user_id`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Foundations & config | `AI_API_KEY` env, shadcn primitives, route guard, shared API/storage helpers | Forgetting `optional:true` makes a missing key throw instead of degrading |
| 2. Locations shell | `/dashboard` create+list, `/locations/[id]` plant list | RLS scoping / cross-user reachability on the new pages |
| 3. AI suggestion seam | `/api/plants/suggest` + normalizer + downscale util (observed alone) | Gemini model id / structured-output shape; `nodejs_compat` edge behavior |
| 4. Photo upload seam | `/api/plants/upload-url` + direct browser `PUT` (observed alone) | Exact `uploadToSignedUrl` PUT/token contract; path must start with `auth.uid()` |
| 5. Stitch | `/plants/new` page + `AddPlantForm` island + `/api/plants` create | Async state machine: parallel upload+suggest, timeout, retake, fallback |

**Prerequisites:** F-01 + F-02 landed (verified). A Gemini API key in `.dev.vars`/`.env` for the AI path (absence is a valid degraded path). Exercise on real `wrangler dev` (`workerd`), not just `astro dev`.
**Estimated effort:** ~3–4 focused sessions across 5 phases (seams 3 & 4 are small; Phase 5 is the bulk).

## Open Risks & Assumptions

- **Gemini free-tier data usage** — free-tier prompts/images may be used to improve Google's models (paid tier excluded). Acceptable for a personal MVP, but it's exactly PRD Open Q6 (AI provider disclosure) — a conscious "OK for now."
- **`uploadToSignedUrl` PUT mechanics** and the **Gemini structured-output schema / model id** must be verified against current `@supabase/supabase-js` and Gemini docs at implement time — both are flagged in the plan.
- **`nodejs_compat` is partial** — exercise the full upload + AI path on real `workerd` before deploy; keep any SDK lazy-imported.
- **Orphaned Storage objects** from abandoned uploads/retakes are accepted (DB CASCADE doesn't reach Storage); cleanup is a follow-up.
- **Local vs prod secrets are separate stores** — a missing prod `AI_API_KEY` degrades silently to manual-only.

## Success Criteria (Summary)

- A user goes photo → AI suggestion → edit → save, and the plant appears in the location list with its photo — end to end on `wrangler dev`.
- The flow works with `AI_API_KEY` unset (manual fallback, photo preserved) and the full-res photo never transits the Worker.
- `ai_suggestion` is snapshotted on the AI path and NULL on manual; a second user can reach none of the first user's data.
