# First Deployment — 10xPlantsInventory on Cloudflare Workers

> **Runbook.** Execute the phases top-to-bottom. Each phase carries a status box
> and per-step checkboxes — flip `☐ → ☑` (phase) and `[ ] → [x]` (step) as you
> go. Tags: **`[user]`** = a manual gate you perform; **`[agent-safe]`** = local
> file edits with no external side effects.

## Context

First production deployment, per `context/foundation/infrastructure.md`
(recommendation: Cloudflare Workers — 10/10 on the agent-friendly criteria, $0 on
the free tier, stack already pre-wired for `workerd`). Only the **auth layer** is
built so far (Supabase email/password); the plant/location/reminder/AI-vision
domain does not exist yet. Goal: get the deploy pipeline working end-to-end on
the auth scaffold so later features ship along a proven path.

**Decisions confirmed with the user:**
- A hosted Supabase project exists → set Worker secrets so sign-in works in
  production.
- Wire automatic deployment from GitHub Actions on merge to `main`.
- No Cloudflare account exists yet → account creation is the first gate (Phase 0).

**Stack (from `context/foundation/tech-stack.md`):** Astro 6 SSR (`output:
"server"`) + React 19 islands, `@astrojs/cloudflare` 13.5.0 adapter, Supabase
auth (`@supabase/ssr`), `wrangler` 4.94.0, npm, GitHub Actions auto-deploy-on-merge.

**Out of scope for this deployment:**
- The reminder `scheduled()` cron (infrastructure.md step 5) — the reminder
  feature does not exist; deferred until the reminder domain is built.
- A custom domain — `*.workers.dev` is sufficient; a custom domain requires
  migrating the domain's DNS zone to Cloudflare (nameserver change).
- Supabase migrations — no app tables; the scaffold uses Supabase's built-in auth.
- Production SMTP — the scaffold tests fine on Supabase's built-in email sender
  (see Phase 5 edge note); a real provider is future work.

---

## Phase 0 — Accounts & prerequisites  `[user]`

**Status:** ◐ in progress — Cloudflare account ready; Supabase keys still to copy

Prerequisites that have no code; gather these before touching the repo.

- [x] Create a free Cloudflare account at <https://dash.cloudflare.com/sign-up>
      and verify the email. The free Workers tier (100k requests/day) covers this
      MVP at $0.
- [x] Be aware: the **first** `wrangler deploy` (Phase 3) prompts you to register
      a **`workers.dev` subdomain** for the account — accept it. The live URL
      becomes `https://10x-plants-inventory.<your-subdomain>.workers.dev`.
- [ ] Confirm the hosted Supabase project exists. From the Supabase dashboard →
      Project Settings → API, copy:
  - **Project URL** → this is `SUPABASE_URL`.
  - **anon / publishable key** → this is `SUPABASE_KEY`.

  > ⚠️ **Use the anon / publishable key — never the `service_role` / secret
  > key.** `src/lib/supabase.ts` builds a cookie-session client with
  > `@supabase/ssr`; the service-role key bypasses Row Level Security and must
  > never reach a browser-facing Worker.

---

## Phase 1 — Rename & local config  `[agent-safe]`

**Status:** ☑ done

The Worker and the package are still named `10x-astro-starter`; the Worker name
becomes the `*.workers.dev` subdomain. These are local file edits with no
external side effects.

- [x] `wrangler.jsonc` — `"name": "10x-astro-starter"` → `"10x-plants-inventory"`.
- [x] `package.json` — `"name": "10x-astro-starter"` → `"10x-plants-inventory"`;
      add a script `"deploy": "astro build && wrangler deploy"` (a convenience
      shortcut, reused by CI).
- [x] `context/foundation/tech-stack.md` — frontmatter
      `deployment_target: cloudflare-pages` → `cloudflare-workers` (a correction
      recommended directly by the infrastructure.md risk register — Pages is in
      maintenance mode; Workers is the canonical target).

> **Leave alone:** `wrangler.jsonc` already has the correct
> `compatibility_date: "2026-05-08"`, `compatibility_flags: ["nodejs_compat"]`,
> the `ASSETS` binding, and `observability.enabled: true`. The `main` field
> correctly points at `@astrojs/cloudflare/entrypoints/server` (the adapter
> entrypoint). Do not change these — see Edge cases #1.

---

## Phase 2 — Authenticate wrangler  `[user]`

