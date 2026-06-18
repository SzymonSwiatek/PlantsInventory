---
date: 2026-06-14T12:57:23+02:00
researcher: Szymon Świątek
git_commit: 8a39413798c7396595103f532ceca68645452f56
branch: main
repository: PlantsInventory
topic: "Oracle for the AI suggestion normalizer (Risk #5) — never-throws + contract-valid care profile"
tags: [research, codebase, ai-parse, normalizer, test-oracle, risk-5, vitest]
status: complete
last_updated: 2026-06-14
last_updated_by: Szymon Świątek
---

# Research: AI-parse normalizer — the test oracle for Risk #5

**Date**: 2026-06-14T12:57:23+02:00
**Researcher**: Szymon Świątek
**Git Commit**: 8a39413798c7396595103f532ceca68645452f56
**Branch**: main
**Repository**: PlantsInventory

## Research Question

Rollout Phase 1 of `context/foundation/test-plan.md` §3 — _Bootstrap test runner + AI-parse
normalizer unit suite_. Surface the **oracle** for Risk #5: _the suggestion normalizer throws,
or emits a malformed / garbage care profile, when the provider returns missing, extra, or
differently-typed fields_ (Medium impact × High likelihood). The oracle — what the normalizer
**should** output — must come from sources (PRD, type contracts, DB schema, the editable form,
the S-01 plan), **not** from re-reading the normalizer's current output (avoid the snapshot
tautology). Also: confirm what standing up Vitest requires here.

## Summary

- **Where the failure lives (ground truth).** There is exactly one normalizer:
  `normalizeSuggestion(raw: unknown): AiSuggestion`, exported from
  `src/lib/ai/suggest.ts:137`. It is **pure** and **importable in complete isolation** — its
  entire import graph is type-only (`@/types` → `@/db/database.types`, both `import type`), so
  the Vitest suite needs **no `astro:env/server` mock and no workerd shim**. This matches the
  S-01 design decision ("pure export, no provider/network import at module top").
- **The throws are upstream, not in the normalizer.** `normalizeSuggestion` has no `throw` in
  its subtree. The throws that produce the `ai_unavailable` envelope live in `requestSuggestion`
  / `extractText` / `JSON.parse` (the provider seam), and are caught by the endpoint. So the
  "normalizer throws" face of Risk #5 is really _"does the normalizer survive every shape of
  `JSON.parse` output without throwing"_ — a pure-function unit concern.
