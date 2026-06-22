import type { APIContext } from "astro";
import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase";
import { POST } from "./winterize-undo";

const PLANT_A = "00000000-0000-0000-0000-000000000001";
const PLANT_B = "00000000-0000-0000-0000-000000000002";
const EVENT_1 = "eeeeeeee-0000-0000-0000-000000000001";
const EVENT_2 = "eeeeeeee-0000-0000-0000-000000000002";
const PRIOR_DONE_AT = "2026-06-14T12:00:00.000Z";
const LATEST_DONE_AT = "2026-06-21T10:00:00.000Z";

function fakeContext(body?: unknown, user?: User | null): APIContext {
  return {
    locals: { user: user !== undefined ? user : ({ id: "test-user" } as User) },
    params: {},
    cookies: {},
    request: new Request("http://test.local/api/plants/winterize-undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  } as unknown as APIContext;
}

interface CareEventRow {
  id: string;
  plant_id: string;
  done_at: string;
}

function mockClient(events: CareEventRow[], deleteError: unknown = null, updateError: unknown = null) {
  const orderCreatedAt = vi.fn().mockResolvedValue({ data: events, error: null });
  const orderDoneAt = vi.fn().mockReturnValue({ order: orderCreatedAt });
  const eqKind = vi.fn().mockReturnValue({ order: orderDoneAt });
  const inPlants = vi.fn().mockReturnValue({ eq: eqKind });
  const selectFn = vi.fn().mockReturnValue({ in: inPlants });

  const deleteInFn = vi.fn().mockResolvedValue({ error: deleteError });
  const deleteFn = vi.fn().mockReturnValue({ in: deleteInFn });

  const updateEq = vi.fn().mockResolvedValue({ error: updateError });
  const updateFn = vi.fn().mockReturnValue({ eq: updateEq });

  const client = {
    from: vi.fn((table: string) => {
      if (table === "care_events") return { select: selectFn, delete: deleteFn };
      if (table === "plants") return { update: updateFn };
      return {};
    }),
    _updateFn: updateFn,
    _updateEq: updateEq,
    _deleteInFn: deleteInFn,
  };
  vi.mocked(createClient).mockReturnValue(client as never);
  return client;
}

describe("/api/plants/winterize-undo — POST validation", () => {
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

  it("returns 503 when Supabase is unconfigured", async () => {
    const res = await POST(fakeContext({ plantIds: [PLANT_A] }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "supabase_unavailable" });
  });
});

describe("/api/plants/winterize-undo — POST undo logic", () => {
  it("restores winterized_at to the prior event's done_at", async () => {
    const events: CareEventRow[] = [
      { id: EVENT_1, plant_id: PLANT_A, done_at: LATEST_DONE_AT },
      { id: EVENT_2, plant_id: PLANT_A, done_at: PRIOR_DONE_AT },
    ];
    const client = mockClient(events);

    const res = await POST(fakeContext({ plantIds: [PLANT_A] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reverted: [PLANT_A] });

    expect(client._deleteInFn).toHaveBeenCalledWith("id", [EVENT_1]);
    const updateArg = client._updateFn.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).toEqual({ winterized_at: PRIOR_DONE_AT });
    expect(client._updateEq).toHaveBeenCalledWith("id", PLANT_A);
  });

  it("sets winterized_at to null when there is no prior event", async () => {
    const events: CareEventRow[] = [{ id: EVENT_1, plant_id: PLANT_A, done_at: LATEST_DONE_AT }];
    const client = mockClient(events);

    const res = await POST(fakeContext({ plantIds: [PLANT_A] }));
    expect(res.status).toBe(200);

    const updateArg = client._updateFn.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).toEqual({ winterized_at: null });
  });

  it("is a no-op (winterized_at → null) when no winterize events exist for the plant", async () => {
    const client = mockClient([]);

    const res = await POST(fakeContext({ plantIds: [PLANT_A] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reverted: [PLANT_A] });

    expect(client._deleteInFn).not.toHaveBeenCalled();
    const updateArg = client._updateFn.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).toEqual({ winterized_at: null });
  });

  it("handles bulk undo: each plant gets its own prior done_at", async () => {
    const PRIOR_B = "2026-06-10T08:00:00.000Z";
    const events: CareEventRow[] = [
      { id: EVENT_1, plant_id: PLANT_A, done_at: LATEST_DONE_AT },
      { id: EVENT_2, plant_id: PLANT_A, done_at: PRIOR_DONE_AT },
      { id: "eeeeeeee-0000-0000-0000-000000000003", plant_id: PLANT_B, done_at: "2026-06-21T09:00:00.000Z" },
      { id: "eeeeeeee-0000-0000-0000-000000000004", plant_id: PLANT_B, done_at: PRIOR_B },
    ];
    const client = mockClient(events);

    const res = await POST(fakeContext({ plantIds: [PLANT_A, PLANT_B] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reverted: string[] };
    expect(body.reverted).toEqual([PLANT_A, PLANT_B]);

    const updateCalls = client._updateFn.mock.calls as [Record<string, unknown>][];
    expect(updateCalls[0][0]).toEqual({ winterized_at: PRIOR_DONE_AT });
    expect(updateCalls[1][0]).toEqual({ winterized_at: PRIOR_B });
  });
});
