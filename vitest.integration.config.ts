import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Opt-in, Docker-dependent integration runner (test-plan Phase 2). Scoped to
// `tests/integration/**`, Node environment, with a globalSetup that preflights a
// locally running Supabase and captures its (per-reset) URL + keys into
// `process.env.SUPABASE_TEST_*`. Kept separate from `vitest.config.ts` so the
// unit gate stays hermetic (that config excludes `tests/integration/**`). Run via
// `npm run test:integration`. Per-file fresh, timestamp-unique users keep the
// default file parallelism safe — no fixtures are shared across files.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.integration.test.ts"],
    globalSetup: ["./tests/integration/globalSetup.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