- **The oracle is firm on the shape, soft on two coercion policies.** All sources agree on the
  five-field care profile, every field nullable, watering as a **positive integer (days) or
  null**, winterization as a **`YYYY-MM-DD` date or null** (PRD's "none" → `null`). Sources do
  **not** resolve: (1) round-vs-reject for non-integer watering, and (2) whether to parse
  non-ISO date formats. These are plan-time decisions — see **Open Questions**. Do not assert
  the implementation's current choice as if it were the contract.
- **One latent second face of Risk #5 surfaced.** The leading-`YYYY-MM-DD` branch of `asIsoDate`
  returns the captured substring **verbatim without calendar validation**, so a regex-matching
  but calendar-invalid date (e.g. `2024-02-30`) is emitted unchanged — a value the DB `date`
  column would reject. This is exactly the "emits a malformed care profile" face. Flagged below;
  **not** to be fixed in this phase (bug→fix→regression is Lesson 5).
- **No test runner exists.** Standing up Vitest needs only: install `vitest` (3.x, to match the
  repo-wide Vite 7 pin), a `test` script, and a config replicating the `@/*` → `./src/*` alias.
  `environment: "node"` is sufficient for this pure suite.

## Detailed Findings

### 1. The normalizer — where Risk #5 lives (live code)

**`normalizeSuggestion`** — [`src/lib/ai/suggest.ts:137-146`](https://github.com/SzymonSwiatek/PlantsInventory/blob/8a39413798c7396595103f532ceca68645452f56/src/lib/ai/suggest.ts#L137-L146):

```ts
export function normalizeSuggestion(raw: unknown): AiSuggestion {
  const obj = isRecord(raw) ? raw : {};
  return {
    species: asNonEmptyString(obj.species),
    description: asNonEmptyString(obj.description),
    sunlight: asNonEmptyString(obj.sunlight),
    watering_interval_days: asPositiveInt(obj.watering_interval_days),
    winterization_cutoff: asIsoDate(obj.winterization_cutoff),
  };
}
```

Helpers, same file: `isRecord` (`:148`), `asNonEmptyString` (`:169`), `asPositiveInt` (`:177`),
`asIsoDate` (`:187`). Output type `AiSuggestion` — [`src/types.ts:36-42`](https://github.com/SzymonSwiatek/PlantsInventory/blob/8a39413798c7396595103f532ceca68645452f56/src/types.ts#L36-L42).

**Full data path:** browser downscales image (`src/lib/image.ts`) → POST `/api/plants/suggest`
([endpoint `src/pages/api/plants/suggest.ts:18-58`](https://github.com/SzymonSwiatek/PlantsInventory/blob/8a39413798c7396595103f532ceca68645452f56/src/pages/api/plants/suggest.ts#L18-L58))
→ `requestSuggestion` (`src/lib/ai/suggest.ts:59`) calls Gemini → `extractText` → `JSON.parse`
→ **`normalizeSuggestion(parsed)`** → endpoint returns `{ status: "ok", suggestion }` →
`AddPlantForm.applySuggestion(s)` ([`src/components/plants/AddPlantForm.tsx:179-188`](https://github.com/SzymonSwiatek/PlantsInventory/blob/8a39413798c7396595103f532ceca68645452f56/src/components/plants/AddPlantForm.tsx#L179-L188))
binds the five fields into the editable form.

**Purity — confirmed.** Only import is `import type { AiSuggestion }` (`:1`). No `fetch`, no
globals beyond `Date`/`Number`, no `throw` anywhere in `normalizeSuggestion` or its four helpers.
One determinism caveat: the **fallback** branch of `asIsoDate` calls `new Date(<arbitrary string>)`,
whose parsing of non-ISO strings is engine-defined — relevant when choosing what dates to assert
(see Open Question 2). The leading-`YYYY-MM-DD` branch pins `T00:00:00Z`, so it is deterministic.

**Per-field behavior TODAY** (what the code _does_ — for fixture design, not for the expected
column of mirror tests):

| Output field                         | Helper             | `null`/missing/non-record-root | wrong type              | empty/whitespace string          | notable                                                                                                               |
| ------------------------------------ | ------------------ | ------------------------------ | ----------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `species`, `description`, `sunlight` | `asNonEmptyString` | `null`                         | non-string → `null`     | trimmed; `""`/`"  "` → `null`    | extra/unknown keys silently dropped                                                                                   |
| `watering_interval_days`             | `asPositiveInt`    | `null`                         | bool/obj/array → `null` | numeric string coerced (`"7"`→7) | `Math.round` (7.5→8); `≤0`, `NaN`, `Infinity` → `null`                                                                |
| `winterization_cutoff`               | `asIsoDate`        | `null`                         | non-string → `null`     | empty → `null`                   | leading `YYYY-MM-DD` returned **verbatim, no calendar check**; else `new Date(...)→slice(0,10)`; unparseable → `null` |

Top-level guard: `isRecord` is `true` for **arrays** (`typeof [] === "object"`), so an array root
→ treated as a record with no matching keys → all five fields `null`. Primitives/`null` root → `{}`
→ all `null`. **Net: the normalizer never throws and always returns the 5-key object.**

### 2. The oracle — care-profile contract from sources (NOT from the implementation)

Three independent sources, reconciled (none read the normalizer body for expected values):

**PRD** — [`prd.md:166`](https://github.com/SzymonSwiatek/PlantsInventory/blob/8a39413798c7396595103f532ceca68645452f56/context/foundation/prd.md#L166)
(Outputs): _"a structured care profile per plant — species (with the user able to override the
AI's guess), watering interval, light needs, winterization cutoff (a date or 'none'), and a short
prose description."_ Reinforced at `prd.md:55` (US-01 AC), `:117` (FR-009), `:119`/`:121`
(every field editable/overridable, manual create must work → nothing mandatory from the provider).

**Type contract** — [`src/types.ts:36-42`](https://github.com/SzymonSwiatek/PlantsInventory/blob/8a39413798c7396595103f532ceca68645452f56/src/types.ts#L36-L42),
doc comment "All fields nullable — the provider may omit any of them": 5 fields, all nullable;
`watering_interval_days: number | null`; `winterization_cutoff: string | null`; rest strings.

**DB constraints** (the persistence boundary — `supabase/migrations/20260608171954_core_domain_schema.sql`):
`species`/`description`/`sunlight` are nullable `text`, **no enum, no length cap**;
`watering_interval_days integer check (watering_interval_days > 0)` → **positive integer or NULL**;
`winterization_cutoff date` → must be a Postgres-valid date → effectively `YYYY-MM-DD`; the literal
`"none"` or a free-form month name would be **rejected** by the DB.

**The editable form** — `AddPlantForm.tsx`: `watering` input is `type="number" min={1}`,
digits-only `^\d+$` at submit; winterization is an `<input type="date">` (requires `YYYY-MM-DD`)
plus a **"No winterization needed" checkbox** — the UI realization of PRD's "none". So the
normalizer must hand the form a `YYYY-MM-DD` string or `null` — **never** the literal "none" or a
non-date string.

#### Reconciled field-by-field oracle (the contract a test asserts against)

| Field                    | Type             | Required? | Allowed value (oracle)                                                                                                        | When provider omits / sends garbage |
| ------------------------ | ---------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `species`                | `string \| null` | optional  | any non-empty free text                                                                                                       | `null`                              |
| `description`            | `string \| null` | optional  | non-empty free prose (no enforced cap)                                                                                        | `null`                              |
| `sunlight`               | `string \| null` | optional  | non-empty free text                                                                                                           | `null`                              |
| `watering_interval_days` | `number \| null` | optional  | **positive integer ≥ 1** (days). MUST NEVER be 0, negative, non-finite, or non-integer                                        | `null`                              |
| `winterization_cutoff`   | `string \| null` | optional  | a **calendar-valid `YYYY-MM-DD`** date. PRD "none" / non-date → `null`. MUST NEVER be the literal "none" or a non-date string | `null`                              |

**Invariants that hold across the whole input domain (these are the high-signal assertions):**

1. **Never throws** for any input — including `null`, `undefined`, arrays, primitives, and objects
   with missing/extra/wrong-type/null fields.
2. **Always returns an object with exactly these 5 keys**, each value being the typed value or `null`.
3. `watering_interval_days` output is **`null` or a positive integer** — never a value the DB
   `check > 0` (integer) would reject.
4. `winterization_cutoff` output is **`null` or a `YYYY-MM-DD` string** — never `"none"`, never a
   non-date string.
5. Empty/whitespace strings do not become empty-string fields (they become `null`), so the form
   never pre-fills a meaningless blank.

### 3. Provider response shapes — fixtures for the suite

Provider is **Google Gemini `gemini-2.5-flash`** via REST `generateContent`
(`src/lib/ai/suggest.ts:19-20`), with a structured-output `responseSchema` declaring all five
fields `STRING/INTEGER` + `nullable: true` (`:35-44`). The prompt (`:22-33`) instructs:
_"Use null for any field you cannot determine… null is better than a bad value."_ So **null and
missing fields are the expected, normal case — not an exotic edge.**

`requestSuggestion` walks the Gemini envelope with `extractText` (`:152-167`); a missing
`candidates`/`parts`/text part → **throws** "missing JSON text part"; `JSON.parse` of the text
part can throw `SyntaxError`. **All these throws are upstream of the normalizer** and collapse to
`{ status: "ai_unavailable" }` (HTTP 200) at the endpoint — they belong to Risk #1 (AI outage,
Phase 3), not Risk #5. The normalizer's input is _whatever `JSON.parse(text)` yields_, so the unit
fixtures should be the parsed JSON values, e.g.:

- Happy path (all 5 fields valid).
- Missing fields (`{ species: "Monstera" }` → rest `null`).
- Extra/unknown keys (`toxicity`, `hardiness_zones`) → silently dropped.
- Explicit `null` fields (the prompt's intended uncertainty signal).
- Wrong types: numeric string `"7"` for watering; number `12345` for species.
- Empty / whitespace strings.
- Out-of-range watering: `0`, `-5`, `7.5`, `"every few days"`, `Infinity`/`NaN`.
- Dates: valid `YYYY-MM-DD`; `YYYY-MM-DDThh:mm:ssZ`; non-date string; **calendar-invalid
  `2024-02-30`** (see Open Question / latent second face).
- Non-object roots: array `[1,2,3]`, `true`, `"string"`, `null` → all-`null` object.

No fixtures, mocks, or sample responses exist in the repo yet (Phase 1 is unstarted).

### 4. Test-runner bootstrap landscape

- **No runner exists.** `package.json` has no `test` script and no vitest/jest in deps; no
  `*.test.*`, `*.spec.*`, `vitest.config.*`, or standalone `vite.config.*` anywhere. Vite config
  lives inline in `astro.config.mjs`.
- **Constraints to align with:** `"type": "module"` (config must be ESM); repo-wide
  `overrides.vite = "^7.3.2"` → use **Vitest 3.x** (Vite-7 compatible); `tsconfig.json` alias
  `"@/*": ["./src/*"]` with `baseUrl: "."` → Vitest config must replicate this alias (e.g.
  `resolve.alias` or `vite-tsconfig-paths`) or `@/types` won't resolve; `astro.config.mjs`
  `env.schema` declares `SUPABASE_URL`, `SUPABASE_KEY`, `AI_API_KEY` (source of the
  `astro:env/server` virtual module).
- **The normalizer needs none of that env machinery.** Its import graph is type-only and erased
  at compile time, and `astro:env` is imported only by `supabase.ts`, `config-status.ts`, and the
  `/suggest` endpoint — none on the normalizer's path. So: `environment: "node"`, no
  `astro:env/server` stub, no workerd shim. The minimal bootstrap is install + `test` script +
  alias config.
- **Lint:** new `*.test.ts` files fall under the strict `strictTypeChecked` + `stylisticTypeChecked`
  flat config (`projectService: true`); either keep tests type-clean or scope them in ESLint.
  `no-console` is `warn`. CI already runs `npx astro sync` before lint.

## Code References

- `src/lib/ai/suggest.ts:137-146` — `normalizeSuggestion` (the unit under test); helpers `:148`, `:169`, `:177`, `:187-209`.
- `src/types.ts:36-42` — `AiSuggestion` DTO (the declared output contract).
- `src/pages/api/plants/suggest.ts:18-58` — endpoint; all provider throws collapse to `ai_unavailable` (`:49-54`).
- `src/components/plants/AddPlantForm.tsx:179-188` — `applySuggestion`, the form consumer; fields `:334-425`; submit `:209-257`.
- `src/pages/api/plants/index.ts` — persistence boundary; re-runs the posted snapshot through `normalizeSuggestion` and enforces watering `>0` → 400.
- `supabase/migrations/20260608171954_core_domain_schema.sql:51-62` — DB CHECK constraints (`watering_interval_days > 0`; `winterization_cutoff date`).
- `context/foundation/prd.md:55,117,119,121,166` — care-profile contract (the PRD oracle).
- `package.json`, `astro.config.mjs:17-23`, `tsconfig.json:8-11`, `eslint.config.js` — Vitest bootstrap constraints.

## Architecture Insights

- **The normalizer is the deliberate provider-agnostic seam.** Its header docstring
  (`suggest.ts:1-17`) states the API key is injected by the caller so the module imports nothing
  from `astro:env`/network at the top level — "swapping providers later should touch only this
  file." This is _why_ it is unit-testable in isolation, and the test should protect that property.
- **Defense in depth on the care profile.** The same coercion runs twice: at suggestion time
  (`/suggest`) and again at save time (`/api/plants` re-normalizes the posted snapshot). The DB
  `check > 0` and `date` column are the final backstop. The unit suite protects the _first_ layer;
  the DB constraints are the oracle for _why_ the coercions exist.
- **Risk #5 vs Risk #1 boundary.** "Normalizer throws" sounds like Risk #5, but every actual throw
  is upstream in the provider seam and is owned by the AI-outage path (Risk #1 / Phase 3). Phase 1
  should assert the _pure_ normalizer never throws and emits a contract-valid profile — not the
  endpoint's outage behavior.

## Historical Context (from prior changes)

- `context/archive/2026-06-08-first-plant-from-photo/plan.md:223,239,418` — the **S-01 plan**.
  Specifies the contract as a _source_ (predates the code): "Export pure `normalizeSuggestion`…
  all nullable, `watering_interval_days` → positive int or null, `winterization_cutoff` → ISO
  `YYYY-MM-DD` or null"; acceptance "pure export… verified against a missing-field and an
  extra-field payload"; Progress "[x] handles missing/extra fields without throwing — d699847".
  This is the documentary basis for invariants 1–4 above and for "the normalizer is pure" cited in
  `change.md`.
- `context/archive/2026-06-04-domain-schema-with-rls/plan.md:82,209` — where `AiSuggestion` and the
  `plants` care-profile columns were defined; confirms `sunlight` is **free text, not an enum**, and
  `winterization_cutoff` NULL = "none".
- `context/archive/2026-06-08-first-plant-from-photo/research.md:80-88` — "This is the contract the
  AI provider response should be normalized into."
- `context/changes/deployment/` and `context/changes/bootstrap-verification/` — no test-runner
  relevance (only manual smoke-testing mentions).

## Open Questions (decisions for `/10x-plan` — do NOT bake a mirror assertion)

These are the points where sources do **not** unambiguously fix the expected value. The lesson's
oracle rule says to assert the _property_ the sources guarantee, and flag the rest for a decision
rather than asserting "whatever the code currently does."

1. **Non-integer watering — round or reject?** Sources guarantee only "positive integer or null."
   `7.5` → `8` (current `Math.round`) and `7.5` → `null` both satisfy that. **Recommendation:**
   assert the _property_ (`out === null || (Number.isInteger(out) && out >= 1)`), which catches
   the real regression (0, −5, 7.5-as-7.5, NaN reaching the DB) without pinning round-vs-reject.
   Decide explicitly whether to additionally pin the rounding behavior.

2. **Non-ISO date formats — parse or null?** Sources require the _output_ to be `YYYY-MM-DD` or
   `null`; they do not mandate accepting `"October 1, 2026"` or `"2026/10/01"`. The current
   fallback `new Date(<arbitrary>)` is **engine-defined** (a flakiness risk across Node/workerd).
   **Recommendation:** assert only deterministic cases — a valid leading `YYYY-MM-DD` → that date;
   `"none"`/garbage → `null`; output is always `YYYY-MM-DD` or `null`. Decide whether non-ISO
   parsing is a contract worth pinning (and on which engine).

3. **Latent second face of Risk #5 — calendar-invalid dates pass through.** `asIsoDate`'s
   leading-regex branch returns `2024-02-30` **verbatim** (regex matches; JS `Date` rolls it over,
   so the validity check passes), yet the DB `date` column would reject `2024-02-30`. So the
   normalizer _can_ emit a malformed care profile — the exact thing Risk #5 fears. **Surface only,
   do not fix here** (bug→fix→regression-test is Lesson 5). The plan should decide whether to add a
   _characterization_ test documenting current behavior, or escalate the gap to a Lesson-5 change.

4. **Does the normalizer itself trim / null empty strings, or rely on downstream?** The form and
   `/api/plants` (`emptyToNull`) already trim. The contract only guarantees the _persisted_ value is
   clean. Since this suite tests the normalizer **in isolation**, asserting its own empty→`null`
   behavior is reasonable (it matches the form's expectation), but confirm that's the intended layer.

## Related Research

- `context/archive/2026-06-08-first-plant-from-photo/research.md` — original AI-seam research (the contract origin).
- `context/foundation/test-plan.md` §2 (Risk #5 row, `:74`), §3 Phase 1, §6.1 cookbook target.
