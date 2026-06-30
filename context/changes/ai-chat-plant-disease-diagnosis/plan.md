# AI Chat for Plant Disease Diagnosis Implementation Plan

## Overview

Add an **"Ask AI"** entry point that opens a photo-grounded, multi-turn AI chat for
plant disease diagnosis. The user picks an existing photo or captures a new one (the
same affordance as the add-plant form), then converses with the AI (Google Gemini)
about what's wrong with the plant.

The v1 is deliberately lean and consistent with the codebase's **stateless-AI posture**:
single-shot (buffered) Gemini calls, an **ephemeral client-held transcript** (no DB),
a Polish free-form conversational prompt, and `maxOutputTokens` + a per-conversation
turn cap as cost ceilings. The photo is required on the first turn and sent straight
to the AI as downscaled base64 — exactly like `/api/plants/suggest` — so there is **no
signed-upload path and no Storage write** in this feature.

## Current State Analysis

The codebase has a strong, consistent foundation, but a conversational chat is a
**net-new shape** in three respects (from research): no custom React hooks exist, no
streaming/SSE exists (all AI is single-shot `generateContent`), and there is no
multi-turn message abstraction (every AI call is a single image → single JSON response).

What is **directly reusable**:
- `src/lib/image.ts` `downscaleToBase64(file, maxEdge=1024, quality=0.8)` — fully generic, drop-in.
- The photo picker/capture/preview JSX block in `AddPlantForm.tsx:267-322` (dual hidden file inputs, `URL.createObjectURL` preview revoked on cleanup).
- `src/lib/api.ts` guards — `requireSameOrigin`, `requireUser`, `json`, `UUID_RE`.
- The Gemini transport conventions in `src/lib/ai/suggest.ts` — endpoint shape, `x-goog-api-key` header, `RETRYABLE_STATUSES`/`MAX_ATTEMPTS`/linear backoff, `extractText` parsing, the `AbortController` + timeout + `finally` scaffold.
- The `AI_API_KEY` env seam + the uniform `ai_unavailable` (HTTP 200) degrade contract.
- The async-fetch UI idiom: string-literal-union status state machines + `Skeleton` + `aria-live="polite"` (`AddPlantForm.tsx`), optimistic UI + sonner (`today/TodayList.tsx:24-53`).
- The island-mount pattern (`.astro` does server fetch → JSON-serializable DTO props → `client:load` island).
- `src/components/NavBar.astro` — single `navItems` array (`:18-22`) drives desktop + mobile bottom bar (mobile needs an inline-SVG icon block `:181-225`).

What must be **built new**: a multi-turn Gemini `contents` history with `role: "user"|"model"`
turns, a from-scratch chat state hook/component, a Polish free-form disease-diagnosis
prompt (replacing the care JSON schema), `maxOutputTokens` + a turn cap, a `/ask` page,
a nav entry, and 1–2 missing shadcn primitives (`scroll-area`, optionally `avatar`).

### Key Discoveries:

- **Provider is Google Gemini `gemini-2.5-flash`, NOT Anthropic** (`src/lib/ai/suggest.ts:19-20`). The change.md line 24 "Anthropic provider wiring" is inaccurate — research corrected it. Extend the `src/lib/ai/` seam; do not introduce an SDK (there is none in `package.json`).
- **Degrade contract**: every AI failure path collapses to `{ status: "ai_unavailable" }` at HTTP **200** with server-only `console.error` (`suggest.ts:38-40,71-77`); covered by `suggest.fault.test.ts`. The new endpoint must mirror this.
- **CSRF (lessons.md)**: every new cookie-session mutation handler MUST call `requireSameOrigin` at the top, **before** `requireUser`. Astro's global `checkOrigin` is disabled, so per-route guarding is the only CSRF defense.
- **Untrusted text (CLAUDE.md Tripwires)**: model-returned text is untrusted (prompt-injection via photo). The **whole chat transcript** is untrusted — the user can echo injected content into later turns. Render only as escaped text; never `set:html`/`dangerouslySetInnerHTML`. React/Astro auto-escaping is the safety net.
- **Cost controls are absent today** (`suggest.ts` has no `maxOutputTokens`, no rate limit). Multi-turn materially raises cost, so v1 adds `maxOutputTokens` + a turn cap.
- **Existing image guards to reuse**: `ALLOWED_MIME_TYPES` (415), `MAX_IMAGE_BYTES = 7*1024*1024` decoded cap + base64-shape check (413/400), at `suggest.ts:21,26,57-62`.
- **shadcn present**: `textarea`, `button`, `card`, `skeleton`, `alert` are ready; **missing**: `scroll-area` (transcript), and optionally `avatar`. No modal needed (dedicated page, not a sheet).

