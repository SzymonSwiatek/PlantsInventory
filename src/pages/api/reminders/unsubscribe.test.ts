import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("astro:env/server", () => ({
  REMINDER_UNSUBSCRIBE_SECRET: "test-secret",
  SUPABASE_URL: "http://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

vi.mock("@/lib/reminders/unsubscribe-token", () => ({
  verifyUnsubscribeToken: vi.fn(),
}));

import { createClient } from "@supabase/supabase-js";
import { verifyUnsubscribeToken } from "@/lib/reminders/unsubscribe-token";
import { GET, POST } from "./unsubscribe";

const VALID_USER = "00000000-0000-0000-0000-000000000001";
const VALID_TOKEN = "validtoken";

function makeRequest(method: "GET" | "POST", params?: { u?: string; t?: string }): APIContext {
  const url = new URL("http://test.local/api/reminders/unsubscribe");
  if (params?.u) url.searchParams.set("u", params.u);
  if (params?.t) url.searchParams.set("t", params.t);
  return {
    request: new Request(url.toString(), { method }),
  } as unknown as APIContext;
}

function mockSupabase(upsertError: unknown = null) {
  const upsertFn = vi.fn().mockResolvedValue({ error: upsertError });
  vi.mocked(createClient).mockReturnValue({
    from: vi.fn().mockReturnValue({ upsert: upsertFn }),
  } as never);
  return { upsertFn };
}

describe("GET /api/reminders/unsubscribe", () => {
  beforeEach(() => {
    vi.mocked(verifyUnsubscribeToken).mockReset();
    vi.mocked(createClient).mockReturnValue(null as never);
  });

  it("returns 400 when u param is missing", async () => {
    const res = await GET(makeRequest("GET", { t: VALID_TOKEN }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when t param is missing", async () => {
    const res = await GET(makeRequest("GET", { u: VALID_USER }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when token verification fails", async () => {
    vi.mocked(verifyUnsubscribeToken).mockResolvedValue(false);
    const res = await GET(makeRequest("GET", { u: VALID_USER, t: "badtoken" }));
    expect(res.status).toBe(400);
  });

  it("flips reminders_enabled to false and returns 200 HTML on valid GET", async () => {
    vi.mocked(verifyUnsubscribeToken).mockResolvedValue(true);
    const { upsertFn } = mockSupabase();
    const res = await GET(makeRequest("GET", { u: VALID_USER, t: VALID_TOKEN }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Unsubscribed");
    expect(html).toContain("/settings");
    expect(upsertFn).toHaveBeenCalledWith({ user_id: VALID_USER, reminders_enabled: false }, expect.anything());
  });

  it("is idempotent — repeated GET with same token succeeds", async () => {
    vi.mocked(verifyUnsubscribeToken).mockResolvedValue(true);
    const { upsertFn } = mockSupabase();
    const res = await GET(makeRequest("GET", { u: VALID_USER, t: VALID_TOKEN }));
    expect(res.status).toBe(200);
    expect(upsertFn).toHaveBeenCalledOnce();
  });
});

describe("POST /api/reminders/unsubscribe (RFC 8058 one-click)", () => {
  beforeEach(() => {
    vi.mocked(verifyUnsubscribeToken).mockReset();
    vi.mocked(createClient).mockReturnValue(null as never);
  });

  it("returns 400 when params are missing", async () => {
    const res = await POST(makeRequest("POST", {}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when token is invalid", async () => {
    vi.mocked(verifyUnsubscribeToken).mockResolvedValue(false);
    const res = await POST(makeRequest("POST", { u: VALID_USER, t: "bad" }));
    expect(res.status).toBe(400);
  });

  it("flips reminders_enabled and returns 200 on valid one-click POST", async () => {
    vi.mocked(verifyUnsubscribeToken).mockResolvedValue(true);
    const { upsertFn } = mockSupabase();
    const res = await POST(makeRequest("POST", { u: VALID_USER, t: VALID_TOKEN }));
    expect(res.status).toBe(200);
    expect(upsertFn).toHaveBeenCalledWith({ user_id: VALID_USER, reminders_enabled: false }, expect.anything());
  });
});

describe("secret-unset degrade path", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("GET returns 404 when REMINDER_UNSUBSCRIBE_SECRET is unset", async () => {
    vi.doMock("astro:env/server", () => ({
      REMINDER_UNSUBSCRIBE_SECRET: undefined,
      SUPABASE_URL: "http://test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    }));
    vi.resetModules();
    const { GET: freshGET } = await import("./unsubscribe");
    const res = await freshGET(makeRequest("GET", { u: VALID_USER, t: VALID_TOKEN }));
    expect(res.status).toBe(404);
  });

  it("POST returns 404 when REMINDER_UNSUBSCRIBE_SECRET is unset", async () => {
    vi.doMock("astro:env/server", () => ({
      REMINDER_UNSUBSCRIBE_SECRET: undefined,
      SUPABASE_URL: "http://test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    }));
    vi.resetModules();
    const { POST: freshPOST } = await import("./unsubscribe");
    const res = await freshPOST(makeRequest("POST", { u: VALID_USER, t: VALID_TOKEN }));
    expect(res.status).toBe(404);
  });
});
