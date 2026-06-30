import type { DiagnosisMessage } from "@/types";

/**
 * Provider seam for multi-turn plant disease diagnosis via Gemini.
 * Mirrors the conventions of suggest.ts: same model, same header, same
 * retry/backoff, same extractText — but uses prose output (no JSON schema)
 * and builds a multi-turn `contents` array from the caller-supplied history.
 *
 * The image is re-attached to the first user turn on every call because the
 * endpoint is stateless and holds no photo between requests.
 */

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const MAX_OUTPUT_TOKENS = 2500;

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 600;

/** Polish botanist system instruction, date-anchored for seasonal context. */
export function buildDiagnosisPrompt(today: string): string {
  return (
    "Jesteś doświadczonym botanikiem i fitopatolożem. Pomagasz użytkownikom diagnozować " +
    "choroby i problemy pielęgnacyjne roślin na podstawie zdjęcia. " +
    "Odpowiadaj wyłącznie po polsku, w swobodnym, konwersacyjnym tonie. " +
    `Dzisiejsza data to ${today}. ` +
    "Opisz, co widzisz na zdjęciu, zidentyfikuj możliwe schorzenia lub problemy " +
    "i zaproponuj konkretne działania naprawcze. Jeśli nie jesteś pewien, powiedz o tym wprost."
  );
}

/**
 * Call Gemini with the full conversation history and the photo (re-sent every
 * turn). Returns the assistant reply text or throws — the caller maps any
 * throw to `ai_unavailable`.
 */
export async function requestDiagnosis(
  apiKey: string,
  messages: DiagnosisMessage[],
  image: { base64: string; mimeType: string },
  signal: AbortSignal,
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);

  // Build Gemini contents array. The first user turn carries the system
  // instruction + the image + the user's question as separate parts.
  const contents = messages.map((msg, idx) => {
    if (idx === 0) {
      return {
        role: "user",
        parts: [
          { text: buildDiagnosisPrompt(today) },
          { inlineData: { mimeType: image.mimeType, data: image.base64 } },
          { text: msg.content },
        ],
      };
    }
    return { role: msg.role, parts: [{ text: msg.content }] };
  });

  const requestBody = JSON.stringify({
    contents,
    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
  });

  let lastStatus = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: requestBody,
    });

    if (res.ok) {
      const data: unknown = await res.json();
      const text = extractText(data);
      if (text === null) {
        // Thinking may have consumed the entire token budget leaving no text part.
        throw new Error("Gemini diagnosis response missing text part (possible MAX_TOKENS)");
      }
      return text;
    }

    lastStatus = res.status;
    if (attempt < MAX_ATTEMPTS && RETRYABLE_STATUSES.has(res.status)) {
      await sleep(RETRY_BASE_DELAY_MS * attempt, signal);
      continue;
    }
    break;
  }

  throw new Error(`Gemini diagnosis request failed: ${lastStatus.toString()}`);
}

/** Walk candidates[0].content.parts[*].text defensively. */
function extractText(data: unknown): string | null {
  if (!isRecord(data) || !Array.isArray(data.candidates)) return null;
  const first: unknown = data.candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) return null;
  for (const part of first.content.parts) {
    if (isRecord(part) && typeof part.text === "string" && part.text.length > 0) {
      return part.text;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const handle: { timer?: ReturnType<typeof setTimeout> } = {};
    const onAbort = () => {
      if (handle.timer !== undefined) clearTimeout(handle.timer);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    handle.timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
  });
}
