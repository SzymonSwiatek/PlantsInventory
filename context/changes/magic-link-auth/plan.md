# Magic-link Authentication — Implementation Plan

## Overview

Convert the existing email+password auth scaffold into the passwordless magic-link flow required by PRD `Access Control` (FR-001, FR-002, FR-003). Sign-up and sign-in collapse into one email-only entry on `/auth/signin`; a server endpoint sends a single-use link via Supabase OTP; a new server route at `/auth/confirm` verifies the token, attaches the cookie session, and lands the user on `/dashboard` (with a same-origin `?next=` override hook for future deep links). Sign-out keeps its existing local-scope behavior. Production SMTP is deferred to S-04.

## Current State Analysis

The auth scaffold is fully wired for email+password against Supabase, but every leaf disagrees with the PRD:

- `src/pages/api/auth/signin.ts:13` calls `supabase.auth.signInWithPassword({ email, password })` and `src/pages/api/auth/signup.ts:13` calls `supabase.auth.signUp({ email, password })` — both methods are the wrong primitive.
- `src/components/auth/SignInForm.tsx` and `SignUpForm.tsx` both render password (and confirm-password) inputs with `PasswordToggle.tsx`; `SignUpForm.tsx:33` enforces a `MIN_PASSWORD_LENGTH = 6`.
- `src/pages/auth/{signin,signup,confirm-email}.astro` form three pages; `confirm-email.astro:4` branches on `import.meta.env.DEV` so the wording lies in production ("Check your email" only shows in built mode, even though signup never sends one in dev).
- `src/middleware.ts:13` and `src/lib/supabase.ts:9` are correct — they read the cookie session via `@supabase/ssr` and degrade gracefully when env vars are unset. No changes needed.
- `src/pages/api/auth/signout.ts:6` calls `supabase.auth.signOut()` with no scope arg (defaults to `local`). PRD FR-003 + the explicit "sign me out of all devices was intentionally not added to v1" note confirm this is correct.

Supabase config has three blockers:

- `supabase/config.toml:158` sets `site_url = "http://127.0.0.1:3000"`, but Astro dev runs on `4321` — magic-link URLs would point at a dead server in local dev.
- `supabase/config.toml:160` lists `additional_redirect_urls = ["https://127.0.0.1:3000"]` — the `https` is a typo; the URL is also unused.
- No `[auth.email.template.magic_link]` is defined, so Supabase falls back to the default template which exposes `{{ .ConfirmationURL }}` but not `{{ .TokenHash }}`. Our chosen verification path needs `{{ .TokenHash }}`.

Inbucket is enabled (`supabase/config.toml:104`, port `54324`) so local email delivery is already solved. No production SMTP is configured (`[auth.email.smtp]` is commented out); per Round 2 Q4 this is deferred to S-04.

### Key Discoveries:

- `@supabase/ssr` v0.10.3 + `createServerClient` (`src/lib/supabase.ts:9`) accept Astro's `cookies` API directly; setting the session in `/auth/confirm` requires only that the route uses `context.redirect(...)` (not `Response.redirect`), so the `Set-Cookie` headers persist on the redirect response.
- `signInWithOtp({ email })` defaults `should_create_user: true`, which is exactly what PRD Access Control asks for ("entering a new email creates an account on first link-click"). No flag plumbing needed.
- `verifyOtp({ token_hash, type: 'email' })` requires the email template to emit `{{ .TokenHash }}` — not `{{ .Token }}` (which is the 6-digit code) and not `{{ .ConfirmationURL }}` (which encapsulates everything Supabase wants to do itself). The custom template is non-negotiable.
- Astro pages routing under `src/pages/auth/` already coexists with API routes under `src/pages/api/auth/`. A new `src/pages/auth/confirm.ts` exporting `GET` resolves to `/auth/confirm` and can sit alongside `.astro` siblings without colliding.
- `FormField.tsx`, `SubmitButton.tsx`, `ServerError.tsx` are auth-agnostic and stay as-is; `PasswordToggle.tsx` and `SignUpForm.tsx` become dead code.
- `src/pages/dashboard.astro:17` already posts to `/api/auth/signout` — no UI change needed to keep sign-out working through the conversion.

