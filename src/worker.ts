import handler from "@astrojs/cloudflare/entrypoints/server";

import { runScheduledTick } from "@/lib/reminders/scheduled";

interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

export default {
  ...handler,
  scheduled(_controller: unknown, _env: unknown, ctx: Ctx) {
    ctx.waitUntil(
      runScheduledTick(new Date()).catch((err: unknown) => {
        console.error({ event: "scheduled.error", err: String(err) });
      }),
    );
  },
};
