import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The Cloudflare dev runtime reads `astro:env/server` secrets from `.dev.vars`
// (not from the regular process environment). Before spawning `astro dev` we
// overwrite `.dev.vars` with the test Supabase keys captured by globalSetup,
// then restore the file when the server stops.

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEV_VARS_PATH = join(PROJECT_ROOT, ".dev.vars");
const TEST_PORT = 4322;
const READY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;

export interface ServerHandle {
  /** e.g. `http://localhost:4322` */
  baseUrl: string;
  /** Kill the server and restore `.dev.vars` to its pre-test state. */
  stop(): Promise<void>;
}

/**
 * Spawn `astro dev` on a dedicated test port with the local Supabase keys
 * wired so that `getUser()` actually validates tokens rather than returning
 * null because the client is unconfigured. Only the auth-boundary file calls
 * this; per-file parallelism therefore does not race on `.dev.vars`.
 */
export async function startServer(): Promise<ServerHandle> {
  const supabaseUrl = process.env.SUPABASE_TEST_URL;
  const supabaseKey = process.env.SUPABASE_TEST_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_TEST_* env vars not set — globalSetup did not run (or local Supabase is down).");
  }

  const prevDevVars = existsSync(DEV_VARS_PATH) ? readFileSync(DEV_VARS_PATH, "utf8") : null;
  writeFileSync(DEV_VARS_PATH, `SUPABASE_URL=${supabaseUrl}\nSUPABASE_KEY=${supabaseKey}\n`);

  const baseUrl = `http://localhost:${TEST_PORT}`;

  const child = spawn("npx", ["astro", "dev", "--port", String(TEST_PORT)], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  // Forward child stderr for startup diagnostics (visible on test failure).
  child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
  });

  let processExited = false;
  child.on("exit", () => {
    processExited = true;
  });

  function restoreDevVars(): void {
    if (prevDevVars !== null) {
      writeFileSync(DEV_VARS_PATH, prevDevVars);
    } else {
      rmSync(DEV_VARS_PATH, { force: true });
    }
  }

  async function stop(): Promise<void> {
    if (!processExited) {
      child.kill("SIGTERM");
      await new Promise<void>((done) => {
        child.once("exit", done);
        // Force-kill after 5 s if SIGTERM is not honoured.
        setTimeout(() => {
          child.kill("SIGKILL");
          done();
        }, 5_000);
      });
    }
    restoreDevVars();
  }

  try {
    await waitUntilReady(baseUrl, READY_TIMEOUT_MS, POLL_INTERVAL_MS);
  } catch (err) {
    await stop();
    throw err;
  }

  return { baseUrl, stop };
}

async function waitUntilReady(baseUrl: string, timeoutMs: number, intervalMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // `/auth/signin` is always public — a 200 confirms the server is up.
      const res = await fetch(`${baseUrl}/auth/signin`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (res.status === 200) {
        return;
      }
    } catch {
      // Not up yet — keep polling.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Dev server did not become ready within ${timeoutMs / 1_000}s at ${baseUrl}`);
}