## Desired End State

A signed-in user opens **"Ask AI"** from the nav, lands on `/ask`, picks or captures a
photo of a plant, types a question, and receives a Polish conversational diagnosis. They
can ask follow-up text questions in the same session; the full transcript is held in the
browser and resent each turn. Refreshing the page clears the conversation (ephemeral).
With `AI_API_KEY` unset, the page loads and shows a friendly "AI unavailable" state
rather than erroring. Output length is bounded by `maxOutputTokens`; the conversation is
capped at a fixed number of turns.

Verify: `/ask` is reachable from desktop + mobile nav; a photo+question yields a reply;
follow-up text turns work; unconfigured AI degrades gracefully; `npm run test:run`,
`npm run lint`, `npx astro sync`, and `npm run build` all pass.

## What We're NOT Doing

- **No streaming/SSE** — single-shot buffered `generateContent` only.
- **No persistence** — no migration, no `diagnosis_conversations`/`diagnosis_messages` tables, no RLS, no Storage write. Transcript is ephemeral client state.
- **No signed-upload path** — the photo is sent to the AI as base64; it is not uploaded to the `plant-photos` bucket.
- **No per-user rate limiting** — only `maxOutputTokens` + turn cap + the existing pre-call gating (MIME allowlist, 7MB cap).
- **No refactor of `runUpload`/`runPhotoUpload`** duplication; no shared `usePhotoUpload` hook extraction. Reuse `downscaleToBase64` + the picker pattern in place.
- **No launch-from-plant entry point** (no sheet/drawer from `PlantDetail`) — dedicated `/ask` page only.
- **No edit to the PRD Non-Goals section** (change.md line 17-19).
- **No English output** — Polish, matching the existing suggest prompt voice.

## Implementation Approach

Two phases, backend-first so the UI builds against a working contract.

**Phase 1** adds a provider seam `src/lib/ai/diagnose.ts` alongside `suggest.ts` (same
file, same conventions — raw `fetch`, `x-goog-api-key`, retry/backoff, `extractText`),
exposing a function that takes a validated multi-turn message list (+ first-turn image)
and returns a single assistant reply or signals unavailability. A guarded `POST` endpoint
validates origin → user → AI key, enforces the turn cap and image guards, builds the
Gemini `contents` array (roles + first-turn `inlineData`), calls the seam under a budget,
and returns the uniform `ai_unavailable`-or-`ok` shape. Fault/degrade unit tests mirror
`suggest.fault.test.ts`.

**Phase 2** adds the `ChatPanel` React island (from-scratch chat state using the
AbortController + status-enum idiom; reused `downscaleToBase64` + picker/capture block;
transcript in a `scroll-area`; auto-grow `Textarea` composer; sonner errors), a
`src/pages/ask.astro` page that mounts it `client:load`, the NavBar "Ask AI" entry
(array item + widened `active` union + mobile inline-SVG icon block), and the missing
shadcn primitive(s). Manual UI verification.

## Critical Implementation Details

- **Multi-turn under single-shot**: "single-shot" means each HTTP request is one buffered
  `generateContent` call — the conversation is still multi-turn. The **client holds the
  full transcript** and sends the complete `messages` array (with `role: "user"|"model"`)
  **plus the `image` on every request**; the endpoint is stateless between requests, so the
  image must travel each turn for the server to re-attach it to the reconstructed first user
  turn (`inlineData`). There is no server-side memory of the photo across requests — sending
  it only on the first turn would leave every follow-up ungrounded.
- **Turn cap enforcement** lives server-side (validate the inbound message count) AND
  client-side (disable the composer past the cap) — the server is the real ceiling.
