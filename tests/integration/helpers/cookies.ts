import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/db/database.types";
import type { TestSession } from "./clients";

// Serialize a sessioned user's auth state into a `Cookie:` header value the
// booted SSR server will accept. The app resolves the user from cookies via
// `@supabase/ssr`'s `parseCookieHeader` + `getUser()` (`src/lib/supabase.ts`),
// so we let the SAME library emit the cookies rather than hand-rolling the
// versioned, sometimes-chunked `sb-<ref>-auth-token` encoding: drive a
// `createServerClient` with a cookie-capturing adapter, call `setSession(...)`,
// and serialize whatever cookies the library wrote. This stays in lockstep with
// the app's own cookie parser across `@supabase/ssr` upgrades.

function required(name: "SUPABASE_TEST_URL" | "SUPABASE_TEST_ANON_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is unset — the integration globalSetup did not run (or local Supabase is down).`);
  }
  return value;
}

/**
 * Build the `Cookie:` header that authenticates `session` against the booted
 * SSR server. Uses the local Supabase URL/anon key captured by globalSetup so
 * the storage key (`sb-<ref>-auth-token`) matches what the booted server — which
 * reads the same `SUPABASE_URL` from `.dev.vars` — parses.
 */
export async function buildAuthCookieHeader(session: TestSession): Promise<string> {
  const captured = new Map<string, string>();

  const client = createServerClient<Database>(required("SUPABASE_TEST_URL"), required("SUPABASE_TEST_ANON_KEY"), {
    cookies: {
      getAll() {
        return [...captured].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          captured.set(name, value);
        }
      },
    },
  });

  const { error } = await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error !== null) {
    throw new Error(`buildAuthCookieHeader: setSession failed: ${error.message}`);
  }

  if (captured.size === 0) {
    throw new Error("buildAuthCookieHeader: setSession wrote no auth cookies — cannot authenticate the booted server.");
  }

  return [...captured].map(([name, value]) => `${name}=${value}`).join("; ");
}
