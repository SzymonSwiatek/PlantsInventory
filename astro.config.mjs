// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  adapter: cloudflare(),
  // checkOrigin is disabled globally so that RFC 8058 one-click unsubscribe POSTs
  // (which come from mail providers with no Origin header) are not 403'd. The
  // session-mutation routes compensate with explicit same-origin checks in api.ts.
  security: { checkOrigin: false },
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      AI_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_SERVICE_ROLE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      RESEND_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      REMINDER_FROM_EMAIL: envField.string({ context: "server", access: "secret", optional: true }),
      PUBLIC_SITE_URL: envField.string({ context: "server", access: "public", optional: true }),
      REMINDER_UNSUBSCRIBE_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