## Desired End State

A user lands on `/auth/signin`, enters their email, clicks "Send sign-in link", and is taken to `/auth/check-email` with a "We sent a sign-in link to <email>" message. The email (visible in Inbucket locally) contains a link to `${SITE_URL}/auth/confirm?token_hash=...&type=email&next=/dashboard`. Clicking that link sets the session cookies and lands them on `/dashboard`, where their email is shown and a Sign out button is visible. Clicking Sign out returns them to `/`. Clicking an expired or already-used link bounces back to `/auth/signin?error=<msg>` with the error rendered inline. The flow contains no password input anywhere in the UI, the API, the email, or the Supabase config.

Verification:

- `npm run lint && npm run build` both succeed.
- The flow above completes end-to-end locally with `supabase start` + `npm run dev` + Inbucket.
- A `grep` for `signInWithPassword`, `signUp`, `PasswordToggle`, `SignUpForm`, `MIN_PASSWORD_LENGTH` across `src/` returns zero hits.
- `supabase/templates/magic_link.html` exists and is referenced from `[auth.email.template.magic_link]` in `supabase/config.toml`.

## What We're NOT Doing

- **No production SMTP provider** (Resend / Postmark / etc.). Deferred to S-04 (watering reminders), which needs the same provider. The remote Supabase project will ship F-01 using Supabase's default sender — fine for solo developer testing, NOT safe for external users.
- **No "sign me out of all devices"** affordance. PRD explicitly flags this as intentionally out of v1.
- **No PKCE / hash-fragment client flow**. The `verifyOtp({ token_hash })` server pattern is the only verification path.
- **No deep-link reminder URLs yet**. The `?next=` query-string contract is in place at `/auth/confirm` and the template hard-codes `&next=/dashboard`; future slices (S-04 specifically) can extend the template or construct verification URLs with a different `next`.
- **No new auth pages beyond renaming `confirm-email.astro` → `check-email.astro`** and a 1-line redirect stub at `/auth/signup`. No dedicated `/auth/link-error` page; errors render on `/auth/signin`.
- **No OAuth / third-party providers**. PRD Access Control specifies passwordless magic-link only.

## Implementation Approach

Three vertical phases, each independently verifiable:

1. **Email delivery and Supabase config** lands the template + config in isolation; verified by triggering an OTP from Supabase Studio and reading the email out of Inbucket.
2. **Server-side auth flow** rewrites the POST endpoint and adds the GET verification endpoint; verified by a curl-driven end-to-end round trip without touching the UI.
3. **UI cleanup** strips passwords from the React form, rewrites the auth pages, and deletes dead components; verified by a manual click-through of the full flow in a browser.

The ordering means each phase fails loudly if the previous one is wrong — the UI phase has no way to succeed if Phase 2's endpoints aren't returning the right redirects, and Phase 2 has no way to succeed if Phase 1's template doesn't emit `token_hash`.

## Critical Implementation Details

**`?next=` open-redirect defense**. `/auth/confirm` must validate `next` strictly before redirecting: reject anything not starting with `/`, reject anything starting with `//` (protocol-relative), reject anything containing `:` before the first `/`. Fall back to `/dashboard` on any failed check. Without this, the magic-link endpoint becomes an open redirector.

**Cookie persistence on redirect**. The `/auth/confirm` GET handler must use Astro's `context.redirect(target)` (not `new Response(null, { status: 302, headers: { Location: target }})`) so the `Set-Cookie` headers attached by `@supabase/ssr`'s cookie setter survive on the response. The existing `signin.ts:19` pattern is the reference.

## Phase 1: Email delivery and Supabase config

### Overview

Land the custom magic-link email template, wire it into `supabase/config.toml`, fix `site_url`/`additional_redirect_urls`. After this phase, requesting a magic link from Supabase Studio produces an Inbucket email whose link points at `${SITE_URL}/auth/confirm?token_hash=...&type=email&next=/dashboard`.

