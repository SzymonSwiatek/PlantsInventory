<!-- PLAN-REVIEW-REPORT -->
# Plan Review: AI Chat for Plant Disease Diagnosis

- **Plan**: context/changes/ai-chat-plant-disease-diagnosis/plan.md
- **Mode**: Deep
- **Date**: 2026-06-30
- **Verdict**: REVISE → SOUND (all 5 findings fixed in triage 2026-06-30)
- **Findings**: 0 critical · 4 warnings · 1 observation (all FIXED)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

10/10 paths ✓, symbols ✓ (suggest.ts seam, api.ts guards, NavBar navItems :18-22 + active union :9 + icon block :181-225, AddPlantForm picker :267-322, AiSuggestion :52), brief↔plan ✓, Progress↔Phase ✓ (1.1–1.8, 2.1–2.12 all map).

Resolved open question: `Topbar.astro` is still used, but only by `Welcome.astro` → `src/pages/index.astro` (public landing), not the app shell. The plan's conclusion (use `NavBar` for `/ask`) is correct; the Phase 2 §4 "confirm whether..." TBD can be dropped. Not scored as a finding.

## Findings

### F1 — Image grounding on follow-up turns is contradictory

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment / Blind Spots
- **Location**: Critical Implementation Details + Phase 1 §2 + Phase 2 §2 + Performance Considerations
- **Detail**: The plan describes the image's lifetime three inconsistent ways: (a) Critical Details — client "sends the complete contents array ... on every request; the first user turn carries the inlineData image block" (implies image rides every turn); (b) Phase 2 §2 — "POST /api/diagnose with the full messages (+ image on first turn)" (implies first request only); (c) Performance — "later turns are text-only ... keeps follow-ups cheap." The endpoint is stateless and rebuilds the Gemini `contents` from a text-only `messages[]` plus a separate `image?` field each call (Phase 1 §2). If `image` is sent only on the first request, every follow-up turn reaches Gemini with NO inlineData — the diagnosis loses visual grounding from turn 2 onward, surviving only as whatever the model wrote into its first text reply. This silently undercuts the stated end state ("photo-grounded ... multi-turn diagnosis"). An implementer following the Phase 2 shorthand literally ships the degraded path.
- **Fix**: Resend the image on every request — client always includes the `image` field; server always prepends `inlineData` to the first user turn it reconstructs. The downscaled image is well under 1 MB (maxEdge=1024, q0.8), so per-turn cost is acceptable and the design stays cleanly stateless. Update the Performance note (drop "later turns are text-only / cheaper"), make Phase 2 §2 say "image resent every request," and reconcile Phase 1 §2's "first turn must include image" to "every request must include image."
  - Strength: Only stateless-correct option; keeps grounding on every turn; matches the suggest.ts base64-to-AI posture exactly.
  - Tradeoff: ~1 MB travels per follow-up turn (bounded by the turn cap).
  - Confidence: HIGH — stateless endpoint + text-only messages[] leaves no other place for the image to live across turns.
  - Blind spot: None significant.
- **Decision**: FIXED — applied resend-every-request; reconciled Critical Impl Details, Phase 1 §1/§2, Phase 2 §2, and Performance Considerations.

### F2 — maxOutputTokens on gemini-2.5-flash can return empty replies

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 (diagnose seam, MAX_OUTPUT_TOKENS)
- **Detail**: The model is `gemini-2.5-flash` (suggest.ts:19), a reasoning model with thinking enabled by default. `maxOutputTokens` caps total output tokens INCLUDING internal thinking tokens. If MAX_OUTPUT_TOKENS is sized as a tight prose ceiling, the model can spend the budget on thinking and return a candidate with finishReason=MAX_TOKENS and NO text part. The reused `extractText` returns null on a missing text part → the seam throws → the endpoint degrades to `ai_unavailable` even though the API call "succeeded." suggest.ts never hit this (JSON schema, no maxOutputTokens), so this is a net-new failure mode the plan introduces but doesn't address.
- **Fix**: Disable/bound thinking explicitly — set `generationConfig.thinkingConfig.thinkingBudget = 0` (deterministic prose, no thinking spend) and size MAX_OUTPUT_TOKENS for the visible reply alone; OR keep thinking but budget MAX_OUTPUT_TOKENS to cover thinking + prose. Either way, add a fault-test case for the empty-candidate / MAX_TOKENS path so it's a known, tested outcome.
  - Strength: thinkingBudget=0 makes cost and latency predictable and the token ceiling actually mean "reply length."
  - Tradeoff: Disabling thinking may slightly reduce diagnosis quality.
  - Confidence: HIGH — documented Gemini 2.5 behavior; current cutoff.
  - Blind spot: Quality delta of thinking-off for this prompt unmeasured.
