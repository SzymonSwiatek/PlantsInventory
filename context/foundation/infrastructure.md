---
project: 10xPlantsInventory
researched_at: 2026-05-21
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript / JavaScript
  framework: Astro 6 (SSR) + React 19 islands
  runtime: Cloudflare workerd
---

## Recommendation

**Deploy on Cloudflare Workers.**

The project is already wired for it — `@astrojs/cloudflare` 13.5.0, a `workerd` dev runtime, and a `wrangler.jsonc` in the Workers-with-static-assets shape — so the migration cost is zero, where every other candidate needs an Astro adapter swap. Cloudflare scored a clean 10/10 against the five agent-friendly criteria, ties with Vercel on the raw matrix, and pulls ahead on two stack-specific facts: its Cron Triggers (which drive the watering/winterization reminders, FR-018/019) run on the **free tier with a 1-minute floor**, while Vercel's free-tier cron is daily-only. At this MVP's scale — small user base, low QPS — Cloudflare's free tier (100k requests/day) means a **$0 hosting bill**.

## Platform Comparison

| Platform               | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total     |
| ---------------------- | --------- | ------------------ | ------------------- | ----------------- | ----------------- | --------- |
| **Cloudflare Workers** | Pass      | Pass               | Pass                | Pass              | Pass              | **10/10** |
| **Vercel**             | Pass      | Pass               | Pass                | Pass              | Pass (beta)       | **10/10** |
| **Railway**            | Pass      | Pass               | Pass                | Pass              | Partial           | **9/10**  |
| **Render**             | Partial   | Pass               | Pass                | Pass              | Pass              | **9/10**  |
| **Netlify**            | Partial   | Pass               | Partial             | Pass              | Pass              | **8/10**  |
| **Fly.io**             | Pass      | Partial            | Partial             | Pass              | Partial           | **7/10**  |

**Cloudflare Workers** — `wrangler` covers the full operational loop (`deploy`, `rollback`, `tail`, `deployments list`); pure serverless with auto TLS/routing/scaling; docs published as markdown with `llms.txt`/`llms-full.txt` ("Markdown for Agents", GA Feb 2026); deterministic `wrangler deploy`; 16+ MCP servers including Workers Bindings and Observability (GA). All five criteria Pass. Hard filters: none triggered (no persistent connections required; the stack runs natively on `workerd`).

**Vercel** — `vercel` CLI covers deploy/rollback/logs; Node serverless functions; excellent agent docs (`llms.txt`, `.md` endpoints); deterministic `vercel --prod`; Vercel MCP is in **public beta** (status checked 2026-05-21). Criteria-equal with Cloudflare, but deploying here means swapping to `@astrojs/vercel`, and the free Hobby tier caps cron at **once per day** and is restricted to **non-commercial personal use** (this hobby MVP qualifies; any monetization forces the $20/mo Pro plan).

**Railway** — `railway` CLI is a complete loop including `railway redeploy` for rollback; Railpack auto-builds Node apps with no Dockerfile; `llms.txt` docs; deterministic `railway up`; the `@railway/mcp-server` is officially "a work in progress" (pre-GA) → Partial on MCP. Needs an `@astrojs/node` swap and runs ~$5/mo (no permanent free tier); supports scale-to-zero.

