---
bootstrapped_at: 2026-05-20T20:56:24Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: 10x-plants-inventory
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10x-plants-inventory
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: true
```

### Why this stack (verbatim from hand-off body)

Solo, after-hours, 3-week MVP web-app shipping AI-vision plant cataloging,
magic-link auth, photo storage, and scheduled care reminders. 10x-astro-starter
is the recommended default for `(web, js)` and a tight fit: Supabase covers
magic-link auth plus per-user storage isolation (the access-control guardrail),
Astro API routes call the AI provider for the photo-to-care-info flow, and
Cloudflare Pages/Workers handles edge deploy with Cron Triggers for the
watering and winterization reminder loop. All four agent-friendly criteria
clear cleanly, which matters for after-hours velocity. Bootstrapper confidence
is first-class, so scaffolding should be mostly smooth with occasional manual
steps. `has_auth`, `has_ai`, and `has_background_jobs` are set; `has_payments`
and `has_realtime` are out of scope per PRD Non-Goals. GitHub Actions
auto-deploy-on-merge is the starter's shipping default — fits the
solo-builder workflow.

## Pre-scaffold verification

| Signal      | Value                                                               | Severity | Notes                                                             |
| ----------- | ------------------------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| npm package | not run                                                             | n/a      | cmd_template starts with `git clone`; no npm CLI to version-check |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17T10:33:39Z | fresh    | from card.docs_url; 3 days old at bootstrap time                  |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 20 (top-level entries: 7 dotfiles/dirs + 13 visible files/dirs)
**Conflicts (.scaffold siblings)**: CLAUDE.md.scaffold (cwd had a pre-existing 10xDevs toolkit CLAUDE.md; the starter's CLAUDE.md was sidelined for manual merge)
**.gitignore handling**: moved silently (cwd had no .gitignore)
**.bootstrap-scaffold cleanup**: deleted (after .git/ removal per git-clone strategy)

**Engine warnings during `npm install` (informational, install succeeded)**:

- Local Node version: v22.11.0
- astro@6.3.1 requires Node >=22.12.0
- vite@7.3.3 requires Node ^20.19.0 || >=22.12.0
- @vitejs/plugin-react@5.2.0 requires Node ^20.19.0 || >=22.12.0
- @eslint/core@1.2.1, eslint-visitor-keys@5.0.1 require Node ^20.19.0 || ^22.13.0 || >=24
- yargs-parser@22.0.0 requires Node ^20.19.0 || ^22.12.0 || >=23

Recommended: `nvm use` (a `.nvmrc` ships with the starter) or upgrade Node to ≥22.13.0 before running `npm run dev` to avoid runtime surprises.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 10 MODERATE, 0 LOW (total 11 across 895 dependencies)
**Direct vs transitive**: 0/0/3/0 direct of total 0/1/10/0 — the 1 HIGH finding is transitive; all 3 direct-flagged advisories are MODERATE.

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** (transitive) — advisory 1119005. Reached via the Cloudflare tooling chain (devalue is pulled in by Astro's Cloudflare/Miniflare integration). No fix in current direct deps; advisory will clear when the upstream Cloudflare packages bump their `devalue` requirement.

#### MODERATE findings

Direct (3):

- **@astrojs/check** — via @astrojs/language-server → volar-service-yaml → yaml-language-server → yaml (advisory 1115556)
- **@astrojs/cloudflare** — via @cloudflare/vite-plugin and wrangler (chains into miniflare → ws advisory 1119108)
- **wrangler** — via miniflare → ws (advisory 1119108)

Transitive (7):

- **@astrojs/language-server**, **@cloudflare/vite-plugin**, **miniflare**, **volar-service-yaml**, **ws**, **yaml**, **yaml-language-server**

All MODERATE findings cluster around two upstream advisories: the `ws` DoS advisory (1119108) reached through Miniflare, and the `yaml` parsing advisory (1115556) reached through the YAML language server. Neither is fixable by changing a direct dependency in the starter today — both clear when upstream packages bump their pins.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | true                 |
| has_background_jobs     | true                 |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:

- `git init` (if you have not already) to start your own repo history.
- Review `CLAUDE.md.scaffold` and decide what (if anything) from the starter's instructions you want to merge into your existing `CLAUDE.md`.
- Switch Node to a version that satisfies the starter's engines: `nvm use` (uses the shipped `.nvmrc`) or upgrade to ≥22.13.0.
- Configure `.env` from `.env.example` (Supabase keys + any AI provider credentials).
- Address audit findings per your project's risk tolerance — the full breakdown is above. Today's actionable item is "monitor upstream Cloudflare/Astro releases for bumps that resolve the `ws` and `yaml` advisories"; no direct-dep upgrade resolves them now.
