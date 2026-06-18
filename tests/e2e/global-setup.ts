import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { createServerClient } from "@supabase/ssr";
import { chromium } from "@playwright/test";

import type { TestSession } from "../integration/helpers/clients";
import { createTestUser } from "../integration/helpers/sessions";

// Playwright global-setup — produces an authenticated `storageState` and seeds a
// location so the single AI-outage spec starts logged-in on a real add-plant
// page, without ever driving the magic-link UI (email delivery is out of test
// scope, test-plan.md §3).
//
// This is decoupled from the `webServer`: it talks to local Supabase DIRECTLY
// (admin API + RLS-scoped client), never through the app, so it does not matter
// whether Playwright starts the server before or after this runs.
//
// Auth cookies are emitted by `@supabase/ssr` itself (same trick as the
// integration `buildAuthCookieHeader`) — never hand-rolled — so the
// `sb-<ref>-auth-token` encoding stays in lockstep with the app's own cookie
// parser. The captured cookies are serialized into Playwright `storageState`.

const STORAGE_STATE_PATH = "playwright/.auth/user.json";
const CONTEXT_PATH = "playwright/.auth/context.json";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:4323";

interface SupabaseStatus {
  API_URL?: string;
  ANON_KEY?: string;
  SERVICE_ROLE_KEY?: string;
}

interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "Strict" | "None";
}

/** Capture the running local stack's URL + keys into `SUPABASE_TEST_*` so the
 * reused integration helpers (which read those vars) resolve them. */
function captureSupabaseEnv(): { url: string; anonKey: string } {
  let raw: string;
  try {
    raw = execSync("npx supabase status --output json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (cause) {
    throw new Error("Local Supabase is not running. Run `npx supabase start` first (Docker required).", { cause });
  }
  const status = JSON.parse(raw) as SupabaseStatus;
  const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = status;
  if (!API_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error("Local Supabase status is missing keys — is it fully started?");
  }
  process.env.SUPABASE_TEST_URL = API_URL;
  process.env.SUPABASE_TEST_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_TEST_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
  return { url: API_URL, anonKey: ANON_KEY };
}

/** Let `@supabase/ssr` emit the session cookies, then shape them as Playwright
 * `storageState` cookies scoped to `localhost`. */
async function captureAuthCookies(url: string, anonKey: string, session: TestSession): Promise<PlaywrightCookie[]> {
  const captured = new Map<string, string>();
  const client = createServerClient(url, anonKey, {
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
    throw new Error(`global-setup: setSession failed: ${error.message}`);
  }
  if (captured.size === 0) {
    throw new Error("global-setup: setSession wrote no auth cookies — cannot authenticate the e2e session.");
  }

  // Persistent for the run; the access token's own TTL still governs validity.
  const expires = Math.floor(Date.now() / 1000) + 60 * 60;
  return [...captured].map(([name, value]) => ({
    name,
    value,
    domain: "localhost",
    path: "/",
    expires,
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  }));
}

/** Poll a public route until the dev server answers 200 (covers a slow workerd
 * cold start; Playwright starts the webServer before this global-setup). */
async function waitForServer(): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE_URL}/auth/signin`, { signal: AbortSignal.timeout(5_000) });
      if (res.status === 200) {
        return true;
      }
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      return false;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/**
 * Absorb `astro dev`'s cold-start reloads BEFORE the actual test browser opens.
 * The first time a REAL browser loads the add-plant page, Vite optimizes the
 * React island's client deps (lucide-react, radix-ui, …) and the cloudflare
 * platformProxy loads `.dev.vars` secrets — each forcing a full page reload. Hit
 * mid-test, that reload wipes the island's just-selected photo. A plain `fetch`
 * can't trigger the CLIENT-side optimization (it never requests the island's JS
 * bundle), so we warm with a throwaway browser: load the exact page twice and
 * wait for the network to settle, so the deps are pre-bundled and the real test
 * never sees a reload. Best-effort — failures here are non-fatal.
 */
async function warmUpServer(storageStatePath: string, locationId: string): Promise<void> {
  if (!(await waitForServer())) {
    return;
  }
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const context = await browser.newContext({ storageState: storageStatePath });
    const page = await context.newPage();
    const url = `${BASE_URL}/locations/${locationId}/plants/new`;
    // First load triggers optimization + the reload; the second runs against an
    // already-warm server and confirms no further reload is pending.
    await page.goto(url, { waitUntil: "networkidle" });
    await page.goto(url, { waitUntil: "networkidle" });
    await context.close();
  } catch {
    // best-effort warm-up
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(): Promise<void> {
  const { url, anonKey } = captureSupabaseEnv();

  const user = await createTestUser();

  // Seed a location via the user's RLS-scoped client — the add-plant page is
  // reached at /locations/[id]/plants/new. user_id defaults to auth.uid().
  const { data: location, error } = await user.client
    .from("locations")
    .insert({ name: `E2E outage ${Date.now().toString()}` })
    .select("id")
    .single();
  if (error !== null) {
    throw new Error(`global-setup: seed location failed: ${error.message}`);
  }

  const cookies = await captureAuthCookies(url, anonKey, user.session);

  mkdirSync(dirname(STORAGE_STATE_PATH), { recursive: true });
  writeFileSync(STORAGE_STATE_PATH, JSON.stringify({ cookies, origins: [] }, null, 2));
  // Hand the seeded ids to the spec + teardown (separate processes).
  writeFileSync(CONTEXT_PATH, JSON.stringify({ userId: user.id, locationId: location.id }, null, 2));

  // Warm the dev server (needs the storageState just written) so cold-start
  // reloads don't wipe the island mid-test.
  await warmUpServer(STORAGE_STATE_PATH, location.id);
}
