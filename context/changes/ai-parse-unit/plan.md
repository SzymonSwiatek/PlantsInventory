# Bootstrap Test Runner + AI-Parse Normalizer Unit Suite — Implementation Plan

## Overview

Rollout Phase 1 of `context/foundation/test-plan.md` §3. Stand up the project's
first test runner (Vitest) and write a unit suite that proves the AI suggestion
normalizer `normalizeSuggestion` (`src/lib/ai/suggest.ts:137`) **never throws** and
**always emits a contract-valid `AiSuggestion`** across every shape the provider can
return (missing, extra, null, wrong-typed, out-of-range fields; non-object roots).
This covers Risk #5 (Medium impact × High likelihood).

The oracle — what the normalizer *should* output — comes from the PRD care-profile
contract, the `AiSuggestion` type, and the DB CHECK constraints (research.md §2),
**not** from re-reading the function's current output.

## Current State Analysis

- **No test runner exists.** `package.json` has no `test` script; no vitest/jest in
  deps; no `*.test.*`, `*.spec.*`, or `vitest.config.*` anywhere. Vite config lives
  inline in `astro.config.mjs:13-15`.
- **The unit under test is pure and isolation-friendly.** `normalizeSuggestion`'s only
  import is `import type { AiSuggestion }` (`suggest.ts:1`) — type-erased at compile.
  Its four helpers (`isRecord`, `asNonEmptyString`, `asPositiveInt`, `asIsoDate`) have
  no `throw`, no `fetch`, no `astro:env` import. So the suite needs **no
  `astro:env/server` stub and no workerd shim** — `environment: "node"` suffices.
- **The throws live upstream.** `requestSuggestion`/`extractText`/`JSON.parse`
  (`suggest.ts:59-108`, `152-167`) throw on provider/transport/parse failures; the
  endpoint catches them → `ai_unavailable`. Those belong to Risk #1 (Phase 3), not here.
  The normalizer's input is *whatever `JSON.parse(text)` yields* — so the unit fixtures
  are parsed-JSON values.
- **Bootstrap constraints:** `"type": "module"` (config must be ESM); repo-wide
  `overrides.vite = "^7.3.2"` → use **Vitest 3.x** (Vite-7 compatible); `tsconfig.json`
  alias `"@/*": ["./src/*"]` must be replicated for Vitest runtime resolution; lint is
  `strictTypeChecked` + `stylisticTypeChecked` with `projectService: true` and
  `include: ["**/*"]`, so the new `*.test.ts` and config files are type-checked and must
  stay type-clean.

### Key Discoveries

- `src/lib/ai/suggest.ts:137-146` — `normalizeSuggestion` (unit under test). Helpers at
  `:148` (`isRecord`), `:169` (`asNonEmptyString`), `:177` (`asPositiveInt`), `:187`
  (`asIsoDate`).
- `src/types.ts:36-42` — `AiSuggestion`, the declared 5-field nullable output contract.
- `supabase/migrations/20260608171954_core_domain_schema.sql:51-62` — DB CHECK
  constraints (`watering_interval_days > 0` integer; `winterization_cutoff date`) — the
  *why* behind the coercions, and the reason `"none"`/`2024-02-30` must never be emitted.
- `context/foundation/prd.md:55,117,119,121,166` — the PRD care-profile oracle.
- `asIsoDate` leading-regex branch (`suggest.ts:196-202`) returns a regex-matching but
  **calendar-invalid** date (`2024-02-30`) verbatim — the latent second face of Risk #5.
- `asIsoDate` fallback branch (`suggest.ts:204-207`) calls `new Date(<arbitrary>)` then
  `.toISOString().slice(0,10)` — **timezone-dependent** for non-ISO inputs (parsed as
  local time, then shifted to UTC).

## Desired End State

`npm test` runs a green Vitest suite. The suite asserts, against an oracle drawn from
sources, that `normalizeSuggestion`:

1. never throws for any input (null, undefined, arrays, primitives, objects with
   missing/extra/wrong-type/null fields);
2. always returns an object with exactly the five `AiSuggestion` keys, each a typed
   value or `null`;
3. emits `watering_interval_days` as `null` or a positive integer (never 0, negative,
   non-finite, or non-integer);
4. emits `winterization_cutoff` as `null` or a `YYYY-MM-DD` string (never `"none"` or a
   non-date string), with the **known** calendar-invalid-passthrough gap documented;