- **`finally`-block teardown**: follow the `suggest.ts` `AbortController` + timeout +
  `clearTimeout` in `finally` scaffold so the request budget can't leak. The multi-turn
  budget is `AI_TIMEOUT_MS = 30_000` — more generous than suggest's 12s but still bounded.
  Cost ceilings for the feature: `MAX_TURNS = 10`, `MAX_OUTPUT_TOKENS = 2500`, `AI_TIMEOUT_MS = 30_000`.

## Phase 1: Backend — diagnosis AI seam + endpoint

### Overview

A new Gemini provider function for multi-turn diagnosis and a guarded API endpoint that
wraps it with the codebase's standard guards, image validation, cost ceilings, and the
uniform `ai_unavailable` degrade.

### Changes Required:

#### 1. Extract shared image-validation helpers

**File**: `src/lib/ai/image-guards.ts` (new); edit `src/pages/api/plants/suggest.ts`

**Intent**: The image guards both paid-AI endpoints depend on are currently module-private
in the suggest endpoint (`ALLOWED_MIME_TYPES` `:21`, `MAX_IMAGE_BYTES` `:26`, `isLikelyBase64`
`:91`, `decodedByteLength` `:96`, and the `readString` body helper `:82`). Rather than
duplicate a security ceiling across two endpoints, lift these into one shared module so both
`/api/plants/suggest` and `/api/diagnose` import the same limits.

**Contract**: Move the constants (`ALLOWED_MIME_TYPES`, `MAX_IMAGE_BYTES`) and the pure
helpers (`isLikelyBase64`, `decodedByteLength`, `readString`) into `src/lib/ai/image-guards.ts`
verbatim — no behavior change — and re-import them in `src/pages/api/plants/suggest.ts`.
These are pure validators (unlike the stateful `runUpload`/`runPhotoUpload` the plan
deliberately leaves duplicated), so sharing them is in-keeping. Confirm `suggest.fault.test.ts`
still passes unchanged after the move (the values are identical).

#### 2. Diagnosis provider seam

**File**: `src/lib/ai/diagnose.ts` (new)

**Intent**: Mirror `suggest.ts` conventions to call Gemini `generateContent` with a
multi-turn `contents` array for free-form Polish diagnosis. Reuse the same model,
header, retry/backoff, and `extractText` approach, but drop the JSON `responseSchema`
(chat wants prose) and set `maxOutputTokens`.

**Contract**: Export an async function taking `(apiKey, messages, image, signal)` where
`messages` is the ordered turn list (`{ role: "user" | "model"; content: string }[]`)
and `image` is the `{ base64, mimeType }` re-attached to the first user turn on **every**
call (the endpoint is stateless and holds no photo between requests). Returns the assistant reply text,
or throws/returns a sentinel the endpoint maps to `ai_unavailable` (match the suggest
error-handling shape). Build the Gemini `contents` array: each message → `{ role,
parts: [{ text }] }`, with the first user turn's `parts` prepended with an `inlineData`
block `{ inlineData: { mimeType, data: base64 } }`. Set `generationConfig.maxOutputTokens`
to `MAX_OUTPUT_TOKENS = 2500`. **Thinking-token budget**: `gemini-2.5-flash` is a reasoning
model with thinking enabled by default, and `maxOutputTokens` caps *total* output tokens
(thinking **+** visible reply). Keep thinking on (dynamic) but size the cap generously so
both fit — ~2500 leaves ample headroom over a short Polish prose reply; do **not** set a
tight prose-only cap, or the model can spend the whole budget thinking and return a
`finishReason: "MAX_TOKENS"` candidate with **no text part**. The reused `extractText`
returns `null` in that case, so the seam must surface it as a degrade (→ `ai_unavailable`),
not a silent success — and it is covered by a fault test (see §5). A new `buildDiagnosisPrompt(today)`
returns a Polish botanist system instruction for disease diagnosis with the date
interpolated (parallel to `suggest.ts:23-37`), used as a leading instruction.

#### 3. Diagnosis API endpoint

**File**: `src/pages/api/diagnose.ts` (new)

**Intent**: A `POST` handler that guards the request, validates the message list + image,
enforces the turn cap, calls the seam under a bounded budget, and returns the uniform
status shape — degrading to `ai_unavailable` on any failure or missing key.