### Changes Required:

#### 1. Custom magic-link email template

**File**: `supabase/templates/magic_link.html` (new)

**Intent**: Provide a minimal HTML email body whose CTA links to our own `/auth/confirm` endpoint with `token_hash`, `type=email`, and `next=/dashboard`. Plain styling — branding is out of scope for the foundation.

**Contract**: Must use Supabase's Go-template placeholders `{{ .SiteURL }}` and `{{ .TokenHash }}`. The final link, after substitution, must be `${SITE_URL}/auth/confirm?token_hash=<hex>&type=email&next=/dashboard`. Subject line is configured in `config.toml`, not the body.

#### 2. Supabase auth config

**File**: `supabase/config.toml`

**Intent**: Reference the custom template, point `site_url` at the actual Astro dev port, and clean up the redirect URL list. Leave every other auth-section setting alone.

**Contract**: Add a `[auth.email.template.magic_link]` block with `subject = "Sign in to 10xPlantsInventory"` and `content_path = "./supabase/templates/magic_link.html"`. Change `site_url` to `http://localhost:4321`. Replace `additional_redirect_urls = ["https://127.0.0.1:3000"]` with the list `["http://localhost:4321", "http://127.0.0.1:4321"]` — the production URL is added in a follow-up commit on the remote Supabase project (documented in Migration Notes; not in committed config because the prod URL is not yet final). `enable_signup`, `enable_confirmations`, `otp_expiry`, and the rate-limit block are unchanged.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- `supabase/templates/magic_link.html` exists and is non-empty
- `supabase/config.toml` parses cleanly under `npx supabase status` (or `npx supabase start` if a fresh local DB is acceptable)
- A grep of `supabase/config.toml` shows `[auth.email.template.magic_link]` present and the old `https://127.0.0.1:3000` typo absent

#### Manual Verification:

- After `npx supabase start`, opening Supabase Studio (`http://localhost:54323`) and triggering "Send magic link" from the Authentication panel produces an email visible in Inbucket (`http://localhost:54324`)
- The email body contains a link of the form `http://localhost:4321/auth/confirm?token_hash=<value>&type=email&next=/dashboard` — the `token_hash` is a hex string, not the literal `{{ .TokenHash }}`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Server-side auth flow

### Overview

Rewrite `/api/auth/signin` to request a magic link instead of validating a password, add `/auth/confirm` as a GET endpoint that verifies the token and sets the session cookies, delete the now-unused `/api/auth/signup`. The flow is testable end-to-end via curl after this phase; the UI still shows password fields and will be cleaned up in Phase 3.

### Changes Required:

#### 1. Rewrite the sign-in endpoint

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Replace `signInWithPassword` with `signInWithOtp`. Read `email` from the form; trim and lowercase it; call `signInWithOtp({ email, options: { emailRedirectTo: ${SITE_URL}/auth/confirm } })`. On error, redirect to `/auth/signin?error=<encoded>`; on success, redirect to `/auth/check-email?email=<encoded>` so the next page can echo the address. Preserve the existing null-check on `createClient(...)`.

**Contract**: POST handler signature is unchanged (`APIRoute` exporting `POST`). No `password` field is read. `should_create_user` is left at its default (`true`). `emailRedirectTo` must use the request origin (e.g., `new URL(context.request.url).origin`) so it works in both dev (`localhost:4321`) and prod (Workers domain) without re-reading `SUPABASE_URL`. The `SITE_URL` env from `astro:env/server` is NOT introduced — origin-from-request keeps the route self-contained.

#### 2. New magic-link verification endpoint

**File**: `src/pages/auth/confirm.ts` (new)

**Intent**: GET handler that reads `token_hash`, `type`, and `next` from the URL query string; calls `supabase.auth.verifyOtp({ type: 'email', token_hash })`; on success, redirects to the validated `next` (default `/dashboard`); on failure, redirects to `/auth/signin?error=<encoded>`. The cookie session is persisted by `@supabase/ssr` via the cookie setter passed in to `createServerClient`.

