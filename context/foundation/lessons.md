# Lessons Learned

<!-- p3-gate-docs-only: throwaway comment for gate-check 3.4 — will be removed -->

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## CSRF guards on session-mutation routes after disabling global checkOrigin

- **Context**: src/lib/api.ts:51-64 (`requireSameOrigin`); applies to every cookie-session mutation route under src/pages/api/*. Astro's global `security.checkOrigin` is disabled (to allow the RFC 8058 one-click unsubscribe POST), so per-route guarding is the only CSRF defense.
- **Problem**: `requireSameOrigin` fails OPEN when the `Origin` header is absent (returns null/allows) — deliberate, so the no-Origin one-click POST and non-browser callers pass. Easy to misread as "missing Origin is rejected." Equally, disabling the global guard silently strips CSRF protection from EVERY mutation route, so any new route is unprotected unless it explicitly opts in.
- **Rule**: Every new cookie-session mutation handler (POST/PUT/PATCH/DELETE) MUST call `requireSameOrigin` at the top, before `requireUser`. Routes that authenticate by token (unsubscribe) or are read-only are exempt. Treat the missing-Origin fail-open as intentional and documented — do not "fix" it without accounting for the one-click unsubscribe flow.
- **Applies to**: src/pages/api/**/*.ts (all mutation handlers)