5. maps empty/whitespace strings to `null` so the form never pre-fills a blank.

Cookbook §6.1 documents the pattern; §6.6 records the calendar-invalid gap as a
Lesson-5 candidate; §4 pins the Vitest version; §3 Phase 1 reads `complete`.

Verify: `npm test` exits 0; `npm run lint` and `npx astro sync && npm run build` stay
green; the four test-plan edits are present and links resolve.

## What We're NOT Doing

- **Not fixing** the calendar-invalid-date passthrough (`2024-02-30`). That is a
  bug→fix→regression change (Lesson 5). This phase only *documents* it with a
  characterization test and a §6.6 escalation note.
- **Not testing** `requestSuggestion`, `extractText`, retries, or the `/suggest`
  endpoint's `ai_unavailable` degradation — that is Risk #1 / Phase 3 (fault injection).
- **Not** standing up local Supabase, MSW, Playwright, or any integration/e2e infra —
  Phases 2–3 of the rollout.
- **Not wiring** the suite into CI as a required gate — that is rollout Phase 4.
- **Not installing or wiring Stryker.** Mutation testing stays an optional, ad-hoc
  selective gate (test-plan §1 / CLAUDE.md), runnable manually but not part of this scope.
- **Not** asserting AI suggestion *quality* (is the species guess correct?) — explicitly
  excluded in test-plan §7.

## Implementation Approach

Three phases that match the executor split CLAUDE.md recommends:

1. **Bootstrap (infra)** via `/10x-implement` — install Vitest, add config + scripts +
   a `TZ=UTC` setup file, and a single smoke test that import-resolves the module
   through the `@` alias. This proves the runner works *and* that the normalizer needs
   no env machinery, before any contract assertions are written.
2. **Contract suite (oracle assertions)** via `/10x-tdd` — each behavior is a nameable
   red test, expanded in the same test file. Assert the cross-domain invariants as
   parameterised tables, then the decided coercion policies.
3. **Cookbook + sync (docs)** via `/10x-implement` — fill the cookbook, escalate the
   gap, pin versions, update rollout status.

**Decided coercion-test policies (from planning, grounding the Phase 2 assertions):**

- **Watering:** assert the property `out === null || (Number.isInteger(out) && out >= 1)`
  across all inputs (the high-signal, DB-derived invariant), **and** pin the intended
  coercions `"7" → 7` and `7.5 → 8` (round-to-nearest is the chosen contract).
- **Dates:** assert deterministic cases (leading `YYYY-MM-DD` passthrough; ISO datetime
  `2026-10-01T..` → `2026-10-01`; `"none"`/garbage → `null`) and the output-shape
  invariant; **additionally** pin the non-ISO `new Date()` fallback on Node
  (`"2026/10/01" → "2026-10-01"`), made deterministic by `TZ=UTC` and commented as
  Node+UTC-scoped (not guaranteed on workerd).
- **Calendar-invalid:** one labeled characterization test (`"2024-02-30"` → `"2024-02-30"`)
  documenting the known gap.
- **Empty strings:** assert `""`/`"  "` → `null` for `species`/`description`/`sunlight`
  at the normalizer layer.

## Critical Implementation Details

- **`TZ=UTC` is load-bearing for the date assertions.** `asIsoDate`'s fallback
  (`new Date("2026/10/01")`) parses non-ISO strings as **local** time, then
  `.toISOString().slice(0,10)` shifts to UTC — so on a host in UTC+2 (e.g. Poland) the
  result would be `2026-09-30`, a flaky test. Pin the runner timezone to UTC in a setup
  file so these assertions are stable cross-machine. The leading-`YYYY-MM-DD` branch is
  already TZ-independent (it pins `T00:00:00Z` only for the validity check and returns
  the captured substring), so only the fallback cases need this.
- **Keep tests type-clean.** Import `{ describe, it, expect }` explicitly from `"vitest"`
  rather than relying on globals — this avoids adding `vitest/globals` to `tsconfig`
  `types` and keeps the strict `projectService` lint pass green without extra config.
- **The `@` alias must be replicated for Vitest's runtime resolver.** The test file's own
  `import { normalizeSuggestion } from "@/lib/ai/suggest"` is a real runtime import;
  `tsconfig` paths are not consulted by Vitest at runtime, so `vitest.config.ts` needs an
  explicit `resolve.alias`.