- **Decision**: FIXED (Fix differently) — kept dynamic thinking, set MAX_OUTPUT_TOKENS=2500 to cover thinking + prose, documented the thinking-token interaction in Phase 1 §1, and added an empty-candidate/MAX_TOKENS fault test (§4 + Success Criteria 1.3 + Testing Strategy).

### F3 — "Reuse" of image guards is undefined; helpers are private to suggest.ts

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness / Plan Completeness
- **Location**: Phase 1 §2 ("reuse ALLOWED_MIME_TYPES ... and MAX_IMAGE_BYTES")
- **Detail**: The plan repeatedly says to "reuse" the image guards "from the suggest conventions," but ALLOWED_MIME_TYPES, MAX_IMAGE_BYTES, isLikelyBase64, decodedByteLength, and readString are all module-PRIVATE in src/pages/api/plants/suggest.ts (verified: none exported, none in src/lib/api.ts). The implementer must pick extract-and-share vs. copy-paste, and the plan gives no direction.
- **Fix A ⭐ Recommended**: Extract the shared validators + constants — move ALLOWED_MIME_TYPES, MAX_IMAGE_BYTES, isLikelyBase64, decodedByteLength (and readString) into a small shared module (e.g. src/lib/ai/image-guards.ts) and import from both endpoints; name it as a Phase 1 step.
  - Strength: Single source for the security ceiling both paid-AI endpoints depend on; the validators are pure (unlike the stateful upload fns the plan deliberately leaves duplicated).
  - Tradeoff: Touches suggest.ts (small, low-risk blast radius).
  - Confidence: HIGH — pure functions, no behavior change.
  - Blind spot: None significant.
- **Fix B**: Duplicate the constants/helpers into the diagnose endpoint.
  - Strength: Zero blast radius; matches the plan's stated bias against refactoring duplication ("What We're NOT Doing").
  - Tradeoff: Two copies of a security limit drift apart over time.
  - Confidence: HIGH — trivial.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — added Phase 1 §1 "Extract shared image-validation helpers" (new src/lib/ai/image-guards.ts), renumbered seam/endpoint/types/tests to §2–§5, and pointed the diagnose endpoint at the shared module.

### F4 — Cost-control constants left as "e.g."/unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1/§2 + Critical Implementation Details
- **Detail**: The feature's entire v1 justification is cost control, yet none of the three ceilings are pinned: MAX_OUTPUT_TOKENS ("a bounded constant, e.g."), MAX_TURNS ("a fixed number of turns"), and the request budget ("more generous than suggest's 12s ... but finite"). The implementer guesses the cost ceiling, and the token value interacts with F2.
- **Fix**: Pin concrete defaults in Phase 1 (e.g. MAX_TURNS = 10, MAX_OUTPUT_TOKENS sized per F2, AI_TIMEOUT_MS = 30_000) so the cost ceiling is reviewable as a value, not a placeholder.
- **Decision**: FIXED — pinned MAX_TURNS=10, AI_TIMEOUT_MS=30_000 (MAX_OUTPUT_TOKENS=2500 from F2); summarized the three ceilings in Critical Implementation Details.

### F5 — Turn-cap rejection status is ambiguous / semantically off

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §2 ("messages.length <= MAX_TURNS (413/400 on exceed)")
- **Detail**: Over-cap is specced as "(413/400 on exceed)" — two codes, pick-one unclear — and 413 Payload Too Large is an odd fit for a turn count (413 already means oversized image here). The fault-test contract just says "rejected."
- **Fix**: Use 400 with a distinct error code (e.g. "turn_limit_exceeded"), reserving 413 for the image-size guard; state it once.
- **Decision**: FIXED — over-cap → 400 `turn_limit_exceeded` in Phase 1 §3, Testing Strategy, and the §5 fault-test contract; 413 reserved for image size.
