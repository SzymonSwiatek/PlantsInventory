import type { APIContext } from "astro";
import type { User } from "@supabase/supabase-js";

/**
 * JSON-response + in-endpoint auth-guard conventions shared by every JSON
 * endpoint this slice introduces (`/api/plants/*`). `/api/*` routes are
 * outside the middleware's PROTECTED_ROUTES, so each endpoint self-guards.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// SQLSTATE codes that mean "the client sent something we won't persist" rather
// than a server fault: 23514 check_violation (name length, watering > 0, the
// same-user FK guard trigger), 23503 foreign_key_violation, 42501 RLS denial.
export const CLIENT_ERROR_CODES = new Set(["23514", "23503", "42501"]);

/** Build a JSON `Response` with the right content type. */
export function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Resolve the signed-in user from middleware-populated `context.locals`, or a
 * 401 JSON `Response` the caller must short-circuit on:
 *
 *   const user = requireUser(context);
 *   if (user instanceof Response) return user;
 */
export function requireUser(context: APIContext): User | Response {
  const user = context.locals.user;
  if (!user) {
    return json({ error: "unauthorized" }, 401);
  }
  return user;
}

/**
 * Guard against cross-origin mutation requests. Returns a 403 Response when the
 * `Origin` header is present but does not match the request host; returns `null`
 * when same-origin or when Origin is absent (non-browser / same-origin requests
 * often omit it). Call this at the top of every session-mutation route now that
 * Astro's global `security.checkOrigin` is disabled (it blocked the RFC 8058
 * one-click unsubscribe POST).
 *
 *   const originErr = requireSameOrigin(context.request);
 *   if (originErr) return originErr;
 */
export function requireSameOrigin(request: Request): Response | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  try {
    const reqHost = new URL(request.url).host;
    const originHost = new URL(origin).host;
    if (originHost !== reqHost) {
      return json({ error: "forbidden" }, 403);
    }
  } catch {
    return json({ error: "forbidden" }, 403);
  }
  return null;
}