---

## Phase 1: Bootstrap the Vitest runner

### Overview

Install Vitest 3.x and create the minimal configuration that lets a Node-environment
unit suite import `@/*` modules, with the timezone pinned. Prove the wiring with a single
smoke test that import-resolves the normalizer — confirming no `astro:env`/workerd shim
is required.

### Changes Required:

#### 1. Add Vitest and test scripts

**File**: `package.json`

**Intent**: Add `vitest` (3.x, to match the `vite ^7.3.2` override) as a devDependency
and expose `test` (watch) + `test:run` (single-run, for CI/automation parity) scripts.

**Contract**: `scripts.test` and `scripts.test:run` invoke Vitest; `devDependencies`
gains `vitest` pinned to a 3.x range. `test:run` is the command automated verification
calls (`vitest run`).

#### 2. Vitest config

**File**: `vitest.config.ts` (new, repo root)

**Intent**: Configure a Node-environment test run that resolves the `@/*` alias and loads
the timezone setup file. ESM (`"type": "module"`), type-clean under the strict flat lint.

**Contract**: `defineConfig` from `vitest/config` with `test.environment = "node"`,
`test.setupFiles = ["./vitest.setup.ts"]`, and `resolve.alias` mapping `@` →
`<root>/src` (via `fileURLToPath(new URL("./src", import.meta.url))`). No `astro:env`
stub, no workerd shim.

#### 3. Timezone setup file

**File**: `vitest.setup.ts` (new, repo root)

**Intent**: Pin the process timezone to UTC so `asIsoDate`'s `new Date()` fallback is
deterministic across machines (see Critical Implementation Details).

**Contract**: Sets `process.env.TZ = "UTC"` at module load (before any test `Date` use).

#### 4. Smoke test

**File**: `src/lib/ai/suggest.test.ts` (new)

**Intent**: Prove the runner + alias + isolation work end to end: import
`normalizeSuggestion` through the `@` alias and assert it is callable and returns an
object with exactly the five `AiSuggestion` keys for an empty object `{}`. This block
becomes the foundation the Phase 2 suite expands.

**Contract**: `import { normalizeSuggestion } from "@/lib/ai/suggest"` resolves and runs
without any env mock; `normalizeSuggestion({})` returns
`{ species: null, description: null, sunlight: null, watering_interval_days: null, winterization_cutoff: null }`.

### Success Criteria:

#### Automated Verification:

- Vitest is installed and `npm run test:run` executes the smoke test and exits 0
- The smoke test confirms the module imports with no `astro:env`/workerd shim
- Linting passes on the new files: `npm run lint`
- Type sync + build still pass: `npx astro sync && npm run build`

#### Manual Verification:

- `npm test` (watch mode) starts cleanly and re-runs on change
- No stray test-runner output or config warnings in the terminal

**Implementation Note**: After completing this phase and all automated verification
passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: The contract suite

### Overview

Expand `src/lib/ai/suggest.test.ts` into the full oracle-driven suite: the cross-domain
invariants as parameterised tables, then the decided coercion policies, then the labeled
calendar-invalid characterization test. Every assertion derives from sources
(PRD / type / DB), not from the implementation's current output.

### Changes Required:

#### 1. Invariant tables (never-throws, 5-key shape, types)

**File**: `src/lib/ai/suggest.test.ts`

**Intent**: Assert the high-signal invariants that hold across the entire input domain,
using `it.each` over a hostile-input table so each row catches a distinct regression.

**Contract**: A fixture table covering: valid happy-path object; `{ species: "Monstera" }`
(rest → `null`); extra keys (`toxicity`, `hardiness_zones`) dropped; explicit-`null`
fields; non-object roots (`null`, `undefined`, `true`, `"string"`, `[1,2,3]`). For every
row assert (a) the call does not throw, (b) the result has exactly the five keys, (c)
each value is the correct type or `null`. Array root → all five `null` (the `isRecord`
true-for-arrays path).

#### 2. Watering policy

**File**: `src/lib/ai/suggest.test.ts`

**Intent**: Protect the DB-derived invariant and pin the chosen coercion contract.

**Contract**: An `it.each` property test over `0`, `-5`, `7.5`, `"7"`, `"every few days"`,
`Infinity`, `NaN`, `12`, `true`, `null` asserting
`out === null || (Number.isInteger(out) && out >= 1)`. Plus two pinned-value assertions:
`"7" → 7` and `7.5 → 8`. Out-of-range and non-numeric → `null`.