**Render** — mature GA CLI for deploy/logs/jobs, but rollback has no CLI verb (dashboard/REST API only) → Partial on CLI-first; native Node runtime, no Dockerfile; strong `llms.txt` docs; GA MCP server (read/create-leaning, can't trigger deploys). Needs an `@astrojs/node` swap; the free tier spins down (~1 min cold start, unusable for reminder reliability), so realistically ~$8/mo ($7 Web Service + $1 cron).

**Netlify** — CLI does deploy/logs/env but **rollback is a UI action** → Partial on CLI-first; serverless functions; no published `llms.txt` → Partial on docs; official Netlify MCP server (released, unversioned). Astro 6 SSR is first-class and the free tier easily covers this scale, but it needs an `@astrojs/netlify` swap and an open adapter build bug on 6.5.0+ ([withastro/astro#14099](https://github.com/withastro/astro/issues/14099)) means pinning a known-good adapter version.

**Fly.io** — `flyctl` is mature (rollback via prior-image redeploy); but it's container-based — a Dockerfile (auto-generated) and machine/region config carry more operational surface than pure serverless → Partial on managed; HTML docs, no `llms.txt` → Partial on docs; `fly mcp server` is **experimental** and Fly itself de-emphasizes MCP → Partial. No free tier ($5 trial, then ~$2–5/mo). Cron has three native paths, none clean. Lowest fit for a 3-week solo MVP.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Won on a perfect criteria score _plus_ zero migration cost. The stack ships pre-configured: `astro.config.mjs` uses `adapter: cloudflare()`, `wrangler.jsonc` already sets `compatibility_flags: ["nodejs_compat"]` and `observability.enabled: true`, and `wrangler` 4.90.0 is a devDependency. Free-tier Cron Triggers (1-minute floor) cleanly cover the reminder loop, the agent-readable docs and broad MCP coverage are best-in-class, and the bill is $0 at MVP scale. Single-region preference (interview Q4) costs nothing here — Cloudflare's edge is a free bonus, not a tax.

#### 2. Vercel

The genuine runner-up: criteria-equal with Cloudflare, a $0 Hobby tier, top-tier DX and agent docs. The gap is entirely stack-fit: an adapter swap to `@astrojs/vercel`, a daily-only free-tier cron (workable as a single daily reminder batch, but a real constraint), and a Hobby-tier commercial-use restriction to keep in mind if the project is ever monetized. Pick this if Cloudflare's `scheduled()`-handler friction (see risk register) proves too costly.

#### 3. Railway

A solid container-PaaS fallback: a complete CLI loop including a real rollback verb, scale-to-zero, `llms.txt` docs, and a 5-minute cron floor. The gap vs. the recommendation: an `@astrojs/node` swap, ~$5/mo (no free tier), and an MCP server that's still pre-GA. Reasonable if a future requirement pushes the app toward a long-lived Node process that the Workers model handles awkwardly.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **The `@astrojs/cloudflare` adapter only emits a `fetch` handler.** The reminder cron (FR-018/019, must-have) needs a `scheduled()` handler — that requires a custom worker entry, and the adapter regenerates its output on every build. A non-idiomatic hack sits under a core feature.
2. **10 ms CPU per invocation on the free tier.** The photo→AI route proxies a vision call and may decode a ~10 MB image (NFR); Supabase JWT verification is crypto work. Any route exceeding 10 ms forces the $5 paid plan — where CPU caps still apply.
3. **`nodejs_compat` is a partial shim, not Node.** The Supabase SSR client and any AI SDK assume Node APIs; `workerd` polyfills cover a subset. A transitive dependency reaching for `fs`, raw `net`, or stream edge-cases fails only at the edge.
4. **Stale Pages-era guidance.** The `tech-stack.md` `deployment_target` hint still says `cloudflare-pages`; Pages is now maintenance-mode and the canonical target is Workers. Pages-era tutorials dominate search results and lead to a deprecated deployment shape.
5. **Worker bundle-size limit** (3 MB compressed free / 10 MB paid). Astro SSR + React 19 + Supabase SDK + an AI SDK can approach the cap; a late-MVP dependency could push the deploy over with a cryptic error.

### Pre-Mortem — How This Could Fail

The team shipped on Cloudflare because the starter was pre-wired for it — nobody treated it as a decision. The reminder cron worked in week one, but an `@astrojs/cloudflare` upgrade in week four regenerated the worker output and silently dropped the hand-injected `scheduled()` handler. Watering reminders stopped firing; with no test and no alert, it went unnoticed for eleven days — and "the reminder loop closes" is a primary success metric. Meanwhile the AI-vision route kept tripping the 10 ms CPU limit under real photos (local tests used tiny fixtures); upgrading to the paid plan helped but the CPU cap still bit on cold JWT verification. Supabase's SSR client threw intermittent `crypto` errors at the edge that never reproduced locally. Each issue was small alone, but together they consumed the after-hours budget meant for v2. The root mistake: treating "the starter already configured it" as a decision instead of a default, and never exercising the photo path on real `workerd`.

### Unknown Unknowns

- **Email is not a platform primitive.** Reminders need a third-party email API (Resend, Postmark, etc.) — MailChannels closed its free Workers route in 2024. This collides directly with PRD Open Question #1 (notification delivery channel).
- **`scheduled()` cron can't be tested by hitting a URL.** It needs `wrangler dev --test-scheduled` plus a request to `/__scheduled` — easy to assume cron is broken when it just needs the test endpoint.
- **Local `.dev.vars` and production secrets are separate stores.** A secret that works locally is silently absent in prod until `wrangler secret put` — and `createClient` returns `null` by design, so a missing prod secret degrades _quietly_ instead of erroring loudly.
- **A custom domain on Workers requires the domain's DNS to be a Cloudflare-managed zone.** You can't CNAME an externally-registered domain to a Worker; nameservers must move to Cloudflare. (`*.workers.dev` needs nothing.)
- **Free-tier limits reset daily, not monthly.** The 100k-requests/day cap is generous for this MVP, but a traffic burst (or a runaway cron) is bounded by a _daily_ bucket — worth knowing before assuming "free tier = unlimited at small scale".

## Operational Story

- **Preview deploys**: `npx wrangler versions upload` uploads a new version without routing production traffic and returns a preview URL (`<version-prefix>-<worker-name>.<account-subdomain>.workers.dev`). For PR-based previews, run it from a GitHub Actions workflow on `pull_request`. Preview URLs are public by default — gate them with Cloudflare Access if a preview must not be world-readable.
- **Secrets**: production secrets live in Workers Secrets, set via `npx wrangler secret put <NAME>` (encrypted, not readable back). Local dev reads `.dev.vars` (gitignored — a _separate_ store from production). CI needs a `CLOUDFLARE_API_TOKEN` stored as a GitHub Actions secret, scoped to Workers edit for this one project. Rotation: re-run `wrangler secret put` to overwrite; rotate the Supabase key in the Supabase dashboard first, then update the Worker secret.
- **Rollback**: `npx wrangler deployments list` to find a prior version, then `npx wrangler rollback [<version-id>]` — near-instant, reverts the Worker code. Caveat: rollback reverts _code only_ — a Supabase schema migration applied since the bad deploy does not roll back; reconcile DB state by hand.
- **Approval**: human-only — first production publish, rotating the Supabase key, deleting the Worker, and any nameserver/custom-domain change. An agent may run unattended: `wrangler dev`, `wrangler tail`, `wrangler deployments list`, and `wrangler versions upload` (preview). Routine production publishes go through reviewed GitHub Actions auto-deploy-on-merge (the starter's CI default).
- **Logs**: `npx wrangler tail` streams live logs (`--format json`, `--status error`, `--search`). Retroactive logs are already enabled — `observability.enabled: true` is set in `wrangler.jsonc`, so Workers Logs retains invocation logs, queryable in the dashboard or via the Cloudflare observability MCP server.

## Risk Register

| Risk                                                                                                                       | Source                              | Likelihood | Impact | Mitigation                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter regenerates worker output on every build, dropping a hand-injected `scheduled()` handler — reminders silently stop | Devil's advocate / Pre-mortem       | M          | H      | Keep a custom worker entry under version control as `main` (not a post-build patch); add a smoke test or external uptime check asserting the cron fired              |
| 10 ms free-tier CPU limit exceeded by the AI-vision route (10 MB photo decode, JWT verify)                                 | Devil's advocate                    | M          | M      | Upload photos directly to Supabase Storage rather than through the Worker; load-test the photo path on real `workerd` before launch; move to the $5 plan if exceeded |
| `nodejs_compat` shim doesn't cover a Supabase/AI SDK Node API used at the edge                                             | Devil's advocate                    | L          | M      | Exercise the full auth + AI path with `wrangler dev` (real `workerd`) before deploy; pin SDK versions                                                                |
| Reminders need an email provider — Cloudflare has no email-send primitive (MailChannels free route closed 2024)            | Unknown unknowns / Research finding | H          | M      | Resolve PRD Open Question #1; pick an email API (Resend/Postmark) and store its key as a Worker secret                                                               |
| Production secret never set via `wrangler secret put` — app degrades silently (`createClient` returns `null`)              | Unknown unknowns                    | M          | H      | Add a post-deploy health endpoint that asserts Supabase connectivity; include secret-set in the deploy checklist                                                     |
| Worker bundle exceeds the size limit after a late dependency addition                                                      | Devil's advocate                    | L          | M      | Watch `wrangler deploy` bundle-size output; lazy-import the AI SDK; keep dependencies lean                                                                           |
| Following stale Cloudflare _Pages_ guidance (the `deployment_target` hint still says `cloudflare-pages`)                   | Devil's advocate / Research finding | M          | L      | Project is already on the Workers shape (`assets` + `main` in `wrangler.jsonc`); ignore Pages-era tutorials; correct the stale hint in `tech-stack.md`               |
| Custom domain requires migrating the domain's DNS to a Cloudflare-managed zone                                             | Unknown unknowns                    | M          | L      | If a custom domain is needed, plan the nameserver migration up front; `*.workers.dev` needs nothing                                                                  |
| A schema migration shipped alongside a deploy can't be undone by `wrangler rollback`                                       | Pre-mortem / Research finding       | M          | M      | Keep migrations additive/backward-compatible; decouple DB migration steps from code deploys                                                                          |

## Getting Started

1. **Rename the Worker.** Both `wrangler.jsonc` `name` and `package.json` `name` are still `10x-astro-starter`. Set a real name (e.g. `10x-plants-inventory`) before the first deploy — the Worker name becomes the `*.workers.dev` subdomain.
2. **Authenticate Wrangler** (interactive — run it yourself): `npx wrangler login`. `wrangler` 4.90.0 is already a devDependency, so no global install is needed.
3. **Set production secrets**: `npx wrangler secret put SUPABASE_URL` then `npx wrangler secret put SUPABASE_KEY`. These are independent of the local `.dev.vars` file.
4. **Deploy**: `npm run build` then `npx wrangler deploy`. The build emits `dist/`; `wrangler.jsonc` already points `main` at the adapter entrypoint, serves `dist/` via the `ASSETS` binding, and has `nodejs_compat` + `observability` configured. Verify the returned `*.workers.dev` URL.
5. **Wire the reminder cron**: add a `"triggers": { "crons": [...] }` block to `wrangler.jsonc` and a `scheduled()` handler. Because `@astrojs/cloudflare` emits only a `fetch` handler, use a custom worker entry that re-exports the adapter's fetch handler and adds `scheduled()`. Test locally with `npx wrangler dev --test-scheduled`, then request `http://localhost:8787/__scheduled`.
6. **Note on local dev**: `npm run dev` (`astro dev`) already runs on `workerd` via the adapter — that _is_ the day-to-day dev loop. `wrangler dev` is only needed to exercise the cron `scheduled()` handler.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration
- CI/CD pipeline setup (the starter ships GitHub Actions auto-deploy-on-merge — configuring it is downstream work)
- Production-scale architecture (multi-region, HA, DR)
