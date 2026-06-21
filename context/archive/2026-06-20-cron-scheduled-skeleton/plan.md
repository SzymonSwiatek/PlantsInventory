# Cron `scheduled()` Worker Handler Skeleton (F-03) Implementation Plan

## Overview

Add a version-controlled custom Cloudflare Worker entry that re-exports the `@astrojs/cloudflare` `fetch` handler and adds a `scheduled()` handler, wire a daily cron trigger in `wrangler.jsonc`, and lock the whole thing down with tests so a future adapter upgrade can't silently drop the cron. This is a **foundation skeleton** (roadmap F-03): the `scheduled()` handler only emits a structured heartbeat log for now — the actual watering (S-04) and winterization (S-05) reminder logic slots into the dispatch seam created here.

## Current State Analysis

The app deploys to Cloudflare Workers via `@astrojs/cloudflare` 13.7.0 with `output: "server"`. There is **no `scheduled()` handler and no cron trigger** today.

Verified build mechanics (the crux of this slice's risk):

- Root `wrangler.jsonc` currently sets `main: "@astrojs/cloudflare/entrypoints/server"`. That node_modules module exports only `{ fetch: handle }` (`node_modules/@astrojs/cloudflare/dist/entrypoints/server.js`).
- `astro build` reads root `wrangler.jsonc`, builds the `main` module into `dist/server/entry.mjs` (default export = the worker object, via `dist/server/chunks/worker-entry_*.mjs`), and **generates `dist/server/wrangler.json`** — the effective deploy config — with `main` rewritten to `entry.mjs` and a `triggers: {}` block carried over from the root config.
- The adapter has **no cron/scheduled/`workerEntryPoint` support** — confirmed by grepping `node_modules/@astrojs/cloudflare/dist/` for `scheduled|triggers|cron|workerEntryPoint` (no hits). The generated worker is `fetch`-only.
- Astro core's auto entrypoint-resolution (`entrypointResolution: "auto"` in the adapter's `setAdapter` call, `dist/index.js:300`) treats whatever `main` points at as the worker-entry **source** and builds it through Vite (resolving the adapter's virtual modules: `virtual:astro-cloudflare:config`, `astro/app/entrypoint`).

This means the rebuild-safe fix is to repoint `main` at a **committed source file** that wraps the adapter handler — not to patch generated output.

### Key Discoveries:

- Adapter `fetch`-only default export: `node_modules/@astrojs/cloudflare/dist/entrypoints/server.js` exports `{ fetch: handle }`. A custom entry spreads this and adds `scheduled`.
- Generated deploy config: `dist/server/wrangler.json` shows `"triggers":{}` and `"main":"entry.mjs"`. The `{}` is wrangler's normalization default (the root `wrangler.jsonc` has no `triggers` block at all), not proof of inheritance. Propagation of `triggers.crons` is inferred from wrangler re-serializing the full normalized config (assets, kv_namespaces, etc. all preserved). If the §6 post-build check shows the cron did not propagate, fall back to patching `dist/server/wrangler.json` as a post-build script step before `wrangler deploy`.
- **Vitest cannot import the worker entry.** Vitest runs in the Node environment (`vitest.config.ts:11`); the worker entry transitively imports `cloudflare:workers` and Astro build virtuals that only resolve inside the Vite/workerd build. The unit-testable seam must therefore be a plain function in `src/lib/`, invoked by `scheduled()` — not the worker entry itself.
- Existing test conventions: unit tests live beside source (`src/lib/storage.test.ts`), Node env, TZ pinned to UTC (`vitest.setup.ts`), `@` alias mirrored in `vitest.config.ts`.
- `src/lib/` already groups helpers by area (`src/lib/ai/`, `src/lib/storage.ts`); the heartbeat dispatch fn belongs in a new `src/lib/reminders/` directory that S-04/S-05 will grow into.
- Observability floor is Workers Logs only (`observability.enabled: true` in `wrangler.jsonc`); a structured `console.log` is the v1-correct way to make a tick observable.
- Local cron testing is `npx wrangler dev --test-scheduled` then a request to `http://localhost:8787/__scheduled` (per `infrastructure.md` §Getting Started step 5).

## Desired End State

After this plan:

- `src/worker.ts` is committed and is the Worker's `main`; it re-exports the adapter `fetch` handler unchanged and adds a `scheduled()` handler.
- `scheduled()` delegates to a `runScheduledTick()` function in `src/lib/reminders/`, wraps it in try/catch, logs structurally, and never throws.
- `wrangler.jsonc` declares `triggers.crons: ["0 18 * * *"]` and `main: "src/worker.ts"`.
- `npm run build` succeeds and the generated `dist/server/wrangler.json` contains the daily cron under `triggers.crons` and a non-node_modules `main`.
- A hermetic Vitest unit test exercises `runScheduledTick()` and asserts it logs a heartbeat; a config-guard test asserts `wrangler.jsonc` keeps `main` pointing at the custom entry and a non-empty `triggers.crons`.
- A live cron tick is observed once in production (Workers Logs) and locally via `--test-scheduled`.

Verify: `npm run build && npm run test:run && npm run lint` all green; `dist/server/wrangler.json` shows the cron; `wrangler dev --test-scheduled` + `curl /__scheduled` logs the heartbeat.

## What We're NOT Doing

- **No reminder logic.** No DB reads, no "what needs care today" query, no email send. Those are S-04 (watering) and S-05 (winterization). `runScheduledTick()` only logs for now.
- **No Supabase connectivity probe** in the cron context (considered and declined — keeps this slice pure plumbing; S-04 introduces the DB read).
- **No email provider wiring** (PRD Open Question #1 — deferred to S-04).
- **No external uptime/cron monitor** (overkill for a skeleton per `main_goal=speed`).
- **No change to the `fetch` request path** — the adapter handler is re-exported untouched.
- **No CI gate on the live tick** — production verification is manual/ops (Phase 2).

## Implementation Approach

Wrap, don't patch. Create a thin committed worker entry that imports the adapter's `{ fetch }` default, spreads it, and adds `scheduled()`. Repoint `wrangler.jsonc main` at this source file so Astro's auto entrypoint-resolution builds it (resolving the adapter virtuals through the import) and emits a worker that has both handlers. Add `triggers.crons` to the same root config so it flows into the generated deploy config. Keep the testable logic out of the worker entry — `scheduled()` is a one-line delegation to a plain `src/lib/reminders/` function that Vitest can import in the Node environment. Defend the config against adapter-drift with a guard test.

## Critical Implementation Details

- **Test boundary is non-negotiable.** Do not import `src/worker.ts` (or anything that pulls `cloudflare:workers` / Astro build virtuals) from a Vitest spec — it will fail to resolve under the Node test environment. The unit test targets `runScheduledTick()` in `src/lib/reminders/` only. The worker entry's `scheduled()` must stay thin enough that nothing worth unit-testing lives in it.
- **`main` must point at source, not generated output.** Pointing `wrangler.jsonc main` at a `dist/` file or applying a post-build patch reintroduces exactly the silent-drop risk this slice exists to remove. The custom entry is committed source built through `astro build`.
- **Verify the generated config, not just the source.** The meaningful assertion is that `dist/server/wrangler.json` (the effective deploy config) contains `triggers.crons` after a build — the config-guard test asserts the source `wrangler.jsonc`, and a Phase 1 manual/automated check confirms the generated config inherited it.

## Phase 1: Worker entry, cron wiring & tests

### Overview

Create the custom worker entry and the dispatch seam, repoint `main`, declare the cron, and add both tests. Everything in this phase is verifiable locally and in CI.

### Changes Required:

#### 1. Heartbeat dispatch function

**File**: `src/lib/reminders/scheduled.ts` (new)

**Intent**: The unit-testable seam. A plain async function `runScheduledTick(now)` that emits one structured heartbeat log and returns. S-04/S-05 will expand this into the real reminder dispatch; for now it is log-only. Kept free of any `cloudflare:workers`/Astro-virtual import so Vitest (Node env) can import it.

**Contract**: `export async function runScheduledTick(now: Date): Promise<void>`. Emits a single structured `console.log` (e.g. an object with `event: "scheduled.tick"`, ISO timestamp, and a marker the test can assert on). Takes `now` as a parameter (not `new Date()` internally) so the test is deterministic under the UTC-pinned clock.

#### 2. Custom Worker entry

**File**: `src/worker.ts` (new)

**Intent**: The version-controlled worker entry that survives adapter rebuilds. Re-exports the adapter's `fetch` handler unchanged and adds a `scheduled()` handler that delegates to `runScheduledTick()`, catching and logging any error so the handler never throws.

**Contract**: Default export spreads the adapter handler and adds `scheduled`:

```ts
import handler from "@astrojs/cloudflare/entrypoints/server";

export default {
  ...handler,
  async scheduled(_controller, _env, ctx) {
    ctx.waitUntil(
      runScheduledTick(new Date()).catch((err) => {
        console.error({ event: "scheduled.error", err: String(err) });
      }),
    );
  },
};
```

Use `ctx.waitUntil(...)` so the async tick is awaited by the runtime; the `.catch` guarantees swallow-and-log. Cloudflare `scheduled` signature: `(controller: ScheduledController, env, ctx: ExecutionContext)`. Prefix unused params with `_` per the lint convention. `@cloudflare/workers-types` are already available transitively via `wrangler`; if the types don't resolve, import the controller/context types or fall back to the ambient `ExportedHandler` typing.

#### 3. Repoint `main` and declare the cron

**File**: `wrangler.jsonc`

**Intent**: Make the committed entry the Worker source and declare the daily cron. Both changes live in version-controlled source so they propagate into the generated `dist/server/wrangler.json`.

**Contract**: Change `main` from `"@astrojs/cloudflare/entrypoints/server"` to `"src/worker.ts"`. Add a top-level `"triggers": { "crons": ["0 18 * * *"] }` block (daily at 18:00 UTC / 20:00 CEST — adjusted from the original 08:00 UTC before shipping).

#### 4. Hermetic unit test

**File**: `src/lib/reminders/scheduled.test.ts` (new)

**Intent**: Assert the dispatch fn runs and emits its heartbeat. Hermetic, Node-env, follows `src/lib/storage.test.ts` conventions.

**Contract**: Spy on `console.log`, call `runScheduledTick(new Date(...))`, assert the heartbeat log was emitted with the expected `event` marker. No import of `src/worker.ts`.

#### 5. Config-guard test

**File**: `src/worker.config.test.ts` (new, or co-located under `src/lib/reminders/`)

**Intent**: Guard against a human accidentally reverting `wrangler.jsonc` — fails loudly if `main` stops pointing at the custom entry or the cron declaration disappears from the source. This does NOT cover adapter-drift (an adapter upgrade wouldn't touch the source; it would change how the source is processed into the generated config — that risk is covered by §6).

**Contract**: Read and parse `wrangler.jsonc` using `jsonc-parser` (`parse(readFileSync('wrangler.jsonc', 'utf8'))` — handles both `//` comments and trailing commas; `jsonc-parser` is a devDep to install with `npm install -D jsonc-parser`; do not use a regex comment strip, it breaks on trailing commas). Assert `config.main === "src/worker.ts"` and `Array.isArray(config.triggers?.crons) && config.triggers.crons.length > 0`.

#### 6. Post-build generated-config assertion

**File**: CI deploy job (add a script step after `npm run build`) or a standalone `scripts/check-dist-config.mjs` called from the deploy job

**Intent**: Catch the actual adapter-drop risk — if a future adapter upgrade stops propagating `triggers.crons` into `dist/server/wrangler.json`, deployment proceeds without a cron. This check runs post-build and fails the deploy gate before `wrangler deploy` is reached.

**Contract**: After `npm run build`, read `dist/server/wrangler.json` and assert `Array.isArray(config.triggers?.crons) && config.triggers.crons.length > 0`. A shell one-liner (`node -e "const c=JSON.parse(require('fs').readFileSync('dist/server/wrangler.json','utf8')); if(!c.triggers?.crons?.length) process.exit(1)"`) or a dedicated `scripts/check-dist-config.mjs` both work.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Generated deploy config carries the cron: `dist/server/wrangler.json` contains a non-empty `triggers.crons` after build
- Unit + config-guard tests pass: `npm run test:run`
- Type checking / lint passes: `npm run lint`

#### Manual Verification:

- `npx wrangler dev --test-scheduled` then `curl http://localhost:8787/__scheduled` logs the structured heartbeat
- The `fetch` request path still works locally (`npm run dev`, load a page) — re-exporting the adapter handler didn't regress normal serving

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the local `--test-scheduled` heartbeat and normal page serving both work before proceeding to Phase 2.

---

## Phase 2: Production cron verification

### Overview

Deploy and confirm the cron trigger registered and fires in production. This phase is manual/ops — it depends on an authenticated `wrangler` and production secrets already set, and the daily cadence means a live tick may take up to a day (or can be forced via the dashboard).

### Changes Required:

#### 1. Deploy and verify the trigger

**File**: none (operational)

**Intent**: Confirm the generated config's cron trigger was accepted by Cloudflare and the handler runs.

**Contract**: Deploy via the existing path (`npm run build && npx wrangler deploy`, or merge-to-`main` CI auto-deploy). Confirm the cron is registered (Cloudflare dashboard → Worker → Triggers, or `wrangler deployments`/Cron Triggers view) and observe the `scheduled.tick` heartbeat in Workers Logs (`npx wrangler tail` or the dashboard) after a tick.

### Success Criteria:

#### Automated Verification:

- Deploy completes without error (CI deploy job green, or `wrangler deploy` exits 0)

#### Manual Verification:

- The daily cron trigger is listed for the Worker in the Cloudflare dashboard / Cron Triggers view
- A `scheduled.tick` heartbeat appears in Workers Logs after a tick fires (force one via the dashboard if not waiting for 08:00 UTC)

**Implementation Note**: Production deploy and the first prod publish are human-approved per `infrastructure.md` §Operational Story. Pause for manual confirmation that the live cron fired before closing the slice.

---

## Testing Strategy

### Unit Tests:

- `runScheduledTick()` emits the heartbeat log (deterministic `now` under UTC-pinned clock).

### Integration Tests:

- None warranted for a log-only skeleton. Two separate guards cover two separate risks: the config-guard test (§5, asserting `wrangler.jsonc` source keeps `main` + `triggers.crons`) guards against a human reverting the source; the post-build generated-config assertion (§6, asserting `dist/server/wrangler.json` has `triggers.crons` after build) is the actual regression net for the adapter-drop risk.

### Manual Testing Steps:

1. `npx wrangler dev --test-scheduled`, then `curl http://localhost:8787/__scheduled` — confirm the heartbeat logs.
2. `npm run dev` and load a page — confirm normal `fetch` serving is unaffected.
3. After deploy, confirm the cron trigger is registered and a tick appears in Workers Logs.

## Performance Considerations

Negligible. The `scheduled()` handler logs and returns; well within the 10 ms free-tier CPU limit. The `fetch` path is untouched.

## Migration Notes

The only deploy-config change is repointing `main` and adding `triggers.crons`. `wrangler rollback` reverts code only — but since this slice adds no DB migration, rollback is clean. After deploy, the cron exists indefinitely; removing it later means deleting the `triggers` block and redeploying.

## References

- Roadmap F-03: `context/foundation/roadmap.md` (Foundations §F-03)
- Risk Register (adapter-drop risk) + Getting Started step 5: `context/foundation/infrastructure.md`
- Adapter `fetch`-only export: `node_modules/@astrojs/cloudflare/dist/entrypoints/server.js`
- Generated deploy config shape: `dist/server/wrangler.json`
- Test conventions: `src/lib/storage.test.ts`, `vitest.config.ts`, `vitest.setup.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Worker entry, cron wiring & tests

#### Automated

- [x] 1.1 Build succeeds: `npm run build` — 2b5c205
- [x] 1.2 Generated `dist/server/wrangler.json` contains a non-empty `triggers.crons` after build — 2b5c205
- [x] 1.3 Unit + config-guard tests pass: `npm run test:run` — 2b5c205
- [x] 1.4 Type checking / lint passes: `npm run lint` — 2b5c205

#### Manual

- [x] 1.5 `wrangler dev --test-scheduled` + `curl /__scheduled` logs the structured heartbeat — 2b5c205
- [x] 1.6 Normal `fetch` page serving still works (`npm run dev`) — 2b5c205

### Phase 2: Production cron verification

#### Automated

- [x] 2.1 Deploy completes without error (CI deploy green or `wrangler deploy` exits 0) — d32fe09

#### Manual

- [x] 2.2 Daily cron trigger listed for the Worker in the Cloudflare dashboard / Cron Triggers view — d32fe09
- [x] 2.3 A `scheduled.tick` heartbeat appears in Workers Logs after a tick fires — d32fe09