#### 3. Date policy

**File**: `src/lib/ai/suggest.test.ts`

**Intent**: Assert the deterministic date contract and the non-ISO fallback (Node+UTC),
plus the output-shape invariant.

**Contract**: `"2026-10-01" → "2026-10-01"`; `"2026-10-01T08:30:00Z" → "2026-10-01"`;
`"none"` and `"sometime in autumn"` → `null`; non-string → `null`. Non-ISO fallback
(pinned, TZ=UTC, commented Node-scoped): `"2026/10/01" → "2026-10-01"`. Across all date
fixtures assert the output is `null` or matches `/^\d{4}-\d{2}-\d{2}$/`. Never `"none"`.

#### 4. Empty/whitespace string policy

**File**: `src/lib/ai/suggest.test.ts`

**Intent**: Assert the normalizer's own empty→`null` behavior (invariant #5) at the layer
under test.

**Contract**: `{ species: "", description: "  ", sunlight: "\t" }` → all three `null`.
A non-empty string with surrounding whitespace is trimmed (e.g. `"  Monstera  " → "Monstera"`).

#### 5. Calendar-invalid characterization test

**File**: `src/lib/ai/suggest.test.ts`

**Intent**: Document — not fix — the known second face of Risk #5: a regex-matching but
calendar-invalid date passes through verbatim.

**Contract**: A test clearly commented as `KNOWN GAP (Risk #5, 2nd face) — to be fixed
under a Lesson-5 change` asserting `{ winterization_cutoff: "2024-02-30" }` →
`"2024-02-30"` (current behavior; the DB `date` column would reject this value).
References the §6.6 escalation note.

### Success Criteria:

#### Automated Verification:

- Full suite passes: `npm run test:run` exits 0
- Every research §3 fixture class is represented (happy, missing, extra, null,
  wrong-type, empty, out-of-range watering, the date variants, non-object roots)
- Linting passes on the suite: `npm run lint`
- Type sync + build still pass: `npx astro sync && npm run build`

#### Manual Verification:

- Each invariant table row is independently meaningful (no six-near-identical copies)
- The calendar-invalid test is unambiguously labeled as documenting a known gap, not a
  desired contract
- (Optional, ad-hoc) `npx stryker run --mutate "src/lib/ai/suggest.ts"` shows no
  *meaningful* survived mutant in `normalizeSuggestion` and its helpers; cosmetic/
  equivalent mutants ignored consciously (not a gate)

**Implementation Note**: After completing this phase and all automated verification
passes, pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Cookbook + test-plan sync

### Overview

Record the reusable pattern and update the rollout state so the test-plan reflects a
shipped Phase 1.

### Changes Required:

#### 1. Cookbook §6.1 — unit-test pattern

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.1 "TBD" with the concrete normalizer-contract pattern.

**Contract**: §6.1 documents: pure-function unit test, `environment: "node"`, no
`astro:env`/workerd shim; oracle from PRD care-profile + type + DB CHECK (never a
snapshot); invariant tables via `it.each` (never-throws / 5-key / type); property +
pinned-coercion split for watering; deterministic date assertions + `TZ=UTC` for the
non-ISO fallback; empty→`null` at the normalizer layer.

#### 2. §6.6 — calendar-invalid escalation note

**File**: `context/foundation/test-plan.md`

**Intent**: Escalate the latent gap as a future Lesson-5 candidate so it is not lost.

**Contract**: A 2–3 line §6.6 note: `asIsoDate` emits calendar-invalid `YYYY-MM-DD`
(e.g. `2024-02-30`) verbatim; the DB `date` column would reject it; documented by a
characterization test in `suggest.test.ts`; candidate for a bug→fix→regression change.

#### 3. §4 — pin the Vitest version

**File**: `context/foundation/test-plan.md`

**Intent**: Replace "none yet — see §3 Phase 1" for the unit/integration row with the
installed version.

**Contract**: §4 unit+integration row shows the pinned Vitest 3.x version actually
installed in `package.json`, with `checked:` date.

#### 4. §3 — flip Phase 1 status

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect the shipped phase in the rollout table.

**Contract**: §3 Phase 1 `Status` → `complete`; `Change folder` → `ai-parse-unit`.

#### 5. Stamp the change identity

