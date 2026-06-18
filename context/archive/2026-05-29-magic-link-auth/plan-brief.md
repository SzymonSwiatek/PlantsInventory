# Magic-link Authentication — Plan Brief

> Full plan: `context/changes/magic-link-auth/plan.md`

## What & Why

Convert the existing email+password auth scaffold into a passwordless magic-link flow as specified by PRD § Access Control (FR-001/002/003). Sign-up and sign-in collapse into a single email-only entry: typing a known email signs the user in, a new email creates the account on first link-click. This is roadmap foundation F-01 — every signed-in slice (S-01 north star plus S-02 through S-05) blocks on it.

## Starting Point

The repo ships with a Supabase email+password scaffold: `signin.ts` calls `signInWithPassword`, `signup.ts` calls `signUp`, and the React forms render password + confirm-password fields with a `PasswordToggle`. `middleware.ts` already resolves the cookie session correctly via `@supabase/ssr` and redirects unauthenticated `/dashboard` hits to `/auth/signin` — that read path is preserved untouched. Supabase Inbucket is enabled locally, so dev email delivery works out of the box. No production SMTP is configured.

## Desired End State

A user opens `/auth/signin`, types their email, clicks "Send sign-in link", and lands on `/auth/check-email` with confirmation copy. The email contains a link to `${SITE_URL}/auth/confirm?token_hash=...&type=email&next=/dashboard`. Clicking it sets the session cookies and drops them on `/dashboard`. Bad/expired/reused links bounce to `/auth/signin?error=...` with the existing `ServerError` banner. No password input remains anywhere in the UI, API, email, or Supabase config.

## Key Decisions Made

| Decision                 | Choice                                                                                  | Why                                                                                                                 | Source |
| ------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------ |
| Entry-form shape         | Single combined `/auth/signin` page (email-only); `/auth/signup` becomes a 308 redirect | Matches PRD verbatim ("Sign-up and sign-in collapse into a single flow"); no signin-vs-signup decision for the user | Plan   |
| Verification pattern     | GET `/auth/confirm` with `verifyOtp({ token_hash, type: 'email' })`                     | Current Supabase SSR recommendation; works directly with cookie-session middleware; easy to curl-test               | Plan   |
| Post-submit screen       | Redirect to renamed `/auth/check-email` page (was `confirm-email`)                      | Reuses existing page; clean separation between "request" and "waiting" states; survives refresh                     | Plan   |
| Landing target           | `/dashboard` by default; same-origin `?next=` override                                  | Sets up deep-link reminders (S-04/S-05) without paying for them now; sanitization stops open-redirect               | Plan   |
| Sign-out scope           | Local session only (default `signOut()`)                                                | PRD explicitly defers "sign me out of all devices" out of v1; current behavior is already correct                   | Plan   |
| Bad-link error UX        | Redirect to `/auth/signin?error=<msg>` (reuses `ServerError`)                           | One click from recovery; no new pages; both expired and reused collapse to "request a new link"                     | Plan   |
| Email template ownership | Commit `supabase/templates/magic_link.html`, reference from `config.toml`               | Required — default template lacks `{{ .TokenHash }}`; git-tracked template keeps local + prod in sync               | Plan   |
| Production SMTP          | Out of scope — defer to S-04 (which also needs a real provider)                         | Avoids duplicate setup; respects main_goal=speed; Inbucket covers local, Supabase default sender covers dev-on-prod | Plan   |

## Scope

**In scope:**

- Rewrite `src/pages/api/auth/signin.ts` to call `signInWithOtp`
- Add `src/pages/auth/confirm.ts` (GET) calling `verifyOtp` + safe `next` redirect
- Delete `src/pages/api/auth/signup.ts`, `SignUpForm.tsx`, `PasswordToggle.tsx`
- Strip password fields from `SignInForm.tsx` and update copy + submit label
- Rename `confirm-email.astro` → `check-email.astro` with fresh copy
- Replace `signup.astro` with a 308 redirect to `/auth/signin`
- Update `signin.astro` to drop the "Sign up" footer link
- Add `supabase/templates/magic_link.html`; wire `[auth.email.template.magic_link]` in `config.toml`
- Fix `site_url` (4321) and clean `additional_redirect_urls` in `config.toml`

**Out of scope:**

- Production SMTP provider (Resend / Postmark / etc.) — deferred to S-04
- "Sign me out of all devices" affordance — explicitly out per PRD
- OAuth / third-party providers
- A dedicated `/auth/link-error` page (errors render on `/auth/signin`)
- Any tests (no test runner is configured in this repo)
- Deep-link reminder URLs (the `?next=` plumbing is in place; callers come with S-04)

## Architecture / Approach

```
[/auth/signin POST email]
        │
        ▼
src/pages/api/auth/signin.ts  ──signInWithOtp──▶  Supabase  ──Inbucket/SMTP──▶  email
        │                                                                          │
        ▼                                                                          ▼
/auth/check-email?email=...                                              user clicks link
                                                                                   │
                                                                                   ▼
                                                                 src/pages/auth/confirm.ts (GET)
                                                                 verifyOtp({ token_hash, type })
                                                                 sanitize ?next, set sb-* cookies
                                                                                   │
                                                                                   ▼
                                                                              /dashboard
```

Three vertical phases, each independently verifiable: Phase 1 lands the email template + config; Phase 2 lands both server endpoints and is testable via curl alone; Phase 3 lands the React/Astro UI cleanup and a browser click-through.

## Phases at a Glance

| Phase                                  | What it delivers                                                           | Key risk                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1. Email delivery and Supabase config  | Custom magic-link template + config wired; Inbucket shows correct link     | Template placeholder typo silently breaks `verifyOtp` — caught by Phase 1's manual step |
| 2. Server-side auth flow               | `/api/auth/signin` (OTP) + `/auth/confirm` (verify); curl round-trip works | Cookies not persisting on redirect, or `?next` becoming an open-redirect vector         |
| 3. UI cleanup and single entry surface | Email-only `SignInForm`, renamed `check-email`, signup redirect, deletions | Stale references to deleted components/imports break the build                          |

**Prerequisites:** Local Supabase running (`npx supabase start`), Docker available, `.env`/`.dev.vars` populated from `.env.example`. No upstream roadmap dependencies (F-01 is itself a foundation).
**Estimated effort:** ~1–2 working sessions across the three phases — most of the time is in manual end-to-end verification, not code.

## Open Risks & Assumptions

- **Production-only blockers documented but not closed**: the remote Supabase project still needs the custom template uploaded via Dashboard and the Workers URL added to the redirect-URL allow-list before any prod sign-in works. Documented in plan § Migration Notes; the F-01 PR ships without flipping these switches.
- **Supabase default sender rate limit**: in production, F-01 uses Supabase's built-in sender (~3 emails/hour). Adequate for solo dev testing, not safe for external users. Real SMTP arrives with S-04.
- **Astro dev port assumed `4321`**: `astro.config.mjs` does not override the default. If a future change sets a custom port, `supabase/config.toml`'s `site_url` must move with it.

## Success Criteria (Summary)

- A user completes the full passwordless flow end-to-end (`/auth/signin` → email → link click → `/dashboard`) in local dev without ever seeing a password field
- Reusing or tampering with a magic link surfaces a clear error on `/auth/signin` instead of crashing or silently signing the user in
- A `grep` across `src/` for password-related identifiers (`signInWithPassword`, `signUp(`, `PasswordToggle`, `SignUpForm`, `MIN_PASSWORD_LENGTH`) returns zero hits
