import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";

// Raw Supabase clients for the integration suite, built directly from
// `@supabase/supabase-js` against the local stack captured by globalSetup into
// `process.env.SUPABASE_TEST_*`. The app's own factory (`src/lib/supabase.ts`)
// cannot be reused here — it reads `astro:env/server`, which does not exist in a
// Node/Vitest process. Typed with the generated `Database` schema so queries and
// insert/update payloads are statically checked (avoids `any` in strict lint).

/** The token pair a sessioned client carries. */
export interface TestSession {
  access_token: string;
  refresh_token: string;
}

type TestEnvVar = "SUPABASE_TEST_URL" | "SUPABASE_TEST_ANON_KEY" | "SUPABASE_TEST_SERVICE_ROLE_KEY";

function required(name: TestEnvVar): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is unset — the integration globalSetup did not run (or local Supabase is down).`);
  }
  return value;
}

// Both seed/teardown and assertion clients are stateless: no token autorefresh,
// no session persisted to disk — nothing to clean up between files.
const STATELESS = { auth: { autoRefreshToken: false, persistSession: false } } as const;

/** Service-role client — bypasses RLS. Seed/teardown only, never assertions. */
export function serviceRoleClient() {
  return createClient<Database>(required("SUPABASE_TEST_URL"), required("SUPABASE_TEST_SERVICE_ROLE_KEY"), STATELESS);
}

/** Anon-key client with no session — RLS treats it as the `anon` role. */
export function anonClient() {
  return createClient<Database>(required("SUPABASE_TEST_URL"), required("SUPABASE_TEST_ANON_KEY"), STATELESS);
}

/**
 * Anon-key client carrying a user's access token via the `Authorization` header
 * — the RLS-respecting assertion client. PostgREST and Storage both honour the
 * bearer token, so every query/operation runs as that user, exactly as the app's
 * cookie-session client would. (`auth.getUser(token)` still takes the token
 * explicitly, since no session is persisted on this client.)
 */
export function sessionedClient(session: TestSession) {
  return createClient<Database>(required("SUPABASE_TEST_URL"), required("SUPABASE_TEST_ANON_KEY"), {
    ...STATELESS,
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
}

/** The concrete Supabase client type the integration helpers pass around. */
export type IntegrationClient = ReturnType<typeof anonClient>;
