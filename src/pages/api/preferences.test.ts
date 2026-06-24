import type { APIContext } from "astro";
import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase";
import { POST } from "./preferences";

const USER_ID = "00000000-0000-0000-0000-000000000001";

function fakeContext(body?: unknown, user?: User | null, hasOrigin = false): APIContext {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (hasOrigin) headers.Origin = "http://test.local";
  return {
    locals: { user: user !== undefined ? user : ({ id: USER_ID } as User) },
    params: {},
    cookies: {},
    request: new Request("http://test.local/api/preferences", {
      method: "POST",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  } as unknown as APIContext;
}

function mockClient(upsertError: unknown = null) {
  const upsertFn = vi.fn().mockResolvedValue({ error: upsertError });
  vi.mocked(createClient).mockReturnValue({
    from: vi.fn().mockReturnValue({ upsert: upsertFn }),
  } as never);
  return { upsertFn };
}

describe("POST /api/preferences — auth & validation", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReturnValue(null);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await POST(fakeContext({ remindersEnabled: false }, null));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("returns 503 when Supabase is unconfigured", async () => {
    const res = await POST(fakeContext({ remindersEnabled: false }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "supabase_unavailable" });
  });

  it("returns 400 when body is not valid JSON", async () => {
    vi.mocked(createClient).mockReturnValue({} as never);
    const ctx = {
      locals: { user: { id: USER_ID } as User },
      params: {},
      cookies: {},
      request: new Request("http://test.local/api/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
    } as unknown as APIContext;
    const res = await POST(ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_json" });
  });

  it("returns 400 when remindersEnabled is missing", async () => {
    vi.mocked(createClient).mockReturnValue({} as never);
    const res = await POST(fakeContext({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_body" });
  });

  it("returns 400 when remindersEnabled is not a boolean", async () => {
    vi.mocked(createClient).mockReturnValue({} as never);
    const res = await POST(fakeContext({ remindersEnabled: "yes" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_body" });
  });
});

describe("POST /api/preferences — happy path", () => {
  it("upserts reminders_enabled=false and returns it", async () => {
    const { upsertFn } = mockClient();
    const res = await POST(fakeContext({ remindersEnabled: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ remindersEnabled: false });
    expect(upsertFn).toHaveBeenCalledWith({ user_id: USER_ID, reminders_enabled: false }, { onConflict: "user_id" });
  });

  it("upserts reminders_enabled=true and returns it", async () => {
    const { upsertFn } = mockClient();
    const res = await POST(fakeContext({ remindersEnabled: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ remindersEnabled: true });
    expect(upsertFn).toHaveBeenCalledWith({ user_id: USER_ID, reminders_enabled: true }, { onConflict: "user_id" });
  });

  it("returns 403 when Origin header is cross-origin", async () => {
    const ctx = {
      locals: { user: { id: USER_ID } as User },
      params: {},
      cookies: {},
      request: new Request("http://test.local/api/preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://evil.example.com",
        },
        body: JSON.stringify({ remindersEnabled: false }),
      }),
    } as unknown as APIContext;
    const res = await POST(ctx);
    expect(res.status).toBe(403);
  });

  it("returns 500 when upsert fails", async () => {
    mockClient({ message: "db error", code: "XXXXX" });
    const res = await POST(fakeContext({ remindersEnabled: false }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "upsert_failed" });
  });
});
