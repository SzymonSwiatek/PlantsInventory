import type { APIContext } from "astro";
import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase";
import { POST } from "./winterize";

const PLANT_A = "00000000-0000-0000-0000-000000000001";
const PLANT_B = "00000000-0000-0000-0000-000000000002";
const NOT_A_UUID = "not-a-uuid";

function fakeContext(body?: unknown, user?: User | null): APIContext {
  return {
    locals: { user: user !== undefined ? user : ({ id: "test-user" } as User) },
    params: {},
    cookies: {},
    request: new Request("http://test.local/api/plants/winterize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  } as unknown as APIContext;
}

function mockClient(insertError: unknown = null, updateError: unknown = null) {
  const insertFn = vi.fn().mockResolvedValue({ error: insertError });
  const inFn = vi.fn().mockResolvedValue({ error: updateError });
  const updateFn = vi.fn().mockReturnValue({ in: inFn });
  const client = {
    from: vi.fn((table: string) => {
      if (table === "care_events") return { insert: insertFn };
      if (table === "plants") return { update: updateFn };
      return {};
    }),
    _insertFn: insertFn,
    _updateFn: updateFn,
    _inFn: inFn,
  };
  vi.mocked(createClient).mockReturnValue(client as never);
  return client;
}

describe("/api/plants/winterize — POST validation", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReturnValue(null);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await POST(fakeContext({ plantIds: [PLANT_A] }, null));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 400 missing_plant_ids for an empty array", async () => {
    const res = await POST(fakeContext({ plantIds: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_plant_ids" });
  });

  it("returns 400 missing_plant_ids when field is absent", async () => {
    const res = await POST(fakeContext({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_plant_ids" });
  });

  it("returns 400 invalid_plant_id for a non-UUID in the array", async () => {
    const res = await POST(fakeContext({ plantIds: [PLANT_A, NOT_A_UUID] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_plant_id" });
  });

  it("returns 503 when Supabase is unconfigured", async () => {
    const res = await POST(fakeContext({ plantIds: [PLANT_A] }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "supabase_unavailable" });
  });
});

describe("/api/plants/winterize — POST happy path", () => {
  it("inserts a winterize care_event and sets winterized_at, returns winterized ids", async () => {
    const client = mockClient();
    const res = await POST(fakeContext({ plantIds: [PLANT_A] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ winterized: [PLANT_A] });

    const insertArg = client._insertFn.mock.calls[0][0] as Record<string, unknown>[];
    expect(insertArg).toHaveLength(1);
    expect(insertArg[0]).toMatchObject({ plant_id: PLANT_A, kind: "winterize" });
    expect(typeof insertArg[0].done_at).toBe("string");

    const updateArg = client._updateFn.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof updateArg.winterized_at).toBe("string");
    expect(client._inFn).toHaveBeenCalledWith("id", [PLANT_A]);
  });

  it("marks all ids in a bulk request", async () => {
    const client = mockClient();
    const res = await POST(fakeContext({ plantIds: [PLANT_A, PLANT_B] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { winterized: string[] };
    expect(body.winterized).toEqual([PLANT_A, PLANT_B]);

    const insertArg = client._insertFn.mock.calls[0][0] as { plant_id: string }[];
    expect(insertArg.map((r) => r.plant_id)).toEqual([PLANT_A, PLANT_B]);
    expect(client._inFn).toHaveBeenCalledWith("id", [PLANT_A, PLANT_B]);
  });

  it("returns 400 when care_events insert violates a DB constraint (cross-user FK guard)", async () => {
    mockClient({ code: "23514", message: "same-user guard" });
    const res = await POST(fakeContext({ plantIds: [PLANT_A] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });
});
