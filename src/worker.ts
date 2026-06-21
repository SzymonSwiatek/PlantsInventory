import handler from "@astrojs/cloudflare/entrypoints/server";

import { runScheduledTick } from "@/lib/reminders/scheduled";
import type { ReminderEnv } from "@/lib/reminders/service-client";

// Mirrors ScheduledController / ExecutionContext from @cloudflare/workers-types.
// Not imported globally to avoid the package overriding Response.json() (any → unknown)
// which would cascade into existing callers.
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
  scheduled(controller: ScheduledController, env: ReminderEnv, ctx: ExecutionContext) {
    controller.noRetry();
    ctx.waitUntil(
      runScheduledTick(new Date(), env).catch((err: unknown) => {
        console.error({ event: "scheduled.error", err: String(err) });
      }),
    );
  },
};
