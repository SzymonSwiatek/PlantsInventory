<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Magic-link Authentication

- **Plan**: context/changes/magic-link-auth/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-06-02
- **Verdict**: APPROVED
- **Findings**: 0 critical 1 warning 1 observation

Evidence: `npm run lint` ✓, `npm run build` ✓, `npx astro sync` ✓, `npx tsc --noEmit` 0 errors. Grep gates all clean (no `signInWithPassword` / `signUp(` / `PasswordToggle` / `SignUpForm` / `MIN_PASSWORD_LENGTH` / `password` in the auth surface). Deletions (`SignUpForm.tsx`, `PasswordToggle.tsx`, `api/auth/signup.ts`) and the `confirm-email.astro` → `check-email.astro` rename confirmed. All 13 changed files map to the plan — no unplanned source changes. The two type annotations that looked risky (`React.SubmitEvent<T>`, `EmailOtpType` via `?? "email"`) are both genuinely type-valid (`SubmitEvent` exists in @types/react v19; `EmailOtpType` includes a `(string & {})` member) — not findings.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — safeNext() open-redirect filter misses the backslash bypass

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/auth/confirm.ts:13
- **Detail**: The sanitizer rejects on `!startsWith("/")`, `startsWith("//")`, and `includes(":")` but not backslashes. `next = "/\evil.com"` passes all three checks (starts with `/`, second char is `\` not `/`, no colon) and is passed to `context.redirect()` verbatim, emitting `Location: /\evil.com`. Per WHATWG URL parsing for http(s), browsers normalize `\` → `/`, resolving to `//evil.com` → `https://evil.com` — a documented open-redirect bypass class (also covers the `%5C`-encoded form since `searchParams.get()` pre-decodes). The plan's "Critical Implementation Details" explicitly required this filter to reject untrusted targets or it "becomes an open redirector"; manual check 2.10 only exercised the `//` case, not `/\`. Practical exploitability today is LOW: the redirect fires only after a successful `verifyOtp` (valid, single-use, emailed token) and the email template hard-codes `next=/dashboard` (signin.ts never reads `next`), so no working malicious link can be crafted for a victim right now. Matters as defense-in-depth and because the plan earmarks S-04 to begin passing real `next` values for deep-link reminders.
- **Fix**: Add a backslash rejection to the guard, e.g. append `|| next.includes("\\")` to the `safeNext()` condition (covers `/\`, `\/`, and `%5C`-decoded variants in one check).
- **Decision**: FIXED (Fix now) — appended `|| next.includes("\\")` to the guard at confirm.ts:13.

### F2 — signup.astro redirect deviates from the planned idiom

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/auth/signup.astro:2
- **Detail**: Phase 3 §4's contract specified `return Astro.redirect("/auth/signin", 308)`. The implementation instead hand-sets `Astro.response.status = 308` + a `Location` header in frontmatter and renders an empty body. Functionally equivalent and manual check 3.11 verified the 308 works, but `Astro.redirect()` is the idiomatic API (no stray rendered body, matches how the rest of the app does server redirects) and is what the plan called for. Cosmetic — no behavioral defect.
- **Fix**: Replace the two response lines with `return Astro.redirect("/auth/signin", 308);`.
- **Decision**: SKIPPED — cosmetic; current code works and was verified by manual check 3.11.
