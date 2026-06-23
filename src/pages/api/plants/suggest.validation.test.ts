import type { APIContext } from "astro";
import type { User } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

// Edge-validation tests for `/api/plants/suggest`. These reject BEFORE the AI
// call, so no provider network mock is needed — the key check just has to pass.
// (The fault path → `ai_unavailable` conversion lives in `suggest.fault.test.ts`.)

vi.mock("astro:env/server", () => ({ AI_API_KEY: "test-key" }));

function fakeContext(body: unknown): APIContext {
  return {
    locals: { user: { id: "test-user" } as User },
    request: new Request("http://test.local/api/plants/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as unknown as APIContext;
}

async function invoke(body: unknown): Promise<{ status: number; body: unknown }> {
  const { POST } = await import("./suggest");
  const res = await POST(fakeContext(body));
  return { status: res.status, body: await res.json() };
}

describe("/api/plants/suggest — request validation", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("rejects a missing image with 400", async () => {
    const { status, body } = await invoke({ mimeType: "image/jpeg" });
    expect(status).toBe(400);
    expect(body).toEqual({ status: "error", error: "missing_image" });
  });

  it("rejects an unsupported mime type with 415", async () => {
    const { status, body } = await invoke({ imageBase64: "aGVsbG8=", mimeType: "image/gif" });
    expect(status).toBe(415);
    expect(body).toEqual({ status: "error", error: "unsupported_media_type" });
  });

  it("rejects a non-base64 payload with 413", async () => {
    const { status, body } = await invoke({ imageBase64: "not base64!!", mimeType: "image/png" });
    expect(status).toBe(413);
    expect(body).toEqual({ status: "error", error: "image_too_large" });
  });

  it("rejects an oversized payload (>7 MB decoded) with 413", async () => {
    // 10 MB of base64 'A's decodes to ~7.5 MB — over the cap.
    const oversized = "A".repeat(10 * 1024 * 1024);
    const { status, body } = await invoke({ imageBase64: oversized, mimeType: "image/jpeg" });
    expect(status).toBe(413);
    expect(body).toEqual({ status: "error", error: "image_too_large" });
  });
});
