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
    // suite. Vitest's default `include` would otherwise match
    // `tests/integration/**/*.integration.test.ts`. Run those via
    // `npm run test:integration` (vitest.integration.config.ts).
    exclude: [...configDefaults.exclude, "tests/integration/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