**File**: `context/changes/ai-parse-unit/change.md`

**Intent**: Mark the change implemented.

**Contract**: `status` → `complete` (or `implementing` until Phase 3 lands), `updated` →
the landing date.

### Success Criteria:

#### Automated Verification:

- `context/foundation/test-plan.md` §6.1, §6.6, §4, §3 edits are present
- Markdown formatting passes: `npx prettier --check context/foundation/test-plan.md context/changes/ai-parse-unit/change.md`
- No remaining "TBD — see §3 Phase 1" in §6.1

#### Manual Verification:

- The §6.1 pattern is specific enough that a contributor could add the next unit test
  without re-reading this plan
- §6.6 note correctly frames the gap as documented-not-fixed
- §3 status and change folder match reality

**Implementation Note**: Final phase — confirm the rollout table and cookbook read
correctly before closing the change.

---

## Testing Strategy

### Unit Tests:

- `normalizeSuggestion` contract across all provider shape variants (this entire plan).
- Key edge cases: non-object roots; explicit-`null` fields; out-of-range watering
  (`0`, `-5`, `7.5`, `NaN`, `Infinity`); non-ISO and calendar-invalid dates; empty/
  whitespace strings; extra/unknown keys.

### Integration Tests:

- None in this phase. Risk #5 is owned by a pure function; integration would add setup
  cost with no added signal (test-plan §1 cost×signal; research §4).

### Manual Testing Steps:

1. `npm test` — watch mode starts, suite is green.
2. Temporarily break a helper (e.g. make `asPositiveInt` drop the `> 0` check) and
   confirm the watering property test goes red — proves the suite has teeth.
3. Confirm the calendar-invalid characterization test is green *and* clearly labeled.

## Performance Considerations

None. A pure-function unit suite runs in milliseconds; `environment: "node"` avoids
jsdom/workerd startup cost.

## Migration Notes

First test runner in the repo — additive only. No existing tests to migrate. CI wiring
is deferred to rollout Phase 4 (`npm run test:run` is the command that phase will adopt).

## References

- Research (oracle source): `context/changes/ai-parse-unit/research.md`
- Change identity: `context/changes/ai-parse-unit/change.md`
- Test plan: `context/foundation/test-plan.md` §2 (Risk #5), §3 Phase 1, §4, §6.1
- Unit under test: `src/lib/ai/suggest.ts:137-209`
- Output contract: `src/types.ts:36-42`
- DB constraints (the why): `supabase/migrations/20260608171954_core_domain_schema.sql:51-62`
- S-01 plan (contract origin): `context/archive/2026-06-08-first-plant-from-photo/plan.md:223,239,418`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Bootstrap the Vitest runner

#### Automated

- [x] 1.1 Vitest installed and `npm run test:run` executes the smoke test and exits 0
- [x] 1.2 Smoke test confirms the module imports with no `astro:env`/workerd shim
- [x] 1.3 Linting passes on the new files: `npm run lint`
- [x] 1.4 Type sync + build still pass: `npx astro sync && npm run build`

#### Manual

- [x] 1.5 `npm test` watch mode starts cleanly and re-runs on change
- [x] 1.6 No stray test-runner output or config warnings

### Phase 2: The contract suite

#### Automated

- [ ] 2.1 Full suite passes: `npm run test:run` exits 0
- [ ] 2.2 Every research §3 fixture class is represented
- [ ] 2.3 Linting passes on the suite: `npm run lint`
- [ ] 2.4 Type sync + build still pass: `npx astro sync && npm run build`

#### Manual

- [ ] 2.5 Each invariant table row is independently meaningful (no redundant copies)
- [ ] 2.6 Calendar-invalid test is unambiguously labeled as documenting a known gap
- [ ] 2.7 (Optional) Stryker shows no meaningful survived mutant in the normalizer

### Phase 3: Cookbook + test-plan sync

#### Automated

- [ ] 3.1 §6.1, §6.6, §4, §3 edits present in `test-plan.md`
- [ ] 3.2 Markdown formatting passes: `npx prettier --check` on the edited docs
- [ ] 3.3 No remaining "TBD — see §3 Phase 1" in §6.1

#### Manual

- [ ] 3.4 §6.1 pattern is specific enough to add the next unit test unaided
- [ ] 3.5 §6.6 note frames the gap as documented-not-fixed
- [ ] 3.6 §3 status and change folder match reality
