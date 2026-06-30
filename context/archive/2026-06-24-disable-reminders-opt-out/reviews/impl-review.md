<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Disable Watering/Winterization Reminders (User Opt-Out)

- **Plan**: context/changes/disable-reminders-opt-out/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-06-24
- **Verdict**: REJECTED
- **Findings**: 1 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated verification run during review: `npx astro sync` ✅, `npm run lint` ✅ (9 pre-existing `no-console` warnings only), `npm run test:run` ✅ (220 passed), `npm run build` ✅. Manual Phase 3 items 3.8/3.9 (live email round-trip) remain unchecked/pending — acknowledged, not a failure.

## Findings

### F1 — checkOrigin disabled globally, but 6 mutation routes left unguarded

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: astro.config.mjs:20 + src/pages/api/plants/{index,[id],suggest,upload-url}.ts, src/pages/api/auth/{signin,signout}.ts
- **Detail**: Phase 3 set `security: { checkOrigin: false }` globally to let the RFC 8058 one-click unsubscribe POST through, compensating by adding `requireSameOrigin` to 7 routes (water, snooze, winterize, water-undo, winterize-undo, locations, locations/[id]). But `checkOrigin` was protecting EVERY mutating route. Enumerating handlers confirms these six POST/PATCH/DELETE routes mutate via cookie-session and never call `requireSameOrigin`, so they now have no CSRF guard at all: `plants/index.ts` (POST create), `plants/[id].ts` (PATCH+DELETE), `plants/suggest.ts` (POST — paid AI call), `plants/upload-url.ts` (POST — mints signed Storage URL), `auth/signin.ts` (POST — sends magic link), `auth/signout.ts` (POST — force logout). The JSON routes also don't assert `Content-Type: application/json`, so a cross-site `fetch` with a `text/plain` "simple request" body reaches them with the session cookie attached and no CORS preflight; `request.json()` parses it anyway. Root cause is partly a plan flaw: Phase 3 #9 enumerated only water/snooze/winterize/undo/locations as routes "relying on the global guard," and the implementation followed that list literally. `unsubscribe.ts` (token-authed) and `preferences.ts` (guarded) are correct.
- **Fix**: Add `const originErr = requireSameOrigin(context.request); if (originErr) return originErr;` at the top of each of the 6 handlers (before `requireUser`), mirroring `src/pages/api/plants/water.ts:8-9`. Optionally assert `application/json` on the JSON routes as defense-in-depth.
  - Strength: Reuses the proven `requireSameOrigin` helper from the 7 patched routes; closes the regression with no new abstraction.
  - Tradeoff: Six files touched; auth routes redirect on error while the helper returns a JSON 403 — a forged auth POST gets a 403 body rather than a redirect (acceptable for an attack, minor shape inconsistency).
  - Confidence: HIGH — directly confirmed the missing guards via grep and compared water.ts vs signin.ts; helper logic is sound.
  - Blind spot: `requireSameOrigin` fails open when `Origin` is absent (see F3) — browsers always send it cross-site, so fine for browser CSRF, but not absolute.
- **Decision**: FIXED — added `requireSameOrigin` to all 6 unguarded handlers (plants/{index,[id] PATCH+DELETE,suggest,upload-url}, auth/{signin,signout}); lint clean, 220 tests pass. All 14 session-mutation routes now guarded; unsubscribe remains token-only.

### F2 — Unplanned Settings nav link in dashboard.astro

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/dashboard.astro:32-37
- **Detail**: Phase 4 named only Topbar.astro as the `/settings` entry point. The implementation also added a Settings link to the dashboard header. It directly serves the plan's goal ("make /settings reachable for signed-in users") and is harmless — benign scope addition, not drift.
- **Fix**: Keep it; no action needed. (Noted for scope-discipline completeness.)
- **Decision**: SKIPPED — kept; serves the plan's goal of making /settings reachable.

### F3 — requireSameOrigin fails open when Origin header is absent

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/api.ts:51-64
- **Detail**: `requireSameOrigin` returns null (allows) when `Origin` is missing. This is deliberate and correct — it lets the no-Origin one-click unsubscribe POST and non-browser callers through, and real browsers always send Origin on cross-site requests. Recorded so a future reader doesn't assume missing-Origin is rejected. No change required.
- **Fix**: None — document the intent in the helper comment if desired (already partially documented).
- **Decision**: ACCEPTED-AS-RULE — captured in context/foundation/lessons.md ("CSRF guards on session-mutation routes after disabling global checkOrigin"). No code change (behavior correct by design).

## Confirmed sound (no action)

HMAC token is constant-time (`crypto.subtle.verify`) and never trusts `u` without a valid `t`; the unsubscribe service-role upsert can only flip the token-identified user's own row (writes only `{user_id, reminders_enabled:false}` on conflict `user_id`); the migration enables RLS before grants with anon excluded; the cron preferences query fails closed (`return` on error before any send); all user-derived email/HTML fields are escaped; the confirmation page reflects no input. All 14 planned changes match their contracts; the `src/lib/api.ts` helper centralization and shadcn `switch.tsx` are justified.
