import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Node-environment unit runner. The units under test (e.g. the AI-suggestion
// normalizer) are pure and import-type-only, so no `astro:env/server` stub or
// workerd shim is needed. The `@` alias is replicated here because Vitest's
// runtime resolver does not consult tsconfig `paths`.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
