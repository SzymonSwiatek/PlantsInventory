import { describe, expect, it, vi } from "vitest";

import { runScheduledTick } from "./scheduled";

describe("runScheduledTick", () => {
  it("emits a structured heartbeat log with the expected event marker", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const now = new Date("2026-01-15T08:00:00.000Z");

    await runScheduledTick(now);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: "scheduled.tick", ts: now.toISOString() }));

    spy.mockRestore();
  });
});
