import type { APIContext } from "astro";
import type { User } from "@supabase/supabase-js";
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher, type Dispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-process handler fault test (Risk #1) — Docker-free, runs under the unit
// runner (`npm run test:run`). Covers the catch → `ai_unavailable` conversion in
// `/api/plants/suggest` that the missing-key path NEVER exercises (it
// short-circuits at `suggest.ts:25-27`, above the try/catch). We stub ONLY the
// provider HTTP edge (the hardcoded Gemini endpoint) via undici's `MockAgent` —
// never `vi.mock` our own `requestSuggestion`, which would test only the mock.
//
// `astro:env/server` is mocked so the handler passes the key check and reaches
// the AI call; the AI key value is irrelevant once the network edge is stubbed.

vi.mock("astro:env/server", () => ({ AI_API_KEY: "test-key" }));

const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";
const GEMINI_PATH = "/v1beta/models/gemini-2.5-flash:generateContent";

// A well-formed Gemini envelope whose inner text part is the variable under test.
function geminiEnvelope(innerText: string): object {
  return { candidates: [{ content: { parts: [{ text: innerText }] } }] };
}

// Minimal fake APIContext: a sessioned user (passes `requireUser`) and a real
// Request carrying a valid suggest body.
function fakeContext(): APIContext {
  return {
    locals: { user: { id: "test-user" } as User },
    request: new Request("http://test.local/api/plants/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: "aGVsbG8=", mimeType: "image/png" }),
    }),
  } as unknown as APIContext;
}

describe("/api/plants/suggest — provider-fault → ai_unavailable conversion", () => {
  let mockAgent: MockAgent;
  let originalDispatcher: Dispatcher;

  beforeEach(() => {
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
    const { POST } = await import("./suggest");
    const res = await POST(fakeContext());
    return { status: res.status, body: await res.json() };
  }

  it("degrades when the provider returns 500 for all retry attempts (retryable exhausted)", async () => {
    mockAgent.get(GEMINI_ORIGIN).intercept({ path: GEMINI_PATH, method: "POST" }).reply(500, "upstream error").times(3);

    const { status, body } = await invoke();
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ai_unavailable" });
  });

  it("degrades when the provider 200 body is missing the JSON text part", async () => {
    mockAgent.get(GEMINI_ORIGIN).intercept({ path: GEMINI_PATH, method: "POST" }).reply(200, { candidates: [] }); // no content.parts[].text → extraction throws

    const { status, body } = await invoke();
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ai_unavailable" });
  });

  it("degrades when the provider 200 text part is not valid JSON", async () => {
    mockAgent
      .get(GEMINI_ORIGIN)
      .intercept({ path: GEMINI_PATH, method: "POST" })
      .reply(200, geminiEnvelope("this is not json {{{")); // JSON.parse(text) throws

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
