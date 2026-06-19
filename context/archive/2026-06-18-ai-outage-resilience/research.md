---
date: 2026-06-18T00:00:00Z
researcher: Szymon Świątek
git_commit: 15ab79439a8b40263008adbcb2997ba1cf214aab
branch: main
repository: 10xPlantsInventory
topic: "AI-outage resilience — degrade add-plant to manual entry, photo preserved (Test-plan Phase 3 / Risk #1)"
tags: [research, codebase, ai-suggest, fault-injection, integration, e2e, add-plant]
status: complete
last_updated: 2026-06-18
last_updated_by: Szymon Świątek
---

# Research: AI-outage resilience — degrade add-plant to manual entry, photo preserved

**Date**: 2026-06-18T00:00:00Z
**Researcher**: Szymon Świątek
**Git Commit**: 15ab79439a8b40263008adbcb2997ba1cf214aab
**Branch**: main
**Repository**: 10xPlantsInventory

## Research Question

Phase 3 of `context/foundation/test-plan.md` (Risk #1): _"The AI call hangs / errors /
times out and the add-plant flow freezes or returns a 5xx instead of offering manual
entry with the uploaded photo preserved."_ Ground the three things the test plan says
research must produce before a plan can be written:

1. **Where the timeout/abort is enforced** (endpoint vs client).
2. **How the fallback is triggered** (what the degraded contract is).
3. **Where the photo reference is held** when the AI call fails.

Plus the load-bearing test-design decision: **is the degraded "create manually + photo
preserved" outcome provable at the integration layer, or does it need a thin e2e?**

## Summary

**Risk #1 is structurally mitigated in the current code — this phase characterizes and
locks in an existing, deliberate design rather than fixing a gap.**

- **Timeout/abort lives on the server endpoint**, not the client SDK: a 12 s
  `AbortController` wraps the provider call (`src/pages/api/plants/suggest.ts:16,42-47`),
  and the signal is honored by both the raw `fetch` and the retry `sleep` so a hanging
  provider is actually cancelled. The client adds its _own_ independent 15 s
  `AbortController` (`AddPlantForm.tsx:31,152-155`), wider than the server's 12 s, so the
  server normally degrades first.
- **The fallback is triggered by a uniform server contract**: every failure mode (missing
  key, timeout/abort, transport error, non-2xx, unparseable body) collapses to
  `200 { status: "ai_unavailable" }` (`suggest.ts:25-27,49-54`). **There is no 5xx escape
  path.** The client treats any `status !== "ok"` as the manual-fallback trigger
  (`AddPlantForm.tsx:165-176`).
- **The photo reference is held on an independent path**: photo upload (`runUpload`) and
  AI suggest (`runSuggest`) fire in parallel and share no state; `photoPath` is set only by
  the upload (`AddPlantForm.tsx:134`) and is never touched by the suggest failure branch.
  Save is gated on **upload** status, never on AI (`AddPlantForm.tsx:260`). So an AI
  failure cannot lose the photo — preservation holds.
- **Test layer: two layers, split at the HTTP boundary.** The _server_ degrade is provable
  at **integration** (sessioned `POST /api/plants/suggest` → assert `ai_unavailable`, then
  prove the minted `photoPath` still drives a successful `POST /api/plants`). The
  _client-rendered_ "create manually" banner + manual save is **client-side React,
  unreachable from integration**, so a **thin Playwright e2e** is justified per
  `test-plan.md:86`. Playwright is **already installed** (the test plan's §4 is stale on
  this point).

## Detailed Findings

### A. The suggest endpoint — `src/pages/api/plants/suggest.ts`

Full response contract (all bodies JSON):

| Path | Status | Body | Location |
|------|--------|------|----------|
| Success | **200** | `{ status: "ok", suggestion: AiSuggestion }` | `suggest.ts:48` |
| Unauthenticated | **401** | `{ error: "unauthorized" }` | `requireUser` → `src/lib/api.ts:28` |
| AI key missing | **200** | `{ status: "ai_unavailable" }` | `suggest.ts:25-27` |
| AI hang/timeout/error/malformed | **200** | `{ status: "ai_unavailable" }` | `suggest.ts:49-54` |
| Invalid request JSON | **400** | `{ status: "error", error: "invalid_json" }` | `suggest.ts:33` |
| Missing `imageBase64`/`mimeType` | **400** | `{ status: "error", error: "missing_image" }` | `suggest.ts:39` |

- **Auth guard fires first.** `requireUser(context)` at `suggest.ts:19-22`, before any AI
  work and before the key check; returns 401 if `context.locals.user` is absent
  (`src/lib/api.ts:25-31`). `/api/*` is outside the middleware `PROTECTED_ROUTES`, so the
  endpoint self-guards.
- **Timeout is the endpoint's, not the client SDK's.** `AI_TIMEOUT_MS = 12_000`
  (`suggest.ts:16`); a `new AbortController()` + `setTimeout(() => controller.abort(), …)`
  (`suggest.ts:42-47`) wraps `requestSuggestion(…, controller.signal)`; `clearTimeout` in
  `finally` (`suggest.ts:55-57`).
- **Every failure degrades, never 5xx.** The single `try/catch` (`suggest.ts:46-57`)
  collapses any throw to `200 { status: "ai_unavailable" }` (`:49-54`). The header
  docstring (`suggest.ts:6-14`) states the intent: client treats missing-key, timeout, and
  provider error identically so the manual path is the same regardless of cause.

### B. The AI provider client — `src/lib/ai/suggest.ts`

- **HTTP edge (the stub target):** a raw `fetch` (no SDK) to Google Gemini Flash.
  Endpoint is a **hardcoded constant**, not env-driven:
  `GEMINI_ENDPOINT = https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
  (`src/lib/ai/suggest.ts:19-20`); the `fetch` is at `:79-87`, key passed via the
  `x-goog-api-key` header (`:84`).
- **Abort is honored end-to-end.** The `AbortSignal` is threaded into `fetch`
  (`:81`). The retry loop (transient `{429,500,502,503,504}`, 3 attempts, `:47-48,78-105`)
  uses an **abort-aware `sleep`** (`:110-130`) so retries cannot run past the 12 s budget.
- **All error/timeout/malformed modes throw → all degrade:** exhausted/non-retryable
  status `throw` (`:107`); missing JSON text part `throw` (`:92-94`); `JSON.parse` of the
  body throws on bad input (`:95`); abort and transport failures reject the `fetch`. Every
  one propagates to the endpoint's catch.
- **Normalizer is the last success-only step.** `normalizeSuggestion` (`:137-146`) runs
  only after `res.ok` + text extraction + `JSON.parse` (`:96`); it is pure and cannot
  trigger the outage path. (Proven never-throws by Phase 1 — see Historical Context.)

### C. Environment / config

- **Single env var:** `AI_API_KEY` — `astro.config.mjs:21`,
  `envField.string({ context: "server", access: "secret", optional: true })`, imported via
  `astro:env/server` at `suggest.ts:2`. No base-URL or model env var.
- **Unconfigured short-circuits**, mirroring the Supabase null-client pattern: unset
  `AI_API_KEY` → `200 { status: "ai_unavailable" }` before reading the body or touching the
  network (`suggest.ts:25-27`). **This is a zero-stub fault lever for integration tests.**

### D. The add-plant client flow — `src/components/plants/AddPlantForm.tsx`

Page: `src/pages/locations/[id]/plants/new.astro` (RLS-scoped location lookup `:13`, 404s
foreign/unknown `:17-19`, mounts the island `client:load` `:40`). Island receives only
`locationId` (`AddPlantForm.tsx:26-28`).

- **Upload and suggest run in parallel**, kicked off together on photo select in
  `handlePhotoChange` (`:190-200`): `void runUpload(file); void runSuggest(file);`. They
  share no state except being triggered together.
- **Upload (`runUpload`, `:94-144`):** `POST /api/plants/upload-url` mints
  `{ plantId, path, signedUrl }` (`:104-115`; `plantId` stashed in `plantIdRef` `:120` and
  reused on retake `:112`), then a direct PUT to `mint.signedUrl` (`:125-130`, bytes bypass
  the Worker). On success `setPhotoPath(mint.path)` (`:134`). Bounded by a 60 s
  `AbortController` (`UPLOAD_TIMEOUT_MS` `:34`, `:99-102`).
- **Suggest (`runSuggest`, `:146-177`):** downscales to base64 (`:157`), `await`s
  `POST /api/plants/suggest` (`:158-163`) under a **15 s client `AbortController`**
  (`SUGGEST_TIMEOUT_MS` `:31`, `:152-155`). Non-`ok` status → `setAiUnavailable(true)`
  (`:168`/`:172`); `finally` sets `aiStatus="done"` (`:175`).
- **Create (`handleSubmit`, `:230-249`):** `POST /api/plants` sends
  `id: plantIdRef.current`, `locationId`, **`photoPath` (`:236`)**, the editable fields, and
  verbatim `aiSuggestion: snapshot` (`:244`, `null` on outage). Redirects on 201.
- **Fallback (the crux):** editable fields render once `hasPhoto && aiStatus !== "suggesting"`
  (`:335`) — i.e. as soon as AI is no longer in-flight, success or failure. Banner at
  `:326-332`: _"Your photo is saved — just fill in the details below yourself."_ **Photo is
  preserved**: `photoPath` is set only by `runUpload` and never cleared by the AI branch.
  **No infinite spinner**: both paths are `AbortController`-bounded. **Save is
  AI-independent**: `canSave = uploadStatus === "uploaded" && !saving` (`:260`).

**Distinct failure mode worth flagging (not an AI-outage gap):** Save is hard-gated on a
confirmed upload (`uploadStatus === "uploaded" && photoPath && plantIdRef.current`,
`:218-221`) — by design (docstring `:22-23`) so no plant persists with a dangling
`photo_path`. Consequence: if the **photo upload itself** fails, Save is blocked until the
user retries (`retryUpload` `:202-207`, alert `:303-314`). Only the upload path can block
Save; the AI path never does.

### E. The integration harness (reusable as-is from Phase 2)

- **`tests/integration/helpers/server.ts`** — `startServer()` (`:30`) spawns `npx astro dev`
  on port 4322 (`:42`), writing `.dev.vars` with `SUPABASE_URL`/`SUPABASE_KEY` from the
  captured test env (`:31-38`), restored on `stop()` (`:58-64`). The workerd runtime reads
  secrets from `.dev.vars`, **not** process env (`:6-9`). **Extensibility point:** the
  `.dev.vars` write (`:38`) currently omits `AI_API_KEY`, so the booted server already
  hits the missing-key degrade branch. A Phase 3 variant can omit the key (force degrade)
  or write a dummy key — but the provider URL is a hardcoded constant, so an env-pointed
  stub is **not** possible against the child process (see Open Questions).
- **`tests/integration/helpers/clients.ts`** — `serviceRoleClient()` (`:33`, seed/teardown),
  `anonClient()` (`:38`), `sessionedClient(session)` (`:49`, RLS-respecting assertion client).
- **`tests/integration/helpers/sessions.ts`** — `createTestUser()` (`:23`) mints a
  timestamp-unique user + signs in; `deleteTestUser()` (`:56`) clears Storage then cascades.
- **`tests/integration/globalSetup.ts`** — shells `supabase status --output json` (`:21`),
  captures `SUPABASE_TEST_{URL,ANON_KEY,SERVICE_ROLE_KEY}` (`:41-43`), fails fast if down.
- **`vitest.integration.config.ts`** — Node env, `include: tests/integration/**/*.integration.test.ts`
  (`:15`), `globalSetup` (`:16`), `@` alias (`:18-21`). Script: `package.json:12`
  `"test:integration": "vitest run --config vitest.integration.config.ts"`.
- **`tests/integration/auth-boundary.integration.test.ts`** — `redirect:"manual"` per fetch;
  the suggest endpoint's **401 no-session** case already exists (`:59-73`) plus an
  invalid-cookie repeat (`:112-125`). The 401 (not a 200 `ai_unavailable`) proves the guard
  fires before the AI call (`:11-13`).

## Code References

- `src/pages/api/plants/suggest.ts:16,42-47,49-57` — 12 s `AbortController` timeout + uniform `ai_unavailable` catch (no 5xx).
- `src/pages/api/plants/suggest.ts:25-27` — missing-key short-circuit (zero-stub fault lever).
- `src/lib/ai/suggest.ts:19-20,79-87,107-130` — hardcoded Gemini endpoint, raw `fetch`, abort-aware retry/sleep.
- `src/lib/api.ts:25-31` — `requireUser` 401 contract.
- `src/components/plants/AddPlantForm.tsx:190-200` — parallel `runUpload`/`runSuggest`.
- `src/components/plants/AddPlantForm.tsx:134,236` — `photoPath` set by upload only; sent to `POST /api/plants`.
- `src/components/plants/AddPlantForm.tsx:165-176,326-332,335` — fallback trigger + banner + fields render gate.
- `src/components/plants/AddPlantForm.tsx:218-221,260` — Save gated on upload, not AI.
- `tests/integration/helpers/server.ts:30-64` — `startServer()`/`.dev.vars` wiring (omits `AI_API_KEY`).
- `tests/integration/auth-boundary.integration.test.ts:59-73,112-125` — existing suggest 401 cases.
- `playwright.config.ts:15,28,38-39,45-49` — e2e config (testDir, baseURL, storageState, commented webServer).

## Architecture Insights

- **Degrade-on-the-server, fail-soft contract.** The endpoint deliberately erases the
  _reason_ AI failed (missing key vs timeout vs bad body) behind one `ai_unavailable` 200.
  Good for the product (one client path) — but it means an integration test cannot, from
  the HTTP response alone, distinguish a timeout from a missing key. The test must choose
  its fault lever knowing the response shape is identical.
- **Two independent timeout budgets** (server 12 s, client 15 s) with the client wider, so
  in normal operation the server's degrade wins the race. A test asserting "no infinite
  spinner" must respect whichever bound it exercises.
- **Decoupled photo path is the real guarantee.** Photo preservation does not depend on any
  AI error handling — it falls out of `runUpload`/`runSuggest` being separate state
  machines. The cheapest way to _prove_ preservation is to show a `photoPath` minted
  independently still saves via `POST /api/plants` when suggest returns `ai_unavailable`.
- **The provider boundary is not env-seam'd.** Because `GEMINI_ENDPOINT` is a constant,
  fault-injecting timeout/error requires in-process interception of the handler
  (`vi.mock`/`undici` `MockAgent`/MSW _in the test process_), not a redirect of the booted
  `astro dev` child. The missing-key branch is the only fault reachable through the real
  booted server with zero stubbing.

## Historical Context (from prior changes)

- **PRD grounding.** US-01 AC (`context/foundation/prd.md:59`): _"if the AI does not respond
  within a reasonable bound, the user is offered a 'create manually' fallback with the
  uploaded photo preserved"_; reinforced `prd.md:62` (_"manual creation path is always
  reachable regardless of AI availability"_). Guardrail (`prd.md:45`): _"Catalog
  functionality survives AI outage … AI is a value-add, not a hard dependency."_ Backing
  FR-011 (`prd.md:121-122`).
- **Phase 1 (`context/changes/ai-parse-unit/`)** explicitly carved the outage path OUT into
  Phase 3 (`ai-parse-unit/plan.md:81-82`) and proved `normalizeSuggestion` is pure / never
  throws (`src/lib/ai/suggest.test.ts`); the throws that become `ai_unavailable` live in
  `requestSuggestion`, not the normalizer (`ai-parse-unit/research.md:41`).
- **Phase 2 (`context/changes/auth-boundary-integration/`)** built the integration harness
  and tested the suggest endpoint's **401 guard**, deliberately deferring fault injection
  (`auth-boundary-integration/plan.md:92`; `research.md:163` — _"Post-auth provider failure
  returns `{status:"ai_unavailable"}` HTTP 200 — that's Risk #1 / Phase 3 territory"_).
- **MSW-vs-`vi.mock` is still an OPEN planning decision** — no prior phase chose; the test
  plan lists both (`test-plan.md:109`), and Phase 2 stood up neither
  (`auth-boundary-integration/plan.md:27`, `research.md:250`).
- **`context/archive/`** (magic-link-auth, domain-schema-with-rls, first-plant-from-photo)
  carries no AI-fault-injection decisions.

## Related Research

- `context/changes/ai-parse-unit/research.md` — normalizer purity (Risk #5, the sibling of this risk).
- `context/changes/auth-boundary-integration/research.md` — suggest-endpoint auth boundary + the integration harness this phase reuses.

## Open Questions

These are **planning decisions** for `/10x-plan`, not unresolved facts:

1. **Mocking mechanism for the timeout/error branch.** The missing-key degrade needs zero
   stub against the real booted server. To assert the _timeout/error_ branch specifically,
   the hardcoded Gemini `fetch` must be intercepted in-process (`vi.mock` of
   `requestSuggestion`, `undici` `MockAgent`, or MSW _in the test process_) — it cannot be
   redirected via env into the `astro dev` child. Decide whether the timeout-specific case
   is worth the in-process complexity, or whether missing-key + the existing unit coverage
   of `requestSuggestion`'s throws is sufficient signal.
2. **Integration scope.** Confirm the integration assertion is the full chain: mint
   `photoPath` (`/api/plants/upload-url`) → suggest returns `ai_unavailable` → `POST /api/plants`
   with that `photoPath` succeeds (201) — proving "photo preserved," not just the degraded
   shape (avoids the test-plan's "assert success shape" / "test only the mock" anti-patterns).
3. **Thin e2e scope.** A Playwright e2e is justified for the client-rendered banner + manual
   save (unreachable from integration, `test-plan.md:86`). **Playwright is already installed**
   (`package.json:45` `@playwright/test ^1.61.0`; `playwright.config.ts` present) — the test
   plan §4 (`:110` "none yet") is **stale**. But `tests/e2e/seed.spec.ts` is a placeholder
   from another project (deck/card example) and there is no `test:e2e` script, no committed
   auth `storageState`, and the `webServer` block is commented out — so e2e scaffolding is
   mid-setup and Phase 3 would need to finish wiring it (auth storageState, webServer/baseURL,
   a `test:e2e` script) before a thin add-plant fallback spec can run.