**Status:** ☑ done

- [x] `npx wrangler login` — interactive OAuth (opens a browser). Run it yourself
      by typing `! npx wrangler login` in the session. `wrangler` 4.94.0 is
      already a devDependency — no global install needed.
- [x] `npx wrangler whoami` — confirm the logged-in account and **copy the
      Account ID** (you need it in Phase 7). Logged in as `swiatek1996@gmail.com`;
      single account, so no `CLOUDFLARE_ACCOUNT_ID` override is needed locally.

**Edge support:**
- *No browser available (headless/SSH/remote shell):* skip `wrangler login`.
  Instead create an API token (Phase 7 step 1) and `export
  CLOUDFLARE_API_TOKEN=<token>` in the shell — `wrangler` uses it automatically.
- *Your login has access to multiple Cloudflare accounts:* `wrangler` will error
  asking which one. Set `export CLOUDFLARE_ACCOUNT_ID=<id>` (the value from
  `wrangler whoami`).

---

## Phase 3 — Build & first deploy  `[user]`

**Status:** ☑ done — live at https://10x-plants-inventory.swiatek1996.workers.dev

This is the first production publish — the human-approval gate that
infrastructure.md requires.

- [x] `npx astro sync` — regenerate `astro:*` types (same step CI runs before
      lint/build).
- [x] `npm run build` — SSR build → `dist/`.

  > Secrets are declared `access: "secret"` (server-only) in the
  > `astro.config.mjs` `env.schema` and read at runtime via `astro:env/server`,
  > so **they are not baked into the bundle**. The schema also marks them
  > `optional`, so the build succeeds even with no `.env` present. Production
  > values come from Worker secrets (Phase 4), not the build.

- [x] `npx wrangler deploy` — first publish. Created the `10x-plants-inventory`
      Worker; the `workers.dev` subdomain (`swiatek1996`) was already registered,
      so no interactive prompt appeared.
- [x] **Live URL:** `https://10x-plants-inventory.swiatek1996.workers.dev` —
      Version ID `a039a9cb-310d-4509-a29d-2111feed4001`. Bundle 391 KiB gzip
      (well under the 3 MB free-tier limit).

> **Side effect — auto-provisioned bindings.** The `@astrojs/cloudflare` adapter
> wires Astro's session API to Cloudflare KV, so `wrangler deploy` auto-created
> a KV namespace `10x-plants-inventory-session` (binding `SESSION`) and bound
> `IMAGES` (Cloudflare Images). Both are free-tier. Consequence for Phase 7: the
> scoped CI API token must include **Workers KV Storage (write)** in addition to
> Workers Scripts, or CI deploys fail when re-provisioning the binding.

**Edge support:**
- *`workerd` compatibility-date warning* (`The latest compatibility date
  supported by the installed Cloudflare Workers Runtime is "…", but you've
  requested "2026-05-08". Falling back…`) — harmless; the deploy still succeeds.
  It just means the local `wrangler` bundles a slightly older runtime.
- *Build fails with `require is not defined` or `Fetch API cannot load`* — see
  Edge cases #2 and #3.
- *`wrangler deploy` reports a large bundle* — see Edge cases #6.

---

## Phase 4 — Production secrets  `[user]`

**Status:** ☑ done — `SUPABASE_URL` + `SUPABASE_KEY` set (verified via `secret list`)

Done **after** the first deploy — the Worker now exists, so `wrangler secret put`
is guaranteed to target an existing script (each `secret put` triggers a
re-deploy of a new version). This is a safer ordering than "secrets before
deploy".

- [x] `! npx wrangler secret put SUPABASE_URL` — paste the Project URL from
      Phase 0.
- [x] `! npx wrangler secret put SUPABASE_KEY` — paste the anon / publishable key
      from Phase 0.

After both secrets, the live Worker version has Supabase wired. Worker secrets
are a **separate store** from the local `.env` / `.dev.vars`, are encrypted, are
not readable back, and **survive every future `wrangler deploy`** (CI deploys
included).

**Edge support:**
- *`wrangler secret put` fails "script not found"* — the Worker was not deployed
  yet. Run Phase 3 first (this is exactly why Phase 4 follows Phase 3).

---

## Phase 5 — Supabase Auth URL configuration  `[user]`

**Status:** ☑ done — Site URL + Redirect URLs set; "Confirm email" is **ON**

