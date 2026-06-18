import { execSync } from "node:child_process";

// Vitest globalSetup for the integration suite — runs once before any test.
// Confirms a local Supabase is up and captures its per-reset API URL + keys into
// `process.env.SUPABASE_TEST_*` for the client helpers. Fails fast with an
// actionable message when Docker / Supabase is down (vs. an opaque connection
// error later). The local keys rotate on every `supabase start` / db reset, so
// they are captured at runtime and never committed.

interface SupabaseStatus {
  API_URL?: string;
  ANON_KEY?: string;
  SERVICE_ROLE_KEY?: string;
}

const START_HINT = "Local Supabase is not running. Run `npx supabase start` first (Docker required).";

export default function setup(): void {
  let raw: string;
  try {
    raw = execSync("npx supabase status --output json", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (cause) {
    throw new Error(START_HINT, { cause });
  }

  let status: SupabaseStatus;
  try {
    status = JSON.parse(raw) as SupabaseStatus;
  } catch (cause) {
    throw new Error(`${START_HINT} (could not parse \`supabase status --output json\`)`, { cause });
  }

  const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = status;
  if (!API_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error(START_HINT);
  }

  process.env.SUPABASE_TEST_URL = API_URL;
  process.env.SUPABASE_TEST_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_TEST_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
}
