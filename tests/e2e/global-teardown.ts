import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";

import { deleteTestUserById } from "../integration/helpers/sessions";

// Playwright global-teardown — restore the developer's `.dev.vars` (clobbered by
// `setup-dev-vars.mjs`) and delete the user minted in global-setup (cascades its
// plants + storage). Runs in a fresh process, so it re-captures the local keys
// and reads the seeded ids back from the context file global-setup wrote.

const CONTEXT_PATH = "playwright/.auth/context.json";
const DEV_VARS = ".dev.vars";
const BACKUP = ".dev.vars.e2e-bak";

interface SupabaseStatus {
  API_URL?: string;
  ANON_KEY?: string;
  SERVICE_ROLE_KEY?: string;
}

interface E2eContext {
  userId: string;
  locationId: string;
}

function restoreDevVars(): void {
  if (existsSync(BACKUP)) {
    copyFileSync(BACKUP, DEV_VARS);
    rmSync(BACKUP, { force: true });
  } else {
    // No backup means there was no pre-test `.dev.vars` — leave the e2e one off.
    rmSync(DEV_VARS, { force: true });
  }
}

export default async function globalTeardown(): Promise<void> {
  restoreDevVars();

  if (!existsSync(CONTEXT_PATH)) {
    return;
  }
  const ctx = JSON.parse(readFileSync(CONTEXT_PATH, "utf8")) as E2eContext;

  const raw = execSync("npx supabase status --output json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const status = JSON.parse(raw) as SupabaseStatus;
  if (status.API_URL && status.ANON_KEY && status.SERVICE_ROLE_KEY) {
    process.env.SUPABASE_TEST_URL = status.API_URL;
    process.env.SUPABASE_TEST_ANON_KEY = status.ANON_KEY;
    process.env.SUPABASE_TEST_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
    await deleteTestUserById(ctx.userId);
  }

  rmSync(CONTEXT_PATH, { force: true });
}
