import type { APIContext } from "astro";
import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/storage", () => ({ removePhotos: vi.fn() }));

import { createClient } from "@/lib/supabase";
import { removePhotos } from "@/lib/storage";
import { DELETE, PATCH } from "./[id]";

const VALID_UUID = "00000000-0000-0000-0000-000000000001";
const NOT_A_UUID = "not-a-uuid";

function fakeContext(method: "PATCH" | "DELETE", id: string, body?: unknown, user?: User | null): APIContext {
  return {
    locals: { user: user !== undefined ? user : ({ id: "test-user" } as User) },
    params: { id },
    cookies: {},
    request: new Request(`http://test.local/api/plants/${id}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  } as unknown as APIContext;
}

describe("/api/plants/[id] — PATCH validation", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReturnValue(null);
    vi.mocked(removePhotos).mockResolvedValue(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await PATCH(fakeContext("PATCH", VALID_UUID, { name: "Rose" }, null));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 400 invalid_id for a non-UUID id", async () => {
    const res = await PATCH(fakeContext("PATCH", NOT_A_UUID, { name: "Rose" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_id" });
  });

  it("returns 503 when Supabase is unconfigured", async () => {
    const res = await PATCH(fakeContext("PATCH", VALID_UUID, { name: "Rose" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "supabase_unavailable" });
  });

  it("returns 400 no_fields when body has no whitelisted keys", async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };
    vi.mocked(createClient).mockReturnValue(mockClient as never);
    const res = await PATCH(fakeContext("PATCH", VALID_UUID, { ai_suggestion: { species: "Rosa" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_fields" });
  });

  it("returns 400 no_fields when only non-whitelisted keys are present", async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };
    vi.mocked(createClient).mockReturnValue(mockClient as never);
    const res = await PATCH(fakeContext("PATCH", VALID_UUID, { user_id: "evil", id: "hack" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_fields" });
  });

  it("returns 400 invalid_name when name is empty after trim", async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };
    vi.mocked(createClient).mockReturnValue(mockClient as never);
    const res = await PATCH(fakeContext("PATCH", VALID_UUID, { name: "  " }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_name" });
  });

  it("returns 400 invalid_name when name exceeds 100 characters", async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };
    vi.mocked(createClient).mockReturnValue(mockClient as never);
    const res = await PATCH(fakeContext("PATCH", VALID_UUID, { name: "a".repeat(101) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_name" });
  });

  it("returns 400 invalid_watering_interval for a non-positive integer", async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };
    vi.mocked(createClient).mockReturnValue(mockClient as never);
    const res = await PATCH(fakeContext("PATCH", VALID_UUID, { watering_interval_days: 0 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_watering_interval" });
  });

  it("returns 400 invalid_watering_interval for a non-integer", async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };
    vi.mocked(createClient).mockReturnValue(mockClient as never);
    const res = await PATCH(fakeContext("PATCH", VALID_UUID, { watering_interval_days: 1.5 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_watering_interval" });
  });

  it("accepts null watering_interval_days (clears the field)", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const updateFn = vi.fn().mockReturnValue({ eq });
    const mockClient = {
      from: vi.fn().mockReturnValue({ update: updateFn }),
    };
    vi.mocked(createClient).mockReturnValue(mockClient as never);
    const res = await PATCH(fakeContext("PATCH", VALID_UUID, { watering_interval_days: null }));
    expect(res.status).toBe(200);
    const updateArg = updateFn.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).toHaveProperty("watering_interval_days", null);
  });

  it("does not write ai_suggestion or user_id even when they appear in the body", async () => {
    const updateMock = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const mockClient = {
      from: vi.fn().mockReturnValue({ update: updateMock }),
    };
    vi.mocked(createClient).mockReturnValue(mockClient as never);
    const res = await PATCH(
      fakeContext("PATCH", VALID_UUID, { name: "Cactus", ai_suggestion: { species: "Hack" }, user_id: "evil" }),
    );
    expect(res.status).toBe(200);
    const updateArg = updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).not.toHaveProperty("ai_suggestion");
    expect(updateArg).not.toHaveProperty("user_id");
    expect(updateArg).toHaveProperty("name", "Cactus");
  });

  it("returns 200 with { id } on a valid single-field patch", async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };
    vi.mocked(createClient).mockReturnValue(mockClient as never);
    const res = await PATCH(fakeContext("PATCH", VALID_UUID, { species: "Rosa canina" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: VALID_UUID });
  });
});

describe("/api/plants/[id] — PATCH photo_path cleanup", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReturnValue(null);
    vi.mocked(removePhotos).mockClear();
    vi.mocked(removePhotos).mockResolvedValue(undefined);
  });

  it("removes orphaned old object when photo_path changes to a different value", async () => {
    const OLD_PATH = "uid/plantid/old-photo.jpg";
    const NEW_PATH = "uid/plantid/new-photo.jpg";

    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { photo_path: OLD_PATH }, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };
    vi.mocked(createClient).mockReturnValue(mockClient as never);

    const res = await PATCH(fakeContext("PATCH", VALID_UUID, { photo_path: NEW_PATH }));
    expect(res.status).toBe(200);
    expect(vi.mocked(removePhotos)).toHaveBeenCalledWith(mockClient, [OLD_PATH]);
  });

  it("does not call removePhotos when photo_path is set to the same value", async () => {
    const SAME_PATH = "uid/plantid/photo.jpg";

    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { photo_path: SAME_PATH }, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };
    vi.mocked(createClient).mockReturnValue(mockClient as never);

    const res = await PATCH(fakeContext("PATCH", VALID_UUID, { photo_path: SAME_PATH }));
    expect(res.status).toBe(200);
    expect(vi.mocked(removePhotos)).not.toHaveBeenCalled();
  });
});

describe("/api/plants/[id] — DELETE validation", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReturnValue(null);
    vi.mocked(removePhotos).mockResolvedValue(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await DELETE(fakeContext("DELETE", VALID_UUID, undefined, null));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 400 invalid_id for a non-UUID id", async () => {
    const res = await DELETE(fakeContext("DELETE", NOT_A_UUID));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_id" });
  });

  it("returns 503 when Supabase is unconfigured", async () => {
    const res = await DELETE(fakeContext("DELETE", VALID_UUID));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "supabase_unavailable" });
  });

  it("returns 200 with { id } and calls removePhotos on success", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { photo_path: "uid/plantid/photo.jpg" }, error: null });
    const selectEq = vi.fn().mockReturnValue({ maybeSingle });
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === "plants") {
          return {
            select: vi.fn().mockReturnValue({ eq: selectEq }),
            delete: vi.fn().mockReturnValue({ eq: deleteEq }),
          };
        }
        return {};
      }),
      storage: { from: vi.fn() },
    };
    vi.mocked(createClient).mockReturnValue(mockClient as never);

    const res = await DELETE(fakeContext("DELETE", VALID_UUID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: VALID_UUID });
    expect(vi.mocked(removePhotos)).toHaveBeenCalledWith(mockClient, ["uid/plantid/photo.jpg"]);
  });
});
