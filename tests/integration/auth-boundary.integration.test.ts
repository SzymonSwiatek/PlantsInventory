import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startServer, type ServerHandle } from "./helpers/server";

// Phase 4: Risk #3 — auth-boundary (real SSR server).
//
// Boots the real SSR app with local Supabase wired, then fetches each route /
// endpoint with NO cookie and with an INVALID cookie, asserting the
// heterogeneous deny contract:
//
//   Protected pages (/dashboard, /locations/*) → 302 to /auth/signin
//   JSON API endpoints (/api/plants, /api/plants/upload-url,
//     /api/plants/suggest) → 401 JSON { error: "unauthorized" }
//   Form-POST endpoint (/api/locations) → 302 to /auth/signin (the outlier)
//   Public routes (/, /auth/signin, /auth/check-email) → 200
//
// All fetch calls use `redirect: "manual"` — a 302 silently followed to a 200
// would make the assertion meaningless.
//
// The Supabase client is configured (via .dev.vars written by startServer), so
// `getUser()` actually runs real JWT validation. This makes the invalid-session
// case meaningful: the deny is caused by a failed validation, not by
// createClient returning null due to missing env vars.

describe("auth-boundary", () => {
  let server: ServerHandle;
  let base: string;
  let invalidCookie: string;

  beforeAll(async () => {
    server = await startServer();
    base = server.baseUrl;
    invalidCookie = buildInvalidSessionCookieHeader();
  }, 120_000); // generous timeout — workerd cold start

  afterAll(async () => {
    await server.stop();
  });

  // ── No-cookie: protected pages → 302 /auth/signin ────────────────────────

  it.each([
    ["/dashboard"],
    ["/locations/00000000-0000-0000-0000-000000000001"],
    ["/locations/00000000-0000-0000-0000-000000000001/plants/new"],
  ])("GET %s (no cookie) → 302 /auth/signin", async (path) => {
    const res = await fetch(`${base}${path}`, {
      method: "GET",
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/auth/signin");
  });

  // ── No-cookie: JSON API endpoints → 401 { error: "unauthorized" } ─────────
  // Each endpoint self-guards via `requireUser()` (src/lib/api.ts) because
  // `/api/**` is outside PROTECTED_ROUTES in the middleware.

  it.each([
    ["POST", "/api/plants"],
    ["POST", "/api/plants/upload-url"],
    ["POST", "/api/plants/suggest"],
  ])("%s %s (no cookie) → 401 JSON unauthorized", async (method, path) => {
    const res = await fetch(`${base}${path}`, {
      method,
      redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ error: "unauthorized" });
  });

  // ── No-cookie: /api/locations form-POST outlier → 302 /auth/signin ────────
  // Unlike the JSON endpoints, /api/locations uses redirect-on-deny (mirrors
  // the auth endpoints) — it is the only /api/** route with this behavior.
  //
  // Astro's `security.checkOrigin` CSRF guard fires before the auth check for
  // form POSTs without an Origin header (returns 403). Include a same-origin
  // Origin so the CSRF check passes and the auth-redirect executes.

  it("POST /api/locations (no cookie) → 302 /auth/signin", async () => {
    const res = await fetch(`${base}/api/locations`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: base,
      },
      body: new URLSearchParams({ name: "probe" }).toString(),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/auth/signin");
  });

  // ── No-cookie: public routes → 200 ───────────────────────────────────────

  it.each([["/"], ["/auth/signin"], ["/auth/check-email"]])("GET %s (no cookie) → 200 (public)", async (path) => {
    const res = await fetch(`${base}${path}`, {
      method: "GET",
      redirect: "manual",
    });
    expect(res.status).toBe(200);
  });

  // ── Invalid-cookie: proves getUser() validates, not just presence-checks ──
  // A cookie named `supabase.auth.token` carries a JWT-shaped but invalid-
  // signature access token. @supabase/ssr extracts it, calls getUser() on the
  // Supabase API, the API rejects the signature → user = null → deny.

  it("POST /api/plants/suggest (invalid cookie) → 401 JSON unauthorized", async () => {
    const res = await fetch(`${base}/api/plants/suggest`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Cookie: invalidCookie,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ error: "unauthorized" });
  });

  it("GET /dashboard (invalid cookie) → 302 /auth/signin", async () => {
    const res = await fetch(`${base}/dashboard`, {
      method: "GET",
      redirect: "manual",
      headers: { Cookie: invalidCookie },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/auth/signin");
  });
});

// ─── Cookie construction ──────────────────────────────────────────────────────
//
// @supabase/ssr v0.10 stores the session as:
//   cookie name:  `supabase.auth.token`  (STORAGE_KEY default from @supabase/auth-js)
//   cookie value: `base64-<base64url(JSON.stringify(session))>`
//                 (cookieEncoding: "base64url" is the createServerClient default)
//
// We construct a session whose access_token is a syntactically-valid JWT with a
// HMAC-SHA256 header but an invalid signature. @supabase/auth-js will extract it
// and call getUser(token) on the local Supabase API; the API rejects the bad
// signature and returns null.

function buildInvalidSessionCookieHeader(): string {
  const fakeSession = JSON.stringify({
    // header: {"alg":"HS256","typ":"JWT"}
    // payload: {"sub":"fake-user","exp":9999999999}
    // signature: deliberately invalid bytes
    access_token:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
      ".eyJzdWIiOiJmYWtlLXVzZXIiLCJleHAiOjk5OTk5OTk5OTl9" +
      ".aW52YWxpZC1zaWduYXR1cmUtdGhhdC13aWxsLWZhaWw",
    refresh_token: "fake-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 9999999999,
  });
  // Node's Buffer.toString("base64url") matches @supabase/ssr's stringToBase64URL:
  // both encode UTF-8 bytes without padding using the URL-safe alphabet.
  const encoded = "base64-" + Buffer.from(fakeSession, "utf8").toString("base64url");
  return `supabase.auth.token=${encoded}`;
}
