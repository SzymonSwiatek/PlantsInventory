import type { APIContext } from "astro";
import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase";
import { POST } from "./snooze";

const VALID_UUID = "00000000-0000-0000-0000-000000000001";
const NOT_A_UUID = "not-a-uuid";

function fakeContext(body?: unknown, user?: User | null): APIContext {
  return {
    locals: { user: user !== undefined ? user : ({ id: "test-user" } as User) },
    params: {},
    cookies: {},
    request: new Request("http://test.local/api/plants/snooze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  } as unknown as APIContext;
}

function mockClient(updateError: unknown = null) {
  const eqFn = vi.fn().mockResolvedValue({ error: updateError });
  const updateFn = vi.fn().mockReturnValue({ eq: eqFn });
  const client = {
    from: vi.fn().mockReturnValue({ update: updateFn }),
    _updateFn: updateFn,
    _eqFn: eqFn,
  };
  vi.mocked(createClient).mockReturnValue(client as never);
  return client;
}

describe("/api/plants/snooze — POST validation", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReturnValue(null);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await POST(fakeContext({ plantId: VALID_UUID, days: 3 }, null));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 400 invalid_plant_id for a non-UUID", async () => {
    const res = await POST(fakeContext({ plantId: NOT_A_UUID, days: 3 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_plant_id" });
  });

  it("returns 400 invalid_plant_id when plantId is missing", async () => {
    const res = await POST(fakeContext({ days: 3 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_plant_id" });
  });

  it("returns 400 invalid_days for 0", async () => {
    const res = await POST(fakeContext({ plantId: VALID_UUID, days: 0 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_days" });
  });

  it("returns 400 invalid_days for 31 (above max)", async () => {
    const res = await POST(fakeContext({ plantId: VALID_UUID, days: 31 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_days" });
  });

  it("returns 400 invalid_days for a non-integer", async () => {
    const res = await POST(fakeContext({ plantId: VALID_UUID, days: 1.5 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_days" });
  });

  it("returns 400 invalid_days when days is absent", async () => {
    const res = await POST(fakeContext({ plantId: VALID_UUID }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_days" });
  });

  it("returns 503 when Supabase is unconfigured", async () => {
    const res = await POST(fakeContext({ plantId: VALID_UUID, days: 3 }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "supabase_unavailable" });
  });
});

describe("/api/plants/snooze — POST happy path", () => {
  it("sets water_snooze_until and returns snoozed_until", async () => {
    const before = Date.now();
    const client = mockClient();

    const res = await POST(fakeContext({ plantId: VALID_UUID, days: 7 }));
    const after = Date.now();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { snoozed_until: string };
    const snoozedMs = new Date(body.snoozed_until).getTime();
    expect(snoozedMs).toBeGreaterThanOrEqual(before + 7 * 86_400_000);
    expect(snoozedMs).toBeLessThanOrEqual(after + 7 * 86_400_000);

    const updateArg = client._updateFn.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).toHaveProperty("water_snooze_until", body.snoozed_until);
    expect(updateArg).not.toHaveProperty("watering_interval_days");
    expect(updateArg).not.toHaveProperty("last_watered_at");
    expect(client._eqFn).toHaveBeenCalledWith("id", VALID_UUID);
  });

  it("accepts the boundary value of 1 day", async () => {
    mockClient();
    const res = await POST(fakeContext({ plantId: VALID_UUID, days: 1 }));
    expect(res.status).toBe(200);
  });

  it("accepts the boundary value of 30 days", async () => {
    mockClient();
    const res = await POST(fakeContext({ plantId: VALID_UUID, days: 30 }));
    expect(res.status).toBe(200);
  });
});
