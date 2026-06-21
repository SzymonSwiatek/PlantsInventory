export function runScheduledTick(now: Date): Promise<void> {
  console.log({ event: "scheduled.tick", ts: now.toISOString() });
  return Promise.resolve();
}