**Contract**: Exports `GET: APIRoute`. Uses the existing `createClient(context.request.headers, context.cookies)` helper. The `next` sanitizer must reject any value where `!next.startsWith("/") || next.startsWith("//") || next.includes(":")` — fall back to `/dashboard` on any failed check. Final redirect uses `context.redirect(safeNext)` to preserve `Set-Cookie`. Errors from `verifyOtp` are mapped to user-facing copy: missing/malformed params → `"This sign-in link is invalid. Enter your email to get a new one."`; verification error → `"This sign-in link is expired or already used. Enter your email to get a new one."`.

#### 3. Delete the sign-up endpoint

**File**: `src/pages/api/auth/signup.ts` (delete)

**Intent**: The signup primitive is gone — `signInWithOtp` with `should_create_user: true` covers both create and sign-in.

**Contract**: File removed. No other code references it once Phase 3's UI cleanup lands; deleting it in Phase 2 is intentional so a stray POST to `/api/auth/signup` 404s instead of silently 500-ing on a password-shaped body.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Astro type sync passes: `npx astro sync`
- `grep -r "signInWithPassword\|signUp(" src/` returns no hits

#### Manual Verification:

- `curl -i -X POST http://localhost:4321/api/auth/signin -d "email=test@example.com"` returns 302 to `/auth/check-email?email=test%40example.com`
- The Inbucket inbox at `http://localhost:54324` shows a new email for `test@example.com` whose link contains `token_hash=` and `next=/dashboard`
- Following the link with curl (`curl -i -L "<link>"`) returns 302 to `/dashboard` and the final response includes `Set-Cookie` headers for `sb-*` access/refresh tokens
- Visiting that link a second time returns 302 to `/auth/signin?error=...` with the "expired or already used" copy URL-encoded in the query string
- Submitting an obviously-bad URL like `/auth/confirm?token_hash=abc&type=email&next=//evil.com` redirects to `/dashboard` (the `//`-prefixed `next` is rejected by sanitization)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: UI cleanup and single entry surface

### Overview

Strip every trace of passwords from the React form and Astro pages, rename `confirm-email.astro` to `check-email.astro` (and rewrite its copy), replace `/auth/signup.astro` with a redirect stub, and delete the dead components. After this phase the entire flow is reachable from a browser without password fields, signup pages, or stale copy.

### Changes Required:

#### 1. Email-only sign-in form

**File**: `src/components/auth/SignInForm.tsx`

**Intent**: Remove all password state (`password`, `showPassword`, `PasswordToggle` usage). Keep the email field, validation, and `ServerError` display. Update the `SubmitButton` label to "Send sign-in link" with the `Mail` icon (drop `LogIn`). Form action stays `POST /api/auth/signin`.

**Contract**: Component exports default `SignInForm({ serverError })`. State shrinks to `{ email, errors: { email? } }`. Pending text in `SubmitButton` becomes `"Sending link..."`. No other component contract changes; the form is still consumed via `<SignInForm client:load />` from `signin.astro`.

#### 2. Sign-in page copy + remove sign-up link

**File**: `src/pages/auth/signin.astro`

**Intent**: Update the heading subtitle and footer to reflect passwordless flow. Remove the "Don't have an account? Sign up" footer line — there is no separate signup. Add a short helper line under the heading: "Enter your email and we'll send you a sign-in link."

**Contract**: The Astro `error` query-param read at line 5 is unchanged; `<SignInForm serverError={error} client:load />` is unchanged. The footer `<a href="/auth/signup">` link is removed.

#### 3. Rename confirm-email page → check-email

**File**: `src/pages/auth/check-email.astro` (rename from `src/pages/auth/confirm-email.astro`)

**Intent**: After renaming, rewrite the body to a single state: "We sent a sign-in link to <email>. Click it from this device to finish signing in." Read `email` from `Astro.url.searchParams` and render it (no echo if missing — fall back to "your email"). Drop the `import.meta.env.DEV` branching entirely.

