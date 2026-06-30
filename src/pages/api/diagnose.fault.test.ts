import type { APIContext } from "astro";
import type { User } from "@supabase/supabase-js";
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher, type Dispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-process handler fault tests — mirrors suggest.fault.test.ts conventions.
// Covers the security + degrade contract for /api/diagnose:
//   - missing AI_API_KEY short-circuit → ai_unavailable (no fetch)
//   - requireSameOrigin fires before requireUser (CSRF ordering)
//   - input validation gates: bad MIME → 415, oversized image → 413,
//     over-turn-cap → 400, over-content-length → 400
//   - provider fault paths: upstream error, empty-candidate/MAX_TOKENS → ai_unavailable at 200
//
// Module mocks are registered per-describe via vi.doMock + vi.resetModules so
// each group controls the AI_API_KEY value independently.

const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";
const GEMINI_PATH = "/v1beta/models/gemini-2.5-flash:generateContent";

function validBody(): string {
  return JSON.stringify({
    messages: [{ role: "user", content: "Co się dzieje z moją rośliną?" }],
    image: { base64: "aGVsbG8=", mimeType: "image/png" },
  });
}

function fakeContext(bodyOverride?: string): APIContext {
  return {
    locals: { user: { id: "test-user" } as User },
    request: new Request("http://test.local/api/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyOverride ?? validBody(),
    }),
  } as unknown as APIContext;
}

// Cross-origin request with no authenticated user — used to prove CSRF ordering.
function crossOriginContext(): APIContext {
  return {
    locals: {},
    request: new Request("http://test.local/api/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.com" },
      body: validBody(),
    }),
  } as unknown as APIContext;
}

// ── missing AI_API_KEY ────────────────────────────────────────────────────────

describe("/api/diagnose — missing AI_API_KEY", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("astro:env/server", () => ({ AI_API_KEY: undefined }));
  });
  afterEach(() => {
    vi.resetModules();
  });

  it("returns ai_unavailable at 200 with no upstream fetch", async () => {
    const { POST } = await import("./diagnose");
    const res = await POST(fakeContext());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ai_unavailable" });
  });
});

// ── CSRF guard ordering ───────────────────────────────────────────────────────

describe("/api/diagnose — CSRF guard ordering", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("astro:env/server", () => ({ AI_API_KEY: "test-key" }));
  });
  afterEach(() => {
    vi.resetModules();
  });

  it("returns 403 for cross-origin before 401 for missing user (requireSameOrigin first)", async () => {
    const { POST } = await import("./diagnose");
    // If requireUser fired first we would get 401; 403 proves CSRF guard runs first.
    const res = await POST(crossOriginContext());
    expect(res.status).toBe(403);
  });
});

// ── input validation (no AI call) ─────────────────────────────────────────────

describe("/api/diagnose — input validation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("astro:env/server", () => ({ AI_API_KEY: "test-key" }));
  });
  afterEach(() => {
    vi.resetModules();
  });

  it("returns 415 for a disallowed MIME type", async () => {
    const { POST } = await import("./diagnose");
    const body = JSON.stringify({
      messages: [{ role: "user", content: "Pytanie" }],
      image: { base64: "aGVsbG8=", mimeType: "image/gif" },
    });
    const res = await POST(fakeContext(body));
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: "unsupported_media_type" });
  });

  it("returns 413 for an oversized image (decoded size exceeds 7 MB cap)", async () => {
    const { POST } = await import("./diagnose");
    // 9 786 712 base64 chars → decoded ≈ 7 340 034 bytes, just over the 7 MB cap
    const oversized = "A".repeat(9_786_712);
    const body = JSON.stringify({
      messages: [{ role: "user", content: "Pytanie" }],
      image: { base64: oversized, mimeType: "image/png" },
    });
    const res = await POST(fakeContext(body));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "image_too_large" });
  });

  it("returns 400 turn_limit_exceeded when messages exceed MAX_TURNS (10)", async () => {
    const { POST } = await import("./diagnose");
    const messages = Array.from({ length: 11 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "model",
      content: `Wiadomość ${i.toString()}`,
    }));
    const body = JSON.stringify({
      messages,
      image: { base64: "aGVsbG8=", mimeType: "image/png" },
    });
    const res = await POST(fakeContext(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "turn_limit_exceeded" });
  });

  it("returns 400 content_too_long when a message exceeds MAX_CONTENT_CHARS (12 000)", async () => {
    const { POST } = await import("./diagnose");
    const body = JSON.stringify({
      messages: [{ role: "user", content: "A".repeat(12_001) }],
      image: { base64: "aGVsbG8=", mimeType: "image/png" },
    });
    const res = await POST(fakeContext(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "content_too_long" });
  });
});

// ── provider faults (key present, MockAgent) ──────────────────────────────────

describe("/api/diagnose — provider-fault → ai_unavailable conversion", () => {
  let mockAgent: MockAgent;
  let originalDispatcher: Dispatcher;

  beforeEach(() => {
    vi.resetModules();
    vi.doMock("astro:env/server", () => ({ AI_API_KEY: "test-key" }));
    originalDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(async () => {
    setGlobalDispatcher(originalDispatcher);
    await mockAgent.close();
    vi.resetModules();
  });

  async function invoke(): Promise<{ status: number; body: unknown }> {
    const { POST } = await import("./diagnose");
    const res = await POST(fakeContext());
    return { status: res.status, body: await res.json() };
  }

  it("degrades when the provider returns 500 for all retry attempts (retryable exhausted)", async () => {
    mockAgent.get(GEMINI_ORIGIN).intercept({ path: GEMINI_PATH, method: "POST" }).reply(500, "upstream error").times(3);

    const { status, body } = await invoke();
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ai_unavailable" });
  });

  it("degrades when the provider 200 body has empty candidates (no text part)", async () => {
    mockAgent.get(GEMINI_ORIGIN).intercept({ path: GEMINI_PATH, method: "POST" }).reply(200, { candidates: [] });

    const { status, body } = await invoke();
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ai_unavailable" });
  });

  it("degrades when MAX_TOKENS thinking budget is exhausted (candidate with no text part)", async () => {
    // Simulates Gemini returning a candidate whose finishReason is MAX_TOKENS
    // and whose parts contain only a thinking block with no visible text.
    mockAgent
      .get(GEMINI_ORIGIN)
      .intercept({ path: GEMINI_PATH, method: "POST" })
      .reply(200, {
        candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ thought: true, text: "" }] } }],
      });

    const { status, body } = await invoke();
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ai_unavailable" });
  });

  it("degrades on a transport failure (fetch rejects)", async () => {
    mockAgent
      .get(GEMINI_ORIGIN)
      .intercept({ path: GEMINI_PATH, method: "POST" })
      .replyWithError(new Error("ECONNRESET"));

    const { status, body } = await invoke();
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ai_unavailable" });
  });
});
