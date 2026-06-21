import handler from "@astrojs/cloudflare/entrypoints/server";

import { runScheduledTick } from "@/lib/reminders/scheduled";

// Mirrors ScheduledController / ExecutionContext from @cloudflare/workers-types.
// Not imported globally to avoid the package overriding Response.json() (any → unknown)
// which would cascade into existing callers. S-04 can wire the real types properly.
interface ScheduledController {
  readonly scheduledTime: number;
  readonly cron: string;
  noRetry(): void;
}
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export default {
  ...handler,
  scheduled(_controller: ScheduledController, _env: unknown, ctx: ExecutionContext) {
    ctx.waitUntil(
      runScheduledTick(new Date()).catch((err: unknown) => {
        console.error({ event: "scheduled.error", err: String(err) });
      }),
    );
  },
};
