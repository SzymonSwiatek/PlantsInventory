# AI-Outage Resilience — Test Suite Implementation Plan

## Overview

Phase 3 of `context/foundation/test-plan.md` (Risk #1): prove that when the AI
provider hangs, errors, or times out, the add-plant flow **degrades to manual
entry with the uploaded photo preserved** — never an infinite spinner, never a
photo-losing 5xx. Research (`research.md`) established this is **already a
deliberate design**; this change **characterizes and locks it in** rather than
fixing a gap. **No production code changes.**

The coverage splits at the HTTP boundary into two layers:

1. **Server-side degrade** — provable below the browser, via a booted-server
   integration test (full photo-preservation chain) plus an in-process handler
   fault test (the 12 s abort / retry / catch → `ai_unavailable` conversion that
   the missing-key path never exercises).
2. **Client-rendered fallback** — the "create manually" banner + manual save is
   React, unreachable from integration, so a thin Playwright e2e finishes the
   e2e scaffolding and drives the real UI with AI forced unavailable.

## Current State Analysis

- **The endpoint degrades uniformly.** `src/pages/api/plants/suggest.ts` collapses
  every AI failure mode (missing key, 12 s timeout/abort, transport error, non-2xx,
  unparseable body) to `200 { status: "ai_unavailable" }` — **no 5xx escape path**
  (`suggest.ts:25-27,49-54`). A 12 s `AbortController` wraps `requestSuggestion`
  (`suggest.ts:16,42-47`); the catch converts any throw to the degrade body.
- **The missing-key branch short-circuits before the try/catch** (`suggest.ts:25-27`
  returns above line 46). So unsetting `AI_API_KEY` proves the *degrade contract*
  but **never exercises the catch→`ai_unavailable` conversion** for a real provider
  throw. That conversion is currently **untested**.
- **`requestSuggestion`'s throws are untested.** `src/lib/ai/suggest.test.ts` covers
  **only** `normalizeSuggestion` (Phase 1). The raw `fetch` to a **hardcoded**
  `GEMINI_ENDPOINT` (`src/lib/ai/suggest.ts:19-20,79-87`), its abort-aware retry/sleep
  (`:107-130`), and its throws-on-error are not directly asserted.
- **The provider boundary is not env-seam'd.** Because `GEMINI_ENDPOINT` is a
  constant, the booted `astro dev` child **cannot** be redirected to a stub via env.
  In-process interception (`undici` `MockAgent` over global `fetch`) is the only way
  to fault-inject timeout/error — and it works only when the handler runs *in the
  test process*, not against the spawned child.
- **Photo preservation is structural, not error-handling.** Upload (`runUpload`) and
  suggest (`runSuggest`) are independent parallel state machines
  (`AddPlantForm.tsx:190-200`); `photoPath` is set only by upload (`:134`), never
  touched by the AI branch, and Save is gated on **upload only**
  (`canSave = uploadStatus === "uploaded" && !saving`, `:260`). An AI outage cannot
  lose the photo.
- **The integration harness is reusable as-is** (Phase 2): `startServer()` boots
  `astro dev` on port 4322 writing `.dev.vars` with `SUPABASE_*` but **omitting
  `AI_API_KEY`** (`server.ts:30-38`) — so the booted server *already* hits the
  missing-key degrade. `createTestUser()` mints a unique user via the admin API +
  `signInWithPassword` (`sessions.ts:23-49`), **bypassing the magic-link UI** — the
  same trick the e2e will use for auth.
- **E2e scaffolding is mid-setup.** Playwright is installed and `playwright.config.ts`
  exists, but: `tests/e2e/seed.spec.ts` is a placeholder from another project,
  there is **no `test:e2e` script**, **no committed `storageState`**
  (config points at `playwright/.auth/user.json`, `:39`), and the **`webServer`
  block is commented out** (`:45-49`). `baseURL` defaults to `:4321` (`:28`).

## Desired End State

- `npm run test:integration` includes an AI-outage suite that proves, against real
  Supabase + the real booted server, that an `ai_unavailable` suggest response does
  not stop a minted `photoPath` from persisting a plant (201).
- `npm run test:run` (Docker-free) includes a handler fault test proving the endpoint
  returns `200 ai_unavailable` for provider 5xx / malformed / transport failures, and
  that `requestSuggestion` propagates an abort as a throw.
- `npm run test:e2e` exists and runs a single Playwright spec that drives the real
  add-plant UI with AI unavailable, asserting the manual-fallback banner, preserved
  photo, and a successful manual save + redirect.
- The test-plan cookbook §6.3 and §6.5 are filled in (no longer "TBD").

### Key Discoveries:

- Missing-key degrade is reachable with **zero stub** through the booted server, but
  short-circuits before the try/catch (`suggest.ts:25-27`) — so it cannot prove the
  provider-throw → `ai_unavailable` conversion. The in-process lever fills that gap.
- `requestSuggestion`'s throws and the endpoint's abort wiring are **untested today**
  (`src/lib/ai/suggest.test.ts` covers only `normalizeSuggestion`).
- The unit runner picks up `src/**/*.test.ts` and excludes only `tests/integration/**`
  (`vitest.config.ts:17`), so a co-located `suggest.fault.test.ts` runs Docker-free.
- `createTestUser()` (`sessions.ts:23`) already authenticates without the magic-link
  UI — the e2e reuses this pattern for `storageState`.

## What We're NOT Doing

- **No production code changes.** The degrade design is already correct; we only test it.
- **Upload-failure-blocks-save mode** — when the photo *upload itself* fails, Save is
  hard-gated until retry (`AddPlantForm.tsx:218-221`, by design). This is a *separate*
  risk, not an AI-outage gap (`research.md:148-153`). Out of scope.
- **CI wiring** — locking unit+integration (and optionally e2e) as required gates is
  test-plan Phase 4.
- **AI-success happy path** — needs a configured AI key and is not Risk #1.
- **AI suggestion quality / accuracy** — explicitly excluded (`test-plan.md:295`).
- **Real magic-link / OTP e2e auth** — email delivery is out of test scope
  (`test-plan.md:293`); the e2e injects a session instead.

## Implementation Approach

Two levers, honest split (research Open Question #1, chosen at plan time):

1. **Booted server, zero stub** for the end-to-end *photo-preservation chain* — the
   real guarantee a user cares about. Uses the existing harness; the server's omitted
   `AI_API_KEY` is the fault lever.
2. **In-process `undici` MockAgent** for the *provider-throw → degrade conversion* and
   *abort propagation* — the only way to exercise the 12 s abort / retry / catch path,
   stubbing the network edge only (test-plan §4: "mock the HTTP edge, never internal
   modules"), avoiding the "test only the mock" anti-pattern of `vi.mock`-ing our own
   `requestSuggestion`.

For the client-rendered banner (unreachable from integration), a thin Playwright e2e
boots the app with `AI_API_KEY` unset (same missing-key lever, zero stub) and drives
the real DOM.

## Critical Implementation Details

- **Don't wait out the real 12 s timeout, and don't fight fake timers across undici.**
  Prove the timeout in two cheap, deterministic halves instead: (a) at the **handler**,
  MockAgent returns 5xx×3 / malformed body / a transport error → the catch returns
  `200 ai_unavailable` (no real delay); (b) at the **lib**, call `requestSuggestion`
  with a signal you abort while MockAgent holds the response open → expect it to throw.
  Together these prove "abort propagates to a throw" + "a thrown call degrades" —
  i.e. the timeout works — without a 12 s sleep or fragile `vi.useFakeTimers()` +
  `MockAgent` interaction.
- **Let `@supabase/ssr` emit the e2e auth cookies; never hand-roll them.** The
  `sb-<ref>-auth-token` cookie is a versioned, sometimes-chunked, base64-prefixed
  encoding of the session. In global-setup, drive a `createServerClient` from
  `@supabase/ssr` with a cookie-capturing adapter and call `setSession({ access_token,
  refresh_token })`; collect whatever cookies the library writes and serialize *those*
  into Playwright `storageState`. This stays in lockstep with the app's own cookie
  parser across `@supabase/ssr` upgrades.
- **`AI_API_KEY` must be unset for both booted servers.** The integration `startServer()`
  already omits it (`server.ts:38`). The e2e `webServer` command must likewise launch
  with no `AI_API_KEY` in `.dev.vars`/env so every suggest call degrades — otherwise
  the banner never appears and the spec hangs on a never-degrading suggest.

---

## Phase 1: Server-side fault-injection suite (integration + in-process)

### Overview

Prove the server-side degrade in two artifacts: the booted-server integration test
(photo-preservation chain) and the Docker-free handler fault test (provider-throw →
`ai_unavailable` + abort propagation).

### Changes Required:

#### 1. Booted-server integration test — the photo-preservation chain

**File**: `tests/integration/ai-outage.integration.test.ts` (new)

**Intent**: Prove that with the real server running **without** an AI key, the
add-plant flow's server side degrades *and* the independently-minted `photoPath`
still persists a plant. This is the "photo preserved" guarantee end-to-end, not just
the degraded shape.

**Contract**: `beforeAll` boots `startServer()` and `createTestUser()`; `afterAll`
`stop()` + `deleteTestUser()`. Assertions run as the sessioned user against the booted
`baseUrl`, each `fetch` carrying the user's auth cookie and `{ redirect: "manual" }`
where a redirect could mask a denial. The chain:

1. `POST /api/plants/suggest` (valid sessioned request, any small base64 image) →
   assert `200` with body `{ status: "ai_unavailable" }` (server has no key).
2. `POST /api/plants/upload-url` → mint `{ plantId, path, signedUrl }`; PUT the fixture
   bytes to `signedUrl` → assert the upload succeeds (mirrors `AddPlantForm.runUpload`).
3. `POST /api/plants` with `{ id: plantId, locationId, photoPath: path,
   aiSuggestion: null, ...editable fields }` → assert `201` and that the row is
   visible to the sessioned client with the expected `photo_path`.

A seed location for the user is created via the sessioned client in `beforeAll`
(needed for `locationId`). Assert the *linkage*: the same `path` minted in step 2 is
what persists in step 3 — that is the proof the photo survives the outage.

#### 2. In-process handler fault test — provider-throw → degrade + abort propagation

**File**: `src/pages/api/plants/suggest.fault.test.ts` (new, Docker-free unit runner)

**Intent**: Cover the catch→`ai_unavailable` conversion (untested today because
missing-key short-circuits before it) and prove the abort is honored — stubbing only
the provider HTTP edge.

**Contract**: `vi.mock("astro:env/server", () => ({ AI_API_KEY: "test-key" }))` so the
handler passes the key check and reaches the AI call. Install an `undici` `MockAgent`
via `setGlobalDispatcher`, intercepting the hardcoded Gemini host/path
(`generativelanguage.googleapis.com` … `gemini-2.5-flash:generateContent`). Invoke the
route's `POST` with a minimal fake `APIContext` whose `locals.user` is set (to pass
`requireUser`) and whose `request` is a real `Request` carrying valid
`{ imageBase64, mimeType }` JSON. Cases (each asserts `res.status === 200` and body
`{ status: "ai_unavailable" }`):

- MockAgent replies `500` for all 3 retry attempts (retryable exhausted → throw).
- MockAgent replies `200` with a body missing the JSON text part (→ throw at extraction).
- MockAgent replies `200` with non-JSON text (`JSON.parse` throws).
- MockAgent `replyWithError(...)` (transport failure → throw).

Plus a **lib-level abort case** (same file or a sibling `src/lib/ai/suggest.fault.test.ts`):
call `requestSuggestion(key, img, mime, signal)` with a controller you `abort()` while
MockAgent holds the response open (delayed reply) → `await expect(...).rejects` . This
proves the abort propagates as a throw, which the handler's 12 s timer relies on.
Clean up the MockAgent in `afterEach`/`afterAll` and restore the global dispatcher.

#### 3. Cookbook §6.5 — fault-injection pattern

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.5 "TBD" with the proven pattern so the next provider-fault
test is a lookup, not a rediscovery.

**Contract**: Under §6.5, document: the two-lever split (booted-server missing-key for
the end-to-end chain vs in-process `undici` `MockAgent` for the throw→degrade path);
the rule to stub the HTTP edge only (never `vi.mock` `requestSuggestion`); the
two-halves timeout proof (no real 12 s wait, no fake timers across undici); and that
the handler test runs Docker-free under `npm run test:run`. Reference the two new files.

### Success Criteria:

#### Automated Verification:

- Integration suite passes: `npm run test:integration` (local Supabase up)
- Unit suite (incl. handler fault test) passes: `npm run test:run`
- Lint passes: `npm run lint`
- Typecheck/build passes: `npx astro sync && npm run build`

#### Manual Verification:

- The integration test fails as expected if the `photoPath` linkage is broken (e.g.
  temporarily assert a wrong path) — confirming it tests preservation, not just shape.
- The handler fault test fails if the endpoint's catch is removed — confirming it
  tests the real degrade conversion, not a mocked constant.

**Implementation Note**: After completing this phase and all automated verification
passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Thin e2e for the client-rendered manual fallback

### Overview

Finish the e2e scaffolding and add one spec that drives the real add-plant UI with AI
unavailable, proving the user-visible fallback (banner + preserved photo + manual save).

### Changes Required:

#### 1. E2e auth global-setup — programmatic session injection

**File**: `tests/e2e/global-setup.ts` (new) + reference in `playwright.config.ts`

**Intent**: Produce a committed-at-runtime `storageState` so specs start authenticated,
without driving the magic-link UI.

**Contract**: A Playwright `globalSetup` that (a) mints a user + session via the admin
API + `signInWithPassword` (reuse the `createTestUser` approach / share the helper),
(b) drives a `@supabase/ssr` `createServerClient` with a cookie-capturing adapter and
`setSession(...)` to obtain the exact auth cookies (see Critical Implementation
Details), (c) writes them into `playwright/.auth/user.json` as Playwright
`storageState` (cookies scoped to `localhost`, path `/`), and (d) seeds a location for
that user (the add-plant page is reached via `/locations/[id]/plants/new`). Reads
local Supabase keys the same way globalSetup does (`supabase status` or
`SUPABASE_TEST_*`). A matching teardown (`globalTeardown`) deletes the test user.

#### 2. Playwright config — webServer, baseURL, storageState wiring

**File**: `playwright.config.ts`

**Intent**: Boot the real app with AI unavailable and point the run at it.

**Contract**: Uncomment/define `webServer` to launch the app on the test port **with
`AI_API_KEY` unset** (and `SUPABASE_*` set to local) so suggest always degrades;
`reuseExistingServer: !process.env.CI`. Set `baseURL` to that port. Register the
`globalSetup`/`globalTeardown`. Keep the single `Google Chrome` project using
`storageState: playwright/.auth/user.json`.

#### 3. `test:e2e` script + fixture + remove placeholder

**File**: `package.json`, `tests/e2e/fixtures/` (new), `tests/e2e/seed.spec.ts` (delete)

**Intent**: Make the suite runnable and remove the foreign placeholder.

**Contract**: Add `"test:e2e": "playwright test"` to `package.json` scripts. Add a small
valid image fixture (e.g. `tests/e2e/fixtures/plant.jpg`) for the upload step. Delete
`tests/e2e/seed.spec.ts` (the deck/card example from another project). Ensure
`playwright/.auth/` is gitignored.

#### 4. The fallback spec

**File**: `tests/e2e/add-plant-ai-outage.spec.ts` (new)

**Intent**: Prove the client-rendered manual fallback end-to-end with AI down.

**Contract**: Navigate to `/locations/<seededId>/plants/new`. Use accessibility-first
locators (`getByRole`/`getByLabel`/`getByText`; no CSS/XPath). Steps:

1. Set the photo input to the fixture (`setInputFiles`) — kicks off parallel
   upload + suggest.
2. Wait for **state, never a timeout**: assert the "create manually" banner text
   ("Your photo is saved — just fill in the details below yourself.") becomes visible
   (`toBeVisible()`), and the editable fields render. This is the degrade signal.
3. Assert the photo preview/thumbnail is present (photo preserved).
4. Fill the editable fields (species, etc.) via label/role locators.
5. Click Save → assert navigation to the plant/detail route (`waitForURL`) — manual
   save succeeded despite AI being down.

Use a unique species/name (timestamp suffix) for independence; rely on
`globalTeardown` for user cleanup. Do **not** assert the upload-failure-blocks-save
mode (out of scope).

#### 5. Cookbook §6.3 — e2e pattern

**File**: `context/foundation/test-plan.md`

**Intent**: Replace §6.3 "TBD" with the proven e2e pattern; correct §4's stale "none
yet" for the e2e/Playwright row.

**Contract**: Document: programmatic session injection via `@supabase/ssr` cookie
capture (not magic-link); `webServer` with `AI_API_KEY` unset as the zero-stub outage
lever; accessibility-first locators + wait-for-state (no `waitForTimeout`); per-test
unique ids + `globalTeardown` cleanup. Update §4 to mark Playwright as installed/wired.

### Success Criteria:

#### Automated Verification:

- E2e passes against local Supabase: `npm run test:e2e`
- Lint passes: `npm run lint`
- Typecheck/build passes: `npx astro sync && npm run build`
- Placeholder removed: `tests/e2e/seed.spec.ts` no longer exists

#### Manual Verification:

- Run `npm run test:e2e` headed (`--headed`) once and watch the banner appear and the
  manual save redirect — confirm the assertion matches real UI behavior.
- Confirm the spec fails if `AI_API_KEY` is provided to the webServer (banner never
  appears) — proving the outage lever is what drives the fallback.
- Confirm `storageState` auth works (the new-plant page loads without a sign-in
  redirect).

**Implementation Note**: After completing this phase and all automated verification
passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- Handler fault test: provider 5xx-exhausted / malformed / transport-error →
  `200 ai_unavailable`; `requestSuggestion` abort → throws. Network edge stubbed only.

### Integration Tests:

- Photo-preservation chain: `suggest` degrades → minted `photoPath` persists a plant
  (201), against the real booted server (no AI key) + real Supabase.

### E2e (Manual + Automated):

1. Seeded session + location via global-setup.
2. Add-plant page → photo select → banner appears (AI down) → photo preserved →
   manual fields → Save → redirect.
3. Negative check (manual): supplying an AI key removes the banner.

## Performance Considerations

The integration test pays one `astro dev` boot (~tens of seconds) — scope the server
lifecycle to this file only (mirrors the auth-boundary suite). The handler fault test
is Docker- and server-free. The e2e pays one `webServer` boot per run.

## Migration Notes

None — no schema or data changes. New dev-dependency surface is limited to `undici`'s
`MockAgent` (already transitively available via the Node/Vite toolchain; if not
exposed, add `undici` as a devDependency in Phase 1).

## References

- Research: `context/changes/ai-outage-resilience/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 Risk #1, §3 Phase 3, §6.3/§6.5)
- Server degrade: `src/pages/api/plants/suggest.ts:16,25-27,42-57`
- Provider edge: `src/lib/ai/suggest.ts:19-20,79-87,107-130`
- Client fallback: `src/components/plants/AddPlantForm.tsx:134,190-200,260,326-335`
- Harness: `tests/integration/helpers/{server.ts,sessions.ts,clients.ts}`
- E2e scaffold: `playwright.config.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step
> lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Server-side fault-injection suite

#### Automated

- [x] 1.1 Integration suite passes: `npm run test:integration` — de5f757
- [x] 1.2 Unit suite (incl. handler fault test) passes: `npm run test:run` — de5f757
- [x] 1.3 Lint passes: `npm run lint` — de5f757
- [x] 1.4 Typecheck/build passes: `npx astro sync && npm run build` — de5f757

#### Manual

- [x] 1.5 Integration test fails if the `photoPath` linkage is broken (tests preservation, not shape) — de5f757
- [x] 1.6 Handler fault test fails if the endpoint catch is removed (tests real degrade conversion) — de5f757

### Phase 2: Thin e2e for the client-rendered manual fallback

#### Automated

- [x] 2.1 E2e passes: `npm run test:e2e` — 31315dd
- [x] 2.2 Lint passes: `npm run lint` — 31315dd
- [x] 2.3 Typecheck/build passes: `npx astro sync && npm run build` — 31315dd
- [x] 2.4 Placeholder `tests/e2e/seed.spec.ts` no longer exists — 31315dd

#### Manual

- [x] 2.5 Headed run shows banner appearing + manual save redirect matching the assertion — 31315dd
- [x] 2.6 Spec fails if `AI_API_KEY` is provided to the webServer (banner never appears) — 31315dd
- [x] 2.7 `storageState` auth works — new-plant page loads without a sign-in redirect — 31315dd
