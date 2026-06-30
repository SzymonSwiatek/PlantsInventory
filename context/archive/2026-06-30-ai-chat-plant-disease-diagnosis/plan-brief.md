# AI Chat for Plant Disease Diagnosis — Plan Brief

> Full plan: `context/changes/ai-chat-plant-disease-diagnosis/plan.md`
> Research: `context/changes/ai-chat-plant-disease-diagnosis/research.md`

## What & Why

Add an **"Ask AI"** entry point that opens a photo-grounded, multi-turn AI chat for plant
disease diagnosis. The user picks or captures a plant photo (same affordance as add-plant),
then converses with the AI (Google Gemini) about what's wrong. It's a deliberately
pulled-forward v2 feature (PRD lists it as a Non-Goal — that section is not edited).

## Starting Point

The app already calls **Google Gemini `gemini-2.5-flash`** via raw `fetch` (no SDK) in a
single-shot, single-image-in/JSON-out shape (`src/lib/ai/suggest.ts`, `/api/plants/suggest`).
There is a reusable browser downscaler, a proven photo picker/capture block, standard API
guards, and a uniform `ai_unavailable` degrade. What's missing entirely: any custom React
hook, any streaming/SSE, and any multi-turn message model.

## Desired End State

A signed-in user opens "Ask AI" from the nav, lands on `/ask`, attaches a plant photo, asks
a question, and gets a Polish conversational diagnosis with follow-up text turns. The
transcript lives in the browser (cleared on refresh). With the AI key unset, the page loads
and shows a graceful "unavailable" state instead of erroring. Output is bounded by
`maxOutputTokens` and a per-conversation turn cap.

## Key Decisions Made

| Decision            | Choice                                | Why (1 sentence)                                                              | Source   |
| ------------------- | ------------------------------------- | ----------------------------------------------------------------------------- | -------- |
| AI provider         | Google Gemini (extend `lib/ai` seam)  | Codebase uses Gemini, not Anthropic; change.md note was wrong.                | Research |
| Response mode       | Single-shot (buffered)                | Reuses existing seam + degrade; streaming is net-new on both ends.            | Plan     |
| Persistence         | Ephemeral, client-held (no DB)        | Matches the stateless-AI posture; no migration/RLS/Storage surface.           | Plan     |
| Entry point         | Dedicated `/ask` page + island        | Matches the established page+island pattern; full-screen transcript.          | Plan     |
| Cost controls       | `maxOutputTokens` + turn cap          | Bounds multi-turn cost cheaply with no new infra; no rate-limit store needed. | Plan     |
| Prompt              | Polish, free-form conversational      | Matches existing suggest voice; chat wants prose, not a JSON schema.          | Plan     |
| Photo requirement   | Required first turn, optional after   | Grounds diagnosis in an image; keeps follow-ups cheap.                        | Plan     |
| Upload reuse        | Reuse `downscaleToBase64` in place     | Photo goes to AI as base64 — no signed-upload/Storage write needed.           | Plan     |

## Scope

**In scope:** new `src/lib/ai/diagnose.ts` seam; guarded `POST /api/diagnose`; multi-turn
`contents` with roles; `maxOutputTokens` + turn cap; fault/degrade unit tests; `ChatPanel`
island; `/ask` page (+ `PROTECTED_ROUTES`); NavBar "Ask AI" entry; `scroll-area` shadcn.

**Out of scope:** streaming/SSE; any DB/migration/RLS/Storage write; per-user rate limiting;
`usePhotoUpload` refactor; launch-from-plant entry; English output; PRD edits.

## Architecture / Approach

Backend-first. A new `diagnose.ts` mirrors `suggest.ts` (raw `fetch`, `x-goog-api-key`,
retry/backoff, `extractText`) but builds a multi-turn `contents` array (`user`/`model`
roles, first user turn carries an `inlineData` image) and sets `maxOutputTokens` — no JSON
schema. The `POST /api/diagnose` endpoint guards `requireSameOrigin` → `requireUser` →
missing-key, validates image (MIME/7MB) + turn cap, and returns `{ status: "ok", reply }`
or `{ status: "ai_unavailable" }` at HTTP 200. The **client holds the full transcript** and
resends it each turn (endpoint is stateless). The `ChatPanel` island uses the existing
AbortController + status-enum idiom, reuses the downscaler + picker block, renders the
transcript as escaped text in a `scroll-area`, and surfaces errors via sonner.

## Phases at a Glance

| Phase                                      | What it delivers                                              | Key risk                                                          |
| ------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1. Backend — seam + endpoint               | `diagnose.ts`, `/api/diagnose`, types, fault tests            | Getting multi-turn `contents`/roles + degrade contract right      |
| 2. Frontend — ChatPanel, /ask page, nav    | Chat island, `/ask` page, nav entry, `scroll-area` primitive  | First custom chat state from scratch; mobile nav icon easy to miss|

**Prerequisites:** `AI_API_KEY` configured locally (`.dev.vars`) for manual verification.
**Estimated effort:** ~2 sessions across 2 phases.

## Open Risks & Assumptions

- Free-form Polish output is harder to keep on-topic than a JSON schema — relies on prompt discipline.
- The whole transcript is untrusted text (prompt-injection via photo); safety rests on render-as-escaped-text only (no `set:html`).
- Resending the full transcript grows requests linearly with turns; the turn cap is the bound.
- Assumes `NavBar.astro` is the page's nav; confirm no page still depends on legacy `Topbar.astro`.

## Success Criteria (Summary)

- A signed-in user can diagnose a plant from a photo and continue a multi-turn Polish conversation at `/ask`.
- With the AI key unset, the page degrades gracefully (no crash); replies are length- and turn-bounded.
- `npm run test:run`, `npm run lint`, `npx astro sync`, and `npm run build` all pass; no `set:html` introduced.