**External-integration step.** The hosted Supabase project still points auth
redirects at `localhost` (see `supabase/config.toml`: `site_url =
"http://127.0.0.1:3000"`). Without this phase, signup-confirmation and
password-reset emails link to `localhost` and break for real users.

- [x] Supabase dashboard → **Authentication → URL Configuration** → set
      **Site URL** to `https://10x-plants-inventory.swiatek1996.workers.dev`.
- [x] In the same screen, add the Worker URL to the **Redirect URLs** allow-list
      — `https://10x-plants-inventory.swiatek1996.workers.dev/**` (the `/**`
      wildcard covers `/auth/confirm-email` and any future callback paths).
- [x] **Confirm email is ON** — signup sends a confirmation link; the app routes
      `signup` → `/auth/confirm-email` (`src/pages/api/auth/signup.ts`), and the
      link target now resolves to the Worker URL. A new user must click the
      emailed link before `signInWithPassword` will succeed.

**Edge support:**
- *Confirmation email never arrives / arrives slowly:* Supabase's **built-in
  email sender is rate-limited** (~2–4 emails/hour) and is explicitly not for
  production volume. Fine for scaffold testing — just don't retry signup in a
  tight loop. For real launch traffic, wiring custom SMTP (Resend, Postmark,
  SendGrid) via Supabase → Authentication → SMTP Settings is **future work**,
  out of scope here.
- *Auth works on the homepage but redirects bounce to `localhost`:* the Site URL
  edit did not save, or the Redirect URLs list is missing the Worker origin.

---

## Phase 6 — Verification  `[user]`

**Status:** ☑ done — auth verified end-to-end on production; no edge errors

Run after Phases 3–5. This proves the deploy and the secret wiring.

- [x] Open the `*.workers.dev` URL — the homepage loads (`200`).
- [x] Navigate to `/dashboard` → it redirects to `/auth/signin` (`302`,
      middleware `PROTECTED_ROUTES` in `src/middleware.ts`).
- [x] Full **sign-up → confirm email → sign-in** flow succeeds. `wrangler tail`
      captured `POST /api/auth/signup → /auth/confirm-email → GET /?code=… →
      POST /api/auth/signin → GET /` — all `Ok`. The confirmation email linked to
      the Worker URL (not `localhost`), proving Phase 5.

  > This is the real proof the secrets landed. `createClient` returns `null`
  > when `SUPABASE_URL`/`SUPABASE_KEY` are unset and the app **degrades
  > silently** — a working sign-in is the only positive signal.

- [x] `npx wrangler tail` — streamed during the sign-in test; **no edge errors**
      (`crypto`/`stream`/`[object Object]` all clear — Edge cases #1, #4, #5 did
      not fire on real `workerd`).
- [x] `npx wrangler deployments list` — 3 versions (initial upload + 2 Secret
      Change); current `7eddca2c…`.

> **Finding — no auth callback route (out of scope).** The confirmation email
> link lands on `/?code=…`, but the app has no route that calls
> `exchangeCodeForSession`. Email confirmation still works (Supabase verifies the
> token before redirecting), but the click does not auto-sign-in the user — they
> must sign in manually afterward. Fine for email+password; would be a bug for
> magic-link / OAuth. Belongs to the unbuilt auth domain — track as a future
> ticket, not a deployment blocker.

**Edge support:**
- *Every route returns `[object Object]`* — see Edge cases #1.
- *`crypto` / `stream` errors in `wrangler tail`* — see Edge cases #4, #5.

---

## Phase 7 — GitHub Actions auto-deploy  `[user]` gates + `[agent-safe]` code

**Status:** ◐ in progress — workflow committed + pushed; first CI auto-deploy run verifying

Wires auto-deploy on merge to `main`. Done **after** a verified manual deploy so
CI ships along a known-good path.

**Manual gates `[user]`:**

- [x] Cloudflare dashboard → My Profile → API Tokens → create a **scoped API
      token** using the **"Edit Cloudflare Workers"** template. Restrict it to
      this one account — no DNS, no billing, no unrelated zones.
