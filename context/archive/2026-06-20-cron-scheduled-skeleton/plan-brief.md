# Cron `scheduled()` Worker Handler Skeleton (F-03) — Plan Brief

> Full plan: `context/changes/cron-scheduled-skeleton/plan.md`

## What & Why

Add a Cloudflare Worker `scheduled()` handler + cron trigger that will become the delivery mechanism for the watering (S-04) and winterization (S-05) reminder loops (PRD US-02, FR-018/019). This is a **foundation skeleton**: no reminder logic yet — just a durable, version-controlled cron entry point that a future `@astrojs/cloudflare` upgrade can't silently drop.

## Starting Point

The app deploys to Cloudflare Workers via `@astrojs/cloudflare` 13.7.0 but has no `scheduled()` handler and no cron trigger. The adapter emits a `fetch`-only worker and has no cron/`workerEntryPoint` support (verified by grepping its dist). `wrangler.jsonc main` points at the adapter's node_modules entrypoint.

## Desired End State

A committed `src/worker.ts` is the Worker's `main`; it re-exports the adapter `fetch` handler unchanged and adds a `scheduled()` heartbeat that delegates to a plain `src/lib/reminders/` function. `wrangler.jsonc` declares a daily cron; the build propagates it into the generated deploy config; two tests lock the wiring; and one live tick is observed in production Workers Logs.

## Key Decisions Made

| Decision                  | Choice                                              | Why (1 sentence)                                                                          | Source |
| ------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------ |
| Rebuild-safe injection    | Repoint `main` at committed `src/worker.ts` wrapper | Source built through `astro build`, not a post-build patch — kills the silent-drop risk.  | Plan (mechanics from Infra) |
| Skeleton behavior         | Log-only heartbeat                                  | F-03 is plumbing; S-04/S-05 own real reminder logic.                                       | Plan   |
| Testable seam             | `scheduled()` delegates to `src/lib` fn             | Vitest (Node env) can't import the worker entry's `cloudflare:workers`/Astro virtuals.     | Plan   |
| Cron cadence              | Daily `0 18 * * *` (20:00 CEST)                     | Adjusted from 08:00 UTC before shipping; S-04 can re-tune to match OQ-3 digest timing.    | Plan   |
| Smoke test                | Hermetic unit test + config-guard test              | Unit test covers the logic seam; config guard defends `main`/`triggers` against drift.     | Plan   |
| Error handling            | Catch, log, swallow (via `ctx.waitUntil`)           | A failed tick must not crash the Worker or trigger retry storms.                           | Plan   |

## Scope

**In scope:** custom worker entry; `scheduled()` heartbeat; `src/lib/reminders/` dispatch seam; `wrangler.jsonc` `main` + `triggers.crons`; hermetic unit test; config-guard test; local + prod tick verification.

**Out of scope:** reminder logic, DB reads, Supabase connectivity probe, email provider, external uptime monitor, any change to the `fetch` request path, CI gate on the live tick.

## Architecture / Approach

Wrap, don't patch. `src/worker.ts` imports the adapter's `{ fetch }` default, spreads it, and adds `scheduled()`. Repointing `wrangler.jsonc main` at this source makes Astro's auto entrypoint-resolution build it (resolving adapter virtuals through the import) into a worker with both handlers; `triggers.crons` in the same root config flows into the generated `dist/server/wrangler.json`. Testable logic lives in `src/lib/reminders/`, not the entry.

## Phases at a Glance

| Phase                              | What it delivers                                              | Key risk                                                              |
| ---------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| 1. Worker entry, cron wiring, tests | Committed entry + cron + dispatch fn + both tests (CI-green)  | Repointed `main` must still build the adapter virtuals through Vite. |
| 2. Production cron verification     | Deploy; confirm trigger registered + live heartbeat in logs  | Daily cadence → a live tick may take up to a day (force via dashboard). |

**Prerequisites:** none (parallel with F-01/F-02, both done). Phase 2 needs an authenticated `wrangler` + prod secrets set.
**Estimated effort:** ~1 session for Phase 1; Phase 2 is a short deploy-and-observe ops step.

## Open Risks & Assumptions

- Assumes Astro's auto entrypoint-resolution accepts an arbitrary source `main` (it already treats the current `main` as the worker-entry source) — confirmed by a successful `npm run build` in Phase 1.
- `@cloudflare/workers-types` resolve for the `scheduled` signature; fall back to ambient `ExportedHandler` typing if not.
- Daily cron means production verification can force a tick via the dashboard rather than waiting for 18:00 UTC.

## Success Criteria (Summary)

- `npm run build && npm run test:run && npm run lint` all green; generated `dist/server/wrangler.json` carries the cron.
- Local `wrangler dev --test-scheduled` + `/__scheduled` logs the heartbeat; normal page serving unaffected.
- A `scheduled.tick` heartbeat is observed once in production Workers Logs.
