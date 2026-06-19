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