**Contract**: Guard order **must** be `requireSameOrigin` → `requireUser` → missing-key
short-circuit `if (!AI_API_KEY) return ai_unavailable`. Request body
`{ messages: { role, content }[]; image?: { base64, mimeType } }`. Validations:
non-empty `messages`, `messages.length <= MAX_TURNS` (`MAX_TURNS = 10`; on exceed →
`{ status: "error", error: "turn_limit_exceeded" }` at **400**, reserving 413 for the
image-size guard), **`image` must be
present on every request** (it is re-attached to the first user turn server-side; the
endpoint is stateless); import `ALLOWED_MIME_TYPES` (→415), `MAX_IMAGE_BYTES` decoded cap +
`isLikelyBase64`/`decodedByteLength` base64-shape check (→413/400), and `readString` from the
new shared `src/lib/ai/image-guards.ts` (§1) for the image. Wrap the seam
call in `AbortController` + timeout (`AI_TIMEOUT_MS = 30_000` — more generous than
suggest's 12s to allow multi-turn + thinking, but finite) + `clearTimeout` in `finally`. Success →
`{ status: "ok", reply }`; any error/timeout → `console.error` (server-only) +
`{ status: "ai_unavailable" }` at HTTP 200. Import `AI_API_KEY` via `astro:env/server`.
Do **not** add `export const prerender = false` (redundant).

#### 4. Shared DTO/types

**File**: `src/types.ts`

**Intent**: Add the chat message and response DTOs so the endpoint and island share types.

**Contract**: Add `DiagnosisRole = "user" | "model"`, `DiagnosisMessage = { role:
DiagnosisRole; content: string }`, and a response union mirroring the suggest pattern
(`{ status: "ok"; reply: string } | { status: "ai_unavailable" }`). Placement next to
the existing `AiSuggestion` DTO (`:52-58`).

#### 5. Fault/degrade unit tests

**File**: `src/pages/api/diagnose.fault.test.ts` (new)

**Intent**: Lock the security + degrade contract, mirroring `suggest.fault.test.ts`.

**Contract**: Cover at minimum — missing `AI_API_KEY` → `ai_unavailable` (no fetch);
upstream Gemini error → `ai_unavailable` at 200; **empty-candidate / `MAX_TOKENS` response
(200 OK but no text part, e.g. thinking consumed the budget) → `ai_unavailable` at 200**;
disallowed MIME → 415; oversized image → 413; over-turn-cap → 400 `turn_limit_exceeded`. Assert
`requireSameOrigin` is enforced before `requireUser`.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npx astro sync && npm run lint`
- [ ] Unit tests pass: `npm run test:run`
- [ ] New fault tests cover missing-key, upstream-error, empty-candidate/MAX_TOKENS, bad-MIME, oversize, over-turn-cap
- [ ] Production build succeeds: `npm run build`

#### Manual Verification:

- [ ] With `AI_API_KEY` set, `POST /api/diagnose` with a photo + question returns `{ status: "ok", reply }` in Polish
- [ ] A follow-up text-only turn (full transcript resent) returns a coherent reply
- [ ] With `AI_API_KEY` unset, the endpoint returns `{ status: "ai_unavailable" }` at HTTP 200 (no crash)
- [ ] Replies are visibly length-bounded (`maxOutputTokens` in effect)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Frontend — ChatPanel island, /ask page, nav

### Overview

The interactive chat UI: a React island holding the ephemeral transcript and driving the
Phase 1 endpoint, a dedicated `/ask` page mounting it, and the nav entry to reach it.

### Changes Required:

#### 1. Missing shadcn primitive(s)

**File**: `src/components/ui/scroll-area.tsx` (new, via CLI); optionally `avatar.tsx`

**Intent**: Add the transcript scroll container (and optional message avatars) in the
project's "new-york" style.

**Contract**: `npx shadcn@latest add scroll-area` (and `avatar` if used). No manual
authoring — accept the generated component.

#### 2. ChatPanel island

**File**: `src/components/chat/ChatPanel.tsx` (new)

**Intent**: The whole chat experience — photo pick/capture (first turn), transcript
render, composer, send loop against `/api/diagnose`, and ephemeral state. Follows the
existing async-fetch idiom; no custom hook directory required (inline `useState`/`useRef`).

**Contract**: Local state holds `messages: DiagnosisMessage[]`, the first-turn image
`{ base64, mimeType }` (from `downscaleToBase64`), and a string-literal-union send status
(`"idle" | "sending" | "error"`) à la `AddPlantForm`'s `AiStatus`. Reuse the picker/capture
block pattern from `AddPlantForm.tsx:267-322` (dual hidden inputs: `accept` allowlist +
`capture="environment"`; `URL.createObjectURL` preview revoked on cleanup). First send
requires an image (disable send otherwise); the picked image is retained in state for the
whole session and **resent with every request** (the stateless endpoint re-attaches it to
the first user turn — see Phase 1). On send:
append the user message, append a pending assistant placeholder (`Skeleton` "thinking",
`aria-live="polite"`), `POST /api/diagnose` with the full `messages` **and `image`**
under an `AbortController` + timeout; on `ok` replace the placeholder with `reply`;
on `ai_unavailable`/error roll back the placeholder and surface a **sonner** `toast`
(render `<Toaster richColors position="bottom-right" />` once here). Disable the composer
at `MAX_TURNS`. Render message text **as escaped text only** — never `set:html`. Transcript
in `scroll-area`, auto-scroll to newest; composer uses the auto-grow `Textarea` + a
`Button size="icon"` send. Use `cn()` for class merges.

#### 3. /ask page

**File**: `src/pages/ask.astro` (new)

**Intent**: Server-rendered page that mounts `ChatPanel` and reuses the shared layout/nav.

**Contract**: Follows the island-mount pattern — frontmatter reads `Astro.locals.user`
(route is protected via middleware), renders the shared layout + `<NavBar active="ask" />`,
and mounts `<ChatPanel client:load />`. Add `/ask` to the `PROTECTED_ROUTES` array in
`src/middleware.ts` so unauthenticated access redirects to `/auth/signin`.

#### 4. NavBar entry

**File**: `src/components/NavBar.astro`

**Intent**: Add "Ask AI" to the single-source nav so it appears in desktop top nav and the
mobile bottom bar.

**Contract**: (1) add `{ key: "ask", href: "/ask", label: "Ask AI" }` to `navItems`
(`:18-22`); (2) widen the `active` prop union to include `"ask"`; (3) **add an inline-SVG
icon block for the `ask` key in the mobile bottom bar** (`:181-225`) — otherwise the
mobile tile renders icon-less. Confirm whether any pages still use legacy `Topbar.astro`;
if so, the `/ask` page should use `NavBar` (the current shared nav).

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npx astro sync && npm run lint`
- [ ] Unit tests pass: `npm run test:run`
- [ ] Production build succeeds: `npm run build`
- [ ] No `set:html`/`dangerouslySetInnerHTML` introduced (grep clean)

#### Manual Verification:

- [ ] "Ask AI" appears and works in both desktop top nav and mobile bottom bar (with icon)
- [ ] Unauthenticated visit to `/ask` redirects to `/auth/signin`
- [ ] Pick-existing and camera-capture both produce a preview and enable the first send
- [ ] First turn (photo + question) renders a Polish reply; the "thinking" Skeleton shows while pending
- [ ] Follow-up text turns work; transcript scrolls to newest
- [ ] Composer is disabled at the turn cap
- [ ] With AI unavailable, the user sees a sonner error toast and the pending message rolls back (no crash)
- [ ] Page refresh clears the conversation (ephemeral confirmed)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- Endpoint guards: `requireSameOrigin` before `requireUser`; missing key → `ai_unavailable` with no fetch.
- Degrade: upstream Gemini error/timeout → `ai_unavailable` at HTTP 200; empty-candidate / `MAX_TOKENS` (200 OK, no text part) → `ai_unavailable` at HTTP 200.
- Image validation: disallowed MIME → 415; oversize decoded bytes → 413; malformed base64 → 400.
- Turn cap: `messages.length > MAX_TURNS` → 400 `turn_limit_exceeded`; missing image → rejected.
- Prompt builder: `buildDiagnosisPrompt(today)` interpolates the date and is in Polish.

### Integration Tests:

- Covered by the fault tests at the endpoint boundary (mocked `fetch`), mirroring `suggest.fault.test.ts`. No live-API test.

### Manual Testing Steps:

1. Open `/ask` (signed in); confirm nav highlight on desktop + mobile.
2. Capture a photo via camera; type a question; confirm a Polish reply.
3. Ask 2–3 follow-up text questions; confirm coherence and that the transcript scrolls.
4. Keep sending until the turn cap; confirm the composer disables.
5. Unset `AI_API_KEY` locally (`.dev.vars`); confirm graceful "AI unavailable" toast, no crash.
6. Refresh; confirm the conversation is gone (ephemeral).
7. Visit `/ask` signed out; confirm redirect to `/auth/signin`.

## Performance Considerations

- `maxOutputTokens` bounds per-reply cost/latency; the turn cap bounds conversation cost.
- Images are downscaled client-side (`maxEdge=1024`) before base64 — keeps payloads small and within the 7MB decoded cap.
- The single-shot buffered call avoids the streaming machinery entirely; the request budget must stay bounded (more generous than suggest's 12s, but finite).
- The image is resent on **every** request (the stateless endpoint has no photo memory), so each follow-up carries the downscaled image (<1 MB) plus the growing transcript; the turn cap bounds the total.

## Migration Notes

None — no schema or data changes (ephemeral, no DB).

## References

- Research: `context/changes/ai-chat-plant-disease-diagnosis/research.md`
- Provider seam to mirror: `src/lib/ai/suggest.ts:19-176`
- Endpoint to mirror: `src/pages/api/plants/suggest.ts:16-86`
- Fault-test pattern: `src/pages/api/plants/suggest.fault.test.ts`
- Photo picker/capture block: `src/components/plants/AddPlantForm.tsx:267-322`
- Downscaler: `src/lib/image.ts:26-49`
- API guards: `src/lib/api.ts:10-64`
- Optimistic UI + sonner: `src/components/today/TodayList.tsx:24-53`
- Nav: `src/components/NavBar.astro:18-22,181-225`
- CSRF rule: `context/foundation/lessons.md`
- Untrusted-text rule: `CLAUDE.md` "Tripwires"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — diagnosis AI seam + endpoint

#### Automated

- [x] 1.1 Type checking passes: `npx astro sync && npm run lint` — dec09e6
- [x] 1.2 Unit tests pass: `npm run test:run` — dec09e6
- [x] 1.3 New fault tests cover missing-key, upstream-error, empty-candidate/MAX_TOKENS, bad-MIME, oversize, over-turn-cap — dec09e6
- [x] 1.4 Production build succeeds: `npm run build` — dec09e6

#### Manual

- [x] 1.5 `POST /api/diagnose` with photo + question returns `{ status: "ok", reply }` in Polish — dec09e6
- [x] 1.6 Follow-up text-only turn (full transcript resent) returns a coherent reply — dec09e6
- [x] 1.7 With `AI_API_KEY` unset, endpoint returns `ai_unavailable` at HTTP 200 (no crash) — dec09e6
- [x] 1.8 Replies are visibly length-bounded (`maxOutputTokens` in effect) — dec09e6

### Phase 2: Frontend — ChatPanel island, /ask page, nav

#### Automated

- [x] 2.1 Type checking passes: `npx astro sync && npm run lint`
- [x] 2.2 Unit tests pass: `npm run test:run`
- [x] 2.3 Production build succeeds: `npm run build`
- [x] 2.4 No `set:html`/`dangerouslySetInnerHTML` introduced (grep clean)

#### Manual

- [ ] 2.5 "Ask AI" works in desktop top nav and mobile bottom bar (with icon)
- [ ] 2.6 Unauthenticated visit to `/ask` redirects to `/auth/signin`
- [ ] 2.7 Pick-existing and camera-capture both produce a preview and enable first send
- [ ] 2.8 First turn (photo + question) renders a Polish reply; "thinking" Skeleton shows while pending
- [ ] 2.9 Follow-up text turns work; transcript scrolls to newest
- [ ] 2.10 Composer is disabled at the turn cap
- [ ] 2.11 AI-unavailable shows a sonner error toast and rolls back the pending message (no crash)
- [ ] 2.12 Page refresh clears the conversation (ephemeral confirmed)
