<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Disable Watering/Winterization Reminders (User Opt-Out)

- **Plan**: context/changes/disable-reminders-opt-out/plan.md
- **Mode**: Deep
- **Date**: 2026-06-24
- **Verdict**: REVISE
- **Findings**: 1 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

14/14 paths ✓, symbols ✓ (PROTECTED_ROUTES, set_updated_at, winterization_due_plants, crons, env schema), brief↔plan ✓.

Verified sound and not in dispute:
- `worker.ts` passes the raw Worker `env` straight into `runScheduledTick`, so adding `REMINDER_UNSUBSCRIBE_SECRET` to the `ReminderEnv` type suffices for the cron; the route reads it via `astro:env/server`.
- Fail-closed filter placement matches existing `return`-on-error at `scheduled.ts:30,39`; `continue`-before-`getUserById` (line 77) genuinely saves the admin call.
- RLS: four per-op policies + grants to `authenticated, service_role`, reusing `set_updated_at()` — matches `20260608171954_core_domain_schema.sql`.
- Test files (`email.test.ts`, `scheduled.test.ts`, `scheduled.fault.test.ts`) exist; planned cases extend them.

## Findings

### F1 — Astro CSRF origin check may silently block the RFC 8058 one-click POST

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Unsubscribe route (POST one-click)
- **Detail**: The headline feature is a no-login one-click unsubscribe: a mail provider POSTs with `Content-Type: application/x-www-form-urlencoded`, body `List-Unsubscribe=One-Click`, and no matching `Origin` header (request originates from Gmail/Yahoo servers, not a browser on your origin). Astro's `security.checkOrigin` defaults to `true` for on-demand routes (`output: "server"`, no `security` block in astro.config.mjs), and rejects exactly this shape (mutating method + form content-type + missing/foreign Origin) with a 403 before the handler runs. If it applies to this endpoint, the one-click path never executes, breaking the stated success criterion. The trap is invisibility: the human GET footer link still works, same-origin local tests pass, and existing same-origin POST routes are unaffected — only the real-world one-click POST fails. `checkOrigin` is global with no per-route override, so the mitigation is not a one-liner.
- **Fix A ⭐ Recommended**: Verify-first, then targeted mitigation. Add an early Phase 3 step: `curl -X POST` the route with a form content-type and no Origin header against `npm run dev`. If it 403s, set `security: { checkOrigin: false }` in astro.config.mjs AND add an explicit same-origin check to the existing session-mutation routes (water, snooze, winterize, locations, preferences) that relied on it; the unsubscribe and preferences routes do their own auth (token / RLS).
  - Strength: Keeps one-click working; closes the CSRF gap deliberately per-route instead of trusting a global default the feature inherently violates.
  - Tradeoff: Must re-add an origin assertion to ~5 existing routes.
  - Confidence: MED — checkOrigin default-true is certain; whether it fires on `src/pages/api/*` endpoints (vs only pages) in Astro 6.3 needs the curl to confirm.
  - Blind spot: Exact Astro 6.3 endpoint behavior unverified — the curl step settles it before any code.
- **Fix B**: Keep global checkOrigin; ship only the GET footer link and drop the `List-Unsubscribe-Post` one-click header.
  - Strength: Zero CSRF surface change; simplest.
  - Tradeoff: Abandons RFC 8058 one-click — Gmail/Yahoo increasingly require working one-click for bulk senders, weakening the deliverability rationale that motivated the change.
  - Confidence: HIGH — strictly removes the at-risk path.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — added Critical Implementation Detail on `checkOrigin`, a verify-first Phase 3 step (#5) with conditional global `checkOrigin:false` + per-route origin checks, success criterion, and Progress step 3.3.

### F2 — Progress Phase 1 heading doesn't match the body heading

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 heading (plan.md:60) vs Progress (plan.md:343)
- **Detail**: Body uses ``## Phase 1: Data Model — `user_preferences` table`` (backticks); Progress uses `### Phase 1: Data Model — user_preferences table` (no backticks). Phases 2–4 match exactly; only Phase 1 differs. A strict Progress↔Phase parser in /10x-implement keys on heading text, so this cosmetic mismatch could cause a parse miss. Per-phase bullet counts all reconcile (1.1–1.6, 2.1–2.5, 3.1–3.8, 4.1–4.8).
- **Fix**: Strip the backticks from the body Phase 1 heading (or add them to the Progress heading) so the two match character-for-character.
- **Decision**: FIXED — stripped backticks from the body Phase 1 heading (plan.md:60).

### F3 — Unsubscribe token never expires; same URL ships in every email

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details — Token scheme
- **Detail**: `token = HMAC-SHA256(user_id, secret)` has no expiry or nonce, and the identical URL appears in every digest. A forwarded or leaked email lets any holder permanently disable that user's reminders. Harm is low (only disables reminders, reversible via login) and the statelessness is a deliberate, reasonable choice — flagging only so it's an accepted risk, not an oversight, given CLAUDE.md's untrusted-input posture.
- **Fix**: Accept as-is (document the tradeoff in Migration Notes), or — if later desired — bind the token to a coarse time window by including a rotating period in the HMAC message. Not needed for MVP.
- **Decision**: ACCEPTED — stateless token kept as the deliberate design; low, reversible harm. No plan change.
