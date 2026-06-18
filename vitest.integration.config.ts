import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Opt-in, Docker-dependent integration runner (test-plan Phase 2). Scoped to
// `tests/integration/**`, Node environment, with a globalSetup that preflights a
// locally running Supabase and captures its (per-reset) URL + keys into
// `process.env.SUPABASE_TEST_*`. Kept separate from `vitest.config.ts` so the
// unit gate stays hermetic (that config excludes `tests/integration/**`). Run via
// `npm run test:integration`.
//
// `fileParallelism: false` — files run one at a time. More than one suite now
// boots the real SSR app via `startServer()` (auth-boundary AND ai-outage), and
// that helper binds a fixed port (4322) and mutates the shared repo-root
// `.dev.vars`. Two suites in parallel workers would collide on the port and race
// the `.dev.vars` capture/restore. astro-dev boot dominates the wall time here
// (these are IO/boot-bound, not CPU-bound), so serialising costs little.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.integration.test.ts"],
    globalSetup: ["./tests/integration/globalSetup.ts"],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
