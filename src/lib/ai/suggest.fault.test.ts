import { getGlobalDispatcher, MockAgent, setGlobalDispatcher, type Dispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { requestSuggestion } from "@/lib/ai/suggest";

// Lib-level abort propagation (Risk #1). The handler's 12 s timeout relies on
// `requestSuggestion` honouring its `AbortSignal` and propagating an abort as a
// throw (which the handler's catch then converts to `ai_unavailable`). We prove
// that here directly: with the provider holding the response open, aborting the
// in-flight call must reject. The network edge is stubbed (undici `MockAgent`) —
// `requestSuggestion` itself is the unit under test, never mocked. Together with
// the handler fault test's "a thrown call degrades", this proves the timeout
// works without a real 12 s sleep or fragile fake timers across undici.

const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";
const GEMINI_PATH = "/v1beta/models/gemini-2.5-flash:generateContent";

describe("requestSuggestion — abort propagation", () => {
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
  });

  it("rejects when the signal aborts while the provider holds the response open", async () => {
    // Reply is delayed well beyond the abort, so the request is genuinely
    // in-flight when we abort it (not pre-aborted before fetch starts).
    mockAgent
      .get(GEMINI_ORIGIN)
      .intercept({ path: GEMINI_PATH, method: "POST" })
      .reply(200, { candidates: [{ content: { parts: [{ text: "{}" }] } }] })
      .delay(5_000);

    const controller = new AbortController();
    const pending = requestSuggestion("test-key", "aGVsbG8=", "image/png", controller.signal);
    setTimeout(() => {
      controller.abort();
    }, 20);

    await expect(pending).rejects.toThrow();
  });
});