- [x] In the `SzymonSwiatek/PlantsInventory` repo → Settings → Secrets and
      variables → Actions, add repository secrets:
  - `CLOUDFLARE_API_TOKEN` — the token from the step above.
  - `CLOUDFLARE_ACCOUNT_ID` — the Account ID (`2d4c2ee7…`) from Phase 2.

  > **`SUPABASE_*` are NOT needed as GitHub secrets** (corrects an earlier
  > assumption). Production values live in Cloudflare Worker secrets (Phase 4),
  > which `wrangler deploy` preserves; the build treats them as `optional` +
  > `access: secret` (read at runtime, never inlined). The existing `ci` job's
  > build step still references them via `${{ secrets.* }}` — they resolve to
  > empty strings, which is harmless. Only the two `CLOUDFLARE_*` secrets are
  > required for the `deploy` job.

**Code change `[agent-safe]`:**

- [x] `.github/workflows/ci.yml` — bumped the **existing `ci` job** from
      `actions/checkout@v4` / `actions/setup-node@v4` to `@v6`. The `@v4` actions
      run on Node 20, which GitHub force-migrates to Node 24 on **2026-06-02**;
      `@v6` supports Node 24 natively. The `node-version: 22` build input is a
      separate setting — left as-is.
- [x] `.github/workflows/ci.yml` — added a `deploy` job alongside the `ci` job:
  - `needs: ci` (deploy only after a green build);
  - `if: github.event_name == 'push'` (merges to `main` only, not PRs);
  - steps: `actions/checkout@v6` → `actions/setup-node@v6` (node 22, npm cache) →
    `npm ci` → `npx astro sync` → `npm run build` →
    `cloudflare/wrangler-action@v3` with `apiToken`, `accountId`,
    `wranglerVersion: "4.94.0"` (pinned to `package.json` — Edge cases #9),
    `command: deploy`.
  - The deploy-job build step needs **no `SUPABASE_*` env** — see the note above.

  > The Worker secrets from Phase 4 survive CI deploys — `wrangler deploy` does
  > not wipe them, so the CI-deployed Worker keeps its Supabase wiring.

- [ ] Commit + push to `main`; confirm the Actions run executes `ci` → `deploy`,
      and `npx wrangler deployments list` shows the new CI-originated deployment.
- First CI deploy to watch: `wrangler`'s experimental binding provisioning must
  re-attach the existing `SESSION` KV namespace. The "Edit Cloudflare Workers"
  token includes Workers KV Storage edit, so this should just work — but check
  the `deploy` job log on the first run.

**Edge support:**
- *Token rejected (`Authentication error 10000`):* the token template was wrong
  or the token is scoped to a different account than `CLOUDFLARE_ACCOUNT_ID`.
- *Actions Node-20 deprecation notice:* addressed above — both jobs use `@v6`
  actions, which run on Node 24. The `node-version: 22` build input is a
  separate setting and stays (matches CLAUDE.md and `package.json` engines).

---

## Phase 8 — Finalize the audit artifact  `[user]`

**Status:** ☑ done

- [x] After execution, fill in the **Outcome** section at the bottom of this file.
      This document is the approved deploy plan and the downstream "what's
      already deployed" ground truth for milestone planning.

---

## Edge cases & troubleshooting

Scan this table when something breaks. Each entry names the trigger, the cause,
and the fix.

| # | Symptom | Cause & fix |
|---|---|---|
| 1 | Every SSR route returns `[object Object]` | `nodejs_compat` + native process v2 makes Astro mis-detect Node and emit async-iterable bodies `workerd` can't serve. **Should not occur here** — `compatibility_date: 2026-05-08` is past the `2026-02-19` cutoff where `fetch_iterable_type_support` auto-enables ([withastro/astro#14511](https://github.com/withastro/astro/issues/14511)). If it ever appears (e.g. after a compat-date downgrade), add `"disable_nodejs_process_v2"` to `compatibility_flags` in `wrangler.jsonc`. |
| 2 | Build fails: `Fetch API cannot load: /` | Astro 6 + Cloudflare adapter + Supabase auth endpoints ([withastro/astro#16190](https://github.com/withastro/astro/issues/16190)). Generally resolved on Astro `^6.3.1`. If hit: `npm update astro @astrojs/cloudflare`, re-run `npx astro sync`, rebuild. |
| 3 | Build fails: `require is not defined` (picomatch) | An Astro-6-beta-era regression ([withastro/astro#15796](https://github.com/withastro/astro/issues/15796)). Resolved on stable 6.3.1 — `npm update astro` if seen. |
| 4 | Edge error: `Dynamic require of 'stream' is not supported` | `@supabase/ssr` needs the `nodejs_compat` flag — it's already set in `wrangler.jsonc`. If this still fires, confirm the flag survived the Phase 1 rename and that `compatibility_date` is recent. |
| 5 | Edge error mentioning `crypto` during sign-in | `@supabase/ssr` JWT verification uses Node `crypto` via the `nodejs_compat` shim; surfaces only on real `workerd`, not local `astro dev`. Catch it with `wrangler tail` during the Phase 6 sign-in test; if it fires, pin `@supabase/ssr` / `@supabase/supabase-js` and retest. |
| 6 | `wrangler deploy` warns the bundle is large | Free limit is 3 MB compressed (10 MB paid). Astro SSR + React 19 + Supabase SDK is normally well under. Watch the size line; keep dependencies lean as the domain grows. |
| 7 | `wrangler secret put` → "script not found" | The Worker isn't deployed. Run Phase 3 before Phase 4. |
| 8 | `wrangler` errors asking which account | The login has multiple accounts. `export CLOUDFLARE_ACCOUNT_ID=<id>` (from `wrangler whoami`). |
| 9 | CI deploys with a different `wrangler` than local | `wrangler-action` defaults to the latest v4. Pin `wranglerVersion: "4.94.0"` in the `deploy` job to match `package.json`. |
| 10 | Sign-in works but post-auth redirect lands on `localhost` | Phase 5 incomplete — Supabase **Site URL** / **Redirect URLs** still point at `localhost`. |

## Risks from infrastructure.md relevant to this deployment

- **Secret never set → silent degradation** — `createClient` returns `null` and
  auth fails quietly. Mitigated by the Phase 6 sign-in test (the only positive
  proof secrets reached production).
- **`nodejs_compat` shim doesn't cover a Node API Supabase uses at the edge** —
  mitigated by `wrangler tail` + the sign-in test on real `workerd` (Phase 6),
  and Edge cases #4–#5.
- **Stale Cloudflare *Pages* guidance** — we use `wrangler deploy` (Workers); the
  `wrangler.jsonc` is already in the Workers shape (`assets` + adapter `main`).
  Ignore Pages-era tutorials; Phase 1 also corrects the stale `tech-stack.md`
  `deployment_target` hint.

## Files changed by this plan

| File | Change | Phase |
|---|---|---|
| `wrangler.jsonc` | `name` → `10x-plants-inventory` | 1 |
| `package.json` | `name` → `10x-plants-inventory`; add `deploy` script | 1 |
| `context/foundation/tech-stack.md` | frontmatter `deployment_target` fix | 1 |
| `.github/workflows/ci.yml` | new `deploy` job | 7 |
| `context/changes/deployment/deployment-plan.md` | this artifact + Outcome below | 8 |

## End-to-end verification

After Phases 3–5: the `*.workers.dev` URL returns the homepage; `/dashboard`
redirects an unauthenticated visitor to `/auth/signin`; the full sign-up →
(confirm) → sign-in flow works (proof the secrets are wired); `wrangler tail`
shows no edge errors. After Phase 7: a push/merge to `main` triggers `ci` →
`deploy` in Actions, and `wrangler deployments list` shows the new CI-originated
deployment.

## Outcome

Deployment executed 2026-05-22.

- Worker name: `10x-plants-inventory`
- Live URL: https://10x-plants-inventory.swiatek1996.workers.dev
- Cloudflare account: `swiatek1996@gmail.com` (ID `2d4c2ee7daa6822367d426614c2cf64a`)
- Worker secrets wired: `SUPABASE_URL` + `SUPABASE_KEY` set via
  `wrangler secret put`, verified with `wrangler secret list`.
- Auto-provisioned bindings: KV namespace `10x-plants-inventory-session`
  (binding `SESSION`), Cloudflare Images (binding `IMAGES`).
- Supabase Auth: Site URL + Redirect URLs point at the Worker URL;
  "Confirm email" is ON.
- Verification: homepage `200`, `/dashboard` → `302` `/auth/signin`, full
  signup → confirm → sign-in succeeded on production with no edge errors.
- CI auto-deploy on merge to `main`: `deploy` job added to
  `.github/workflows/ci.yml` (`needs: ci`, push-only); GitHub secrets
  `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` set.
- Deferred: reminder `scheduled()` cron, custom domain, Supabase migrations,
  production SMTP, auth callback / `exchangeCodeForSession` route.
