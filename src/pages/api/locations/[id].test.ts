import type { APIContext } from "astro";
import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase";
import { DELETE, PATCH } from "./[id]";

const VALID_UUID = "00000000-0000-0000-0000-000000000001";
const NOT_A_UUID = "not-a-uuid";

function fakeContext(method: "PATCH" | "DELETE", id: string, body?: unknown, user?: User | null): APIContext {
  return {
    locals: { user: user !== undefined ? user : ({ id: "test-user" } as User) },
    params: { id },
    cookies: {},
    request: new Request(`http://test.local/api/locations/${id}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  } as unknown as APIContext;
}

describe("/api/locations/[id] — validation", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReturnValue(null);
  });

  describe("PATCH", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await PATCH(fakeContext("PATCH", VALID_UUID, { name: "Garden" }, null));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    });

    it("returns 400 invalid_id for a non-UUID id", async () => {
      const res = await PATCH(fakeContext("PATCH", NOT_A_UUID, { name: "Garden" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_id" });
    });

    it("returns 400 invalid_name when name is empty after trim", async () => {
      const res = await PATCH(fakeContext("PATCH", VALID_UUID, { name: "  " }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_name" });
    });

    it("returns 400 invalid_name when name exceeds 100 characters", async () => {
      const res = await PATCH(fakeContext("PATCH", VALID_UUID, { name: "a".repeat(101) }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_name" });
    });

    it("returns 503 when Supabase is unconfigured", async () => {
      const res = await PATCH(fakeContext("PATCH", VALID_UUID, { name: "Garden" }));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "supabase_unavailable" });
    });
  });

  describe("DELETE", () => {
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
  });
});
