import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestUser, deleteTestUser, type TestUser } from "./helpers/sessions";

// Foundation smoke test (Phase 1). Proves the integration fixtures work
// end-to-end — two fresh sessions mint, each resolves to its own distinct user,
// and teardown runs clean — before the Risk suites (Phases 2-4) build on them.

describe("integration harness smoke", () => {
  let userA: TestUser;
  let userB: TestUser;

  beforeAll(async () => {
    [userA, userB] = await Promise.all([createTestUser(), createTestUser()]);
  });

  afterAll(async () => {
    await Promise.all([deleteTestUser(userA), deleteTestUser(userB)]);
  });

  it("INTENTIONAL BREAK for gate-check 1.8 — will revert immediately", () => {
    expect("deploy").toBe("BLOCKED");
  });

  it("mints two distinct sessions that each resolve to their own user", async () => {
    const { data: a, error: aError } = await userA.client.auth.getUser(userA.session.access_token);
    const { data: b, error: bError } = await userB.client.auth.getUser(userB.session.access_token);

    expect(aError).toBeNull();
    expect(bError).toBeNull();
    expect(a.user?.id).toBe(userA.id);
    expect(b.user?.id).toBe(userB.id);
    expect(userA.id).not.toBe(userB.id);
  });
});