**Contract**: New route is `/auth/check-email`. The signin endpoint redirects here with `?email=<encoded>`. No links to old `/auth/confirm-email` exist (confirmed via grep — only the page itself referenced it).

#### 4. Redirect stub for the deleted signup page

**File**: `src/pages/auth/signup.astro`

**Intent**: Replace the entire file with a 1-line Astro server redirect to `/auth/signin`. Anyone with a bookmark or muscle memory ends up in the right place.

**Contract**: File contents reduce to a frontmatter-only Astro component that calls `return Astro.redirect("/auth/signin", 308)` (permanent redirect). No imports, no JSX.

#### 5. Delete dead components

**Files**: `src/components/auth/SignUpForm.tsx`, `src/components/auth/PasswordToggle.tsx` (delete)

**Intent**: With `SignInForm.tsx` no longer importing `PasswordToggle` and `signup.astro` no longer importing `SignUpForm`, both components are unused.

**Contract**: Files removed. `FormField.tsx`, `SubmitButton.tsx`, and `ServerError.tsx` remain — they are auth-agnostic and still used.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Astro type sync passes: `npx astro sync`
- `grep -r "PasswordToggle\|SignUpForm\|MIN_PASSWORD_LENGTH\|password" src/components/auth/ src/pages/auth/ src/pages/api/auth/` returns no hits (case-insensitive `password` should match nothing in auth surface)
- `src/components/auth/SignUpForm.tsx` and `src/components/auth/PasswordToggle.tsx` no longer exist
- `src/pages/auth/confirm-email.astro` no longer exists; `src/pages/auth/check-email.astro` does

#### Manual Verification:

- Visiting `http://localhost:4321/auth/signin` in a browser shows only an email field, the "Send sign-in link" button, and the helper line — no password field anywhere
- Submitting a valid email redirects to `/auth/check-email?email=<value>` and the page echoes the address
- The email arrives in Inbucket; clicking the link in the same browser session lands on `/dashboard` with the user's email visible
- Clicking "Sign out" on `/dashboard` returns to `/` and revisiting `/dashboard` redirects back to `/auth/signin`
- Visiting `http://localhost:4321/auth/signup` redirects (308) to `/auth/signin`
- Clicking the magic link a second time lands on `/auth/signin` with the "expired or already used" error visible in the `ServerError` banner

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

The repo has no test runner configured (per `CLAUDE.md`), so verification is entirely manual + lint/build/sync gates.

### Manual Testing Steps:

1. **Cold start**: `npx supabase start`, then `npm run dev`. Open `http://localhost:4321`.
2. **Happy path**: Click through to `/auth/signin`, enter an email, submit. Confirm `/auth/check-email` page shows the email. Open Inbucket at `http://localhost:54324`, find the email, click the link. Confirm landing on `/dashboard` with email visible.
3. **Sign out**: From `/dashboard`, click Sign out. Confirm landing on `/` and that `/dashboard` now redirects to `/auth/signin`.
4. **Bad link**: Click the same magic link a second time. Confirm redirect to `/auth/signin?error=...` with copy visible.
5. **Open-redirect attempt**: Hand-craft `http://localhost:4321/auth/confirm?token_hash=<valid>&type=email&next=//example.com`. Confirm redirect to `/dashboard` (not `example.com`).
6. **Legacy URL**: Visit `http://localhost:4321/auth/signup`. Confirm 308 redirect to `/auth/signin`.
7. **No-config degradation**: Unset `SUPABASE_URL` in `.env`/`.dev.vars` and restart `npm run dev`. Confirm POST to `/api/auth/signin` returns the existing "Supabase is not configured" error redirect (no crash).

## Migration Notes

