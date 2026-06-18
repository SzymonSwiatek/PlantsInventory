# AI-Outage Resilience — Plan Brief

> Full plan: `context/changes/ai-outage-resilience/plan.md`
> Research: `context/changes/ai-outage-resilience/research.md`

## What & Why

Test-plan Phase 3 (Risk #1): when the AI provider hangs, errors, or times out, the
add-plant flow must degrade to manual entry with the uploaded photo preserved — no
infinite spinner, no photo-losing 5xx. Research found this is **already a deliberate
design**, so this change writes tests that **characterize and lock it in**. **No
production code changes.**

## Starting Point

The suggest endpoint already collapses every AI failure to `200 ai_unavailable` (no 5xx),
photo upload and AI suggest run as independent state machines (so the photo can't be lost
on an AI failure), and the Phase 2 integration harness is reusable. But the
provider-throw → degrade conversion and `requestSuggestion`'s throws are **untested**
(existing tests cover only `normalizeSuggestion`), and the e2e scaffolding is mid-setup
(placeholder spec, no `test:e2e` script, no auth `storageState`, commented-out `webServer`).

## Desired End State

`npm run test:integration` proves an `ai_unavailable` response still lets a minted
`photoPath` persist a plant (201). `npm run test:run` proves the endpoint returns
`ai_unavailable` for provider 5xx/malformed/transport failures and that aborts propagate.
`npm run test:e2e` drives the real add-plant UI with AI down and asserts the "create
manually" banner, preserved photo, and successful manual save + redirect.

## Key Decisions Made

| Decision                     | Choice                                                      | Why (1 sentence)                                                                                          | Source   |
| ---------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| Fault-injection mechanism    | Two levers: booted-server missing-key + in-process MockAgent | Missing-key short-circuits before the try/catch, so MockAgent is needed to exercise the real degrade path | Plan     |
| Integration assertion scope  | Full photo-preservation chain (upload-url → suggest → plants 201) | Proves the photo actually survives the outage, not just that the degraded shape appears                   | Plan     |
| Build the thin e2e?          | Yes — single-purpose spec, finish scaffolding              | The client-rendered banner is unreachable from integration; PRD US-01 fallback otherwise unproven        | Plan     |
| E2e auth (passwordless app)  | Programmatic session injection via `@supabase/ssr` cookie capture | Deterministic, no magic-link/OTP flakiness; mirrors the integration harness's UI bypass                  | Plan     |
| E2e outage lever             | `webServer` boots with `AI_API_KEY` unset                  | Real server degrade path, zero stub, matches the integration lever                                       | Plan     |
| Upload-failure-blocks-save   | Out of scope                                               | Separate deliberate design / different risk, not an AI-outage gap                                        | Research |

## Scope

**In scope:** integration photo-preservation chain; in-process handler fault test
(provider-throw → `ai_unavailable` + abort propagation); thin e2e + finished scaffolding;
cookbook §6.3 / §6.5.

**Out of scope:** production code changes; upload-failure-blocks-save mode; CI gate wiring
(Phase 4); AI-success happy path; real magic-link e2e auth.

## Architecture / Approach

Coverage splits at the HTTP boundary. **Below the browser:** a booted-server integration
test proves the end-to-end photo chain (zero stub — server runs with no AI key), and a
Docker-free in-process test uses `undici` `MockAgent` over the hardcoded Gemini edge to
prove the 12 s abort / retry / catch → `ai_unavailable` conversion (network edge stubbed
only, never `vi.mock` on our own module). **At the browser:** a thin Playwright e2e boots
the app with `AI_API_KEY` unset and drives the real DOM, authenticating via an injected
`@supabase/ssr` session.

## Phases at a Glance

| Phase                              | What it delivers                                                        | Key risk                                                              |
| ---------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. Server-side fault-injection     | Integration photo chain + Docker-free handler fault test + §6.5         | Proving the timeout without a real 12 s wait or fragile fake timers  |
| 2. Thin e2e for the manual fallback | Finished e2e scaffolding + fallback spec + §6.3                         | Reproducing the `@supabase/ssr` auth-cookie format for `storageState` |

**Prerequisites:** local Supabase up (`npx supabase start`, Docker); Phase 2 builds on
nothing from Phase 1 but shares the missing-key lever.
**Estimated effort:** ~2 sessions, one per phase.

## Open Risks & Assumptions

- `undici` `MockAgent` must be available as a devDependency (add it in Phase 1 if not
  already exposed); the abort-propagation case must avoid fake-timer/undici fragility
  (handled via the two-halves timeout proof).
- The `@supabase/ssr` cookie encoding is version-sensitive — mitigated by letting the
  library emit the cookies rather than hand-rolling them.
- The e2e `webServer` must launch with no `AI_API_KEY`, or the banner never appears.

## Success Criteria (Summary)

- An AI outage never blocks saving a plant with its uploaded photo (integration, 201).
- A hanging/erroring provider degrades to `ai_unavailable`, never a 5xx (in-process).
- A real user with AI down sees the "create manually" banner, keeps their photo, and
  saves successfully (e2e).
