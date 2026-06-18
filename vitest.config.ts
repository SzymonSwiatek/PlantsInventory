import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

// Node-environment unit runner. The units under test (e.g. the AI-suggestion
// normalizer) are pure and import-type-only, so no `astro:env/server` stub or
// workerd shim is needed. The `@` alias is replicated here because Vitest's
// runtime resolver does not consult tsconfig `paths`.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Keep the unit gate hermetic: never pick up the Docker-dependent integration
    // suite (run via `npm run test:integration`), nor the browser-level Playwright
    // specs under `tests/e2e/**` (run via `npm run test:e2e`) — Playwright's
    // `test`/`expect` are not Vitest's and crash on collection here. Vitest's
    // default `include` would otherwise match both trees.
    exclude: [...configDefaults.exclude, "tests/integration/**", "tests/e2e/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
