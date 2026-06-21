<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Watering Reminder Loop

- **Plan**: context/changes/watering-reminder-loop/plan.md
- **Mode**: Deep
- **Date**: 2026-06-21
- **Verdict**: REVISE → SOUND (all 4 findings fixed in plan, 2026-06-21)
- **Findings**: 1 critical · 2 warnings · 1 observation (all FIXED)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

9/9 paths ✓, schema columns/index/triggers ✓, symbols (runScheduledTick, requireUser, createClient, astro:env readers) ✓, brief↔plan ✓. Progress↔Phase: 5/5 phases mapped, every success-criterion bullet tracked ✓.

## Findings

### F1 — astro:env/server likely unavailable in scheduled(); fallback not threaded through Phase 2/3 contracts

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details + Phase 2 (§2 service-client, §3 email) + Phase 3 (§1 runScheduledTick)
- **Detail**: The entire digest loop depends on reading `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY` from `astro:env/server` in a non-request context. Every existing reader of astro:env runs during a fetch request, where `@astrojs/cloudflare` populates env via AsyncLocalStorage in its fetch entrypoint (`src/pages/api/plants/suggest.ts:2`, `src/lib/supabase.ts:3`, `src/lib/config-status.ts:1`). But `src/worker.ts:20` adds `scheduled()` alongside `...handler` and does NOT pass through the adapter's fetch wrapper, so that ALS context is never established. Strong likelihood astro:env reads return undefined in `scheduled()` → `createServiceClient()` → null → the cron silently no-ops forever; no email ever sends; Success Criterion #3 fails. It fails INVISIBLY: every automated test mocks astro:env (`vi.mock("astro:env/server", …)`, suggest.fault.test.ts:16), so all Phase 2/3 tests pass green while the deployed cron is dead — surfacing only at manual cron test (3.6). The plan names a fallback (use the `env` arg) but doesn't design it in: `createServiceClient()`, `sendDigest()`, and `runScheduledTick(now)` all carry no `env` parameter, so adopting it means refactoring all three signatures + the worker.ts call after the contracts are built.
- **Fix A ⭐ Recommended**: Design for the env argument from the start — thread the Worker env from `scheduled(controller, env, ctx)` → `runScheduledTick(now, env)` → `createServiceClient(env)` / `sendDigest(…, env)`, reading secrets from that bag instead of astro:env. worker.ts already has the typed-interface scaffolding (lines 8–16) and an `_env: unknown` slot to tighten.
  - Strength: Removes the request-context ALS dependency entirely; env arg is guaranteed present in the scheduled signature.
  - Tradeoff: Slightly less consistent with the request-path astro:env pattern; needs a small typed env interface in worker.ts.
  - Confidence: HIGH — Cloudflare always passes env to scheduled().
  - Blind spot: Local unit tests must construct a fake env bag instead of mocking astro:env — minor test-harness change.
- **Fix B**: Spike astro:env-in-scheduled() as a Phase 0 — a throwaway tick logging whether the keys resolve under `wrangler dev` cron trigger AND a deployed trigger; keep current contracts only if both pass.
  - Strength: Keeps contracts consistent with the request path if it works.
  - Tradeoff: wrangler-dev behavior may differ from deployed; if it fails you refactor everything anyway — late.
  - Confidence: MED — local/deployed parity for ALS env is unverified.
  - Blind spot: Sandbox/preview may resolve env differently than production.
- **Decision**: FIXED (Fix A — env threaded through scheduled → runScheduledTick → service-client/sendDigest; ReminderEnv interface; worker.ts _env tightened)

### F2 — Email-lookup mechanism for due users is underspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §1 step (c)
- **Detail**: "Fetch emails for the distinct user_ids via auth.admin / a users read (service-role)" glosses a real constraint. `auth.users` is NOT exposed over PostgREST by default (the `auth` schema isn't in the API), so a `.from("users")` read won't work. `auth.admin.listUsers()` lists ALL users paginated — not a lookup by id. The actual path is `supabase.auth.admin.getUserById(id)` per distinct user (N small calls), fine at this scale but a different shape than "a users read."
- **Fix**: Specify `auth.admin.getUserById(userId)` per distinct due-user (acceptable per the Performance section), or an explicit service-role RPC/SQL against `auth.users`. Pin the choice so the implementer doesn't reach for a non-working `.from("users")`.
- **Decision**: FIXED (pinned step (c) to `auth.admin.getUserById(userId)` per distinct user; documented the `.from("users")` / `listUsers()` traps)

### F3 — /today link in the email is an unresolved TBD (no site-URL env)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §3 (email module Contract)
- **Detail**: "prefer a PUBLIC_SITE_URL-style constant if one exists, else hardcode the deployed origin with a TODO." No such constant exists (astro.config.mjs has no `site` and no PUBLIC_SITE_URL env). A hardcoded origin + TODO would ship in a user-facing email. Also note `.env.example` currently lists only the 3 existing keys; the 3 new Phase 2 secrets belong there too.
- **Fix**: Add a `PUBLIC_SITE_URL` env field in astro.config.mjs env.schema (`context: "server", access: "public"` — non-secret) and use it in composeDigest; add it plus the 3 new secrets to `.env.example`.
- **Decision**: FIXED (declared PUBLIC_SITE_URL in env.schema §1; composeDigest takes siteUrl with a relative fallback; all 4 new keys added to .env.example)

### F4 — Service-role import boundary is convention-only

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Critical Implementation Details + Phase 2 §2
- **Detail**: The plan twice states the service-role client "must never be reachable from a request path" but provides no enforcement — discipline only. A single stray import would silently route an RLS-bypassing, auth.users-reading client into a request handler. This is the highest-severity security boundary in the slice.
- **Fix**: Add an eslint `no-restricted-imports` (or `import/no-restricted-paths`) rule forbidding `@/lib/reminders/service-client` outside `src/lib/reminders/**`. Cheap, permanent insurance for a key that bypasses RLS.
- **Decision**: FIXED (Phase 2 §2 now mandates an `import/no-restricted-paths` zone + a lint-probe success criterion 2.4)

## Notes (verified clean — no findings)

- Due-date trigger logic is internally consistent: snooze is correctly excluded as a trigger input, so snooze preserves the due date; mark-watered changes last_watered_at so the trigger recomputes.
- Undo-clears-snooze is a non-issue: snoozed plants are filtered out of /today, so mark-watered only ever clears an already-NULL snooze.
- Progress section is well-formed and complete (all 5 phases + every success-criterion bullet mapped).
- Idempotency-by-query + noRetry() double-send risk is explicitly accepted.
