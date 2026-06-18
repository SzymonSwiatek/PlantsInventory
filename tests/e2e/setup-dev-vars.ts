import { execSync } from "node:child_process";
import { copyFileSync, existsSync, writeFileSync } from "node:fs";

// Playwright `webServer` prep — runs synchronously BEFORE `astro dev` (chained
// with `&&`), so the freshly written `.dev.vars` is in place when the workerd
// dev runtime reads its `astro:env/server` secrets at startup. Run directly with
// `node` (Node strips the TS types).
//
// Mirrors the integration `startServer()` lever (`tests/integration/helpers/
// server.ts`): write SUPABASE_* from the running local stack and force
// `AI_API_KEY=` OFF so every `/api/plants/suggest` call degrades to
// `ai_unavailable` (Risk #1's zero-stub outage lever). Omitting the key is not
// enough — `astro dev` also loads `.env` via Vite, where a real key may live; an
// explicit empty value in `.dev.vars` (read first by workerd) shadows it. The URL
// is captured from the SAME `supabase status` global-setup uses, so the
// `sb-<ref>-auth-token` cookie ref matches what this server parses.
//
// The pre-test `.dev.vars` is backed up so `globalTeardown` can restore it.

interface SupabaseStatus {
  API_URL?: string;
  ANON_KEY?: string;
}

const DEV_VARS = ".dev.vars";
const BACKUP = ".dev.vars.e2e-bak";

if (existsSync(DEV_VARS) && !existsSync(BACKUP)) {
  copyFileSync(DEV_VARS, BACKUP);
}

const raw = execSync("npx supabase status --output json", { encoding: "utf8" });
const status = JSON.parse(raw) as SupabaseStatus;
if (!status.API_URL || !status.ANON_KEY) {
  throw new Error("Local Supabase is not running. Run `npx supabase start` first (Docker required).");
}

writeFileSync(DEV_VARS, `SUPABASE_URL=${status.API_URL}\nSUPABASE_KEY=${status.ANON_KEY}\nAI_API_KEY=\n`);