- **Existing password-only users (if any in the remote Supabase project)**: Supabase Auth treats `signInWithOtp` as a parallel sign-in method — existing user records are picked up by email match. No data migration required. Any previously stored passwords become inert (the only sign-in path no longer reads them).
- **Production Supabase project**: After merging F-01, the remote Supabase project still needs (a) the custom magic-link template uploaded via Supabase Dashboard → Auth → Email Templates → Magic Link, copy-pasting from `supabase/templates/magic_link.html`, and (b) the production Workers URL added to `Authentication → URL Configuration → Redirect URLs`. Until both are done, magic links in production will either point at localhost or get rejected by Supabase's redirect-URL allow-list.
- **Production email delivery**: The remote project will ship using Supabase's built-in sender, which is rate-limited to a few emails per hour and explicitly marked "for development only". This is acceptable for solo MVP testing and explicitly NOT acceptable for any external user. The real SMTP provider lands with S-04 (watering reminders), which needs it for digest delivery; that slice will fold F-01's `[auth.email.smtp]` config in at the same time.

## References

- Roadmap entry: `context/foundation/roadmap.md` § F-01
- PRD: `context/foundation/prd.md` § Authentication (FR-001 / FR-002 / FR-003) and § Access Control
- Existing auth scaffold:
  - `src/lib/supabase.ts:5` — `createClient` returns `null` when env unset; preserve null-check semantics
  - `src/middleware.ts:11` — `supabase.auth.getUser()` resolves `context.locals.user`; cookie session must be set before this runs on `/dashboard`
  - `src/pages/dashboard.astro:17` — existing sign-out form (no change needed)
- Supabase docs:
  - Server-Side Auth Magic Link pattern (`verifyOtp` + `{{ .TokenHash }}` template)
  - `@supabase/ssr` cookie-setter contract

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Email delivery and Supabase config

#### Automated

- [ ] 1.1 Lint passes: `npm run lint`
- [ ] 1.2 `supabase/templates/magic_link.html` exists and is non-empty
- [ ] 1.3 `supabase/config.toml` parses cleanly under `npx supabase status`
- [ ] 1.4 `[auth.email.template.magic_link]` present in config; `https://127.0.0.1:3000` typo removed

#### Manual

- [ ] 1.5 Supabase Studio "Send magic link" produces an Inbucket email
- [ ] 1.6 Email link matches `http://localhost:4321/auth/confirm?token_hash=<value>&type=email&next=/dashboard`

### Phase 2: Server-side auth flow

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Build passes: `npm run build`
- [ ] 2.3 Astro type sync passes: `npx astro sync`
- [ ] 2.4 `grep -r "signInWithPassword\|signUp(" src/` returns no hits

#### Manual

- [ ] 2.5 `curl POST /api/auth/signin` returns 302 to `/auth/check-email?email=<encoded>`
- [ ] 2.6 Inbucket shows a new magic-link email for the submitted address
- [ ] 2.7 Following the link returns 302 to `/dashboard` with `Set-Cookie: sb-*` headers
- [ ] 2.8 Second use of the link returns 302 to `/auth/signin?error=...` (expired/used copy)
- [ ] 2.9 `?next=//evil.com` is rejected and falls back to `/dashboard`

### Phase 3: UI cleanup and single entry surface

#### Automated

- [ ] 3.1 Lint passes: `npm run lint`
- [ ] 3.2 Build passes: `npm run build`
- [ ] 3.3 Astro type sync passes: `npx astro sync`
- [ ] 3.4 No `PasswordToggle`/`SignUpForm`/`MIN_PASSWORD_LENGTH`/`password` references remain in `src/{components,pages}/auth*`
- [ ] 3.5 `SignUpForm.tsx` and `PasswordToggle.tsx` deleted; `confirm-email.astro` renamed to `check-email.astro`

#### Manual

- [ ] 3.6 `/auth/signin` shows only an email field + "Send sign-in link" + helper line
- [ ] 3.7 Submitting an email lands on `/auth/check-email?email=<value>` with address echoed
- [ ] 3.8 Clicking the Inbucket link lands on `/dashboard` with user email visible
- [ ] 3.9 Sign out from `/dashboard` returns to `/`; revisiting `/dashboard` redirects to `/auth/signin`
- [ ] 3.10 `/auth/signup` redirects (308) to `/auth/signin`
- [ ] 3.11 Reusing a magic link shows the "expired or already used" error in the `ServerError` banner
