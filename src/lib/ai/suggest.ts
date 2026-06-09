import type { AiSuggestion } from "@/types";

/**
 * Provider call + provider-agnostic normalization for the AI species/care
 * suggestion. Swapping providers later should touch only this file.
 *
 * The API key is injected by the caller (the `/api/plants/suggest` endpoint
 * owns env access) so this module imports nothing from `astro:env` or the
 * network at the top level — `normalizeSuggestion` stays a pure, eval-able
 * function with only a (type-erased) DTO import.
 *
 * Provider: Google Gemini `generateContent` (free-tier Flash, vision + JSON
 * structured output). Verified against the v1beta REST contract (June 2026):
 * image as `inlineData`, JSON mode via `responseMimeType` + `responseSchema`,
 * key passed as the `x-goog-api-key` header. The model id is a code constant
 * (overridable later — no extra env var this slice).
 */

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const PROMPT =
  "You are a botanist assistant for a houseplant care app. Identify the plant in this photo " +
  "and return its care profile as JSON. Fields: `species` (common name, or best guess), " +
  "`description` (one or two short sentences), `sunlight` (a short phrase, e.g. 'bright indirect light'), " +
  "`watering_interval_days` (typical days between waterings, a positive integer), and " +
  "`winterization_cutoff` (the month/day each year after which the plant should be brought indoors or " +
  "protected, as an ISO 'YYYY-MM-DD' date for the upcoming season, or null if it does not apply). " +
  "Use null for any field you cannot determine. Do not guess wildly — null is better than a bad value.";

/**
 * Gemini `responseSchema` (OpenAPI-3 subset, uppercase type names). Every
 * field is nullable so the model can omit anything it cannot determine.
 */
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    species: { type: "STRING", nullable: true },
    description: { type: "STRING", nullable: true },
    sunlight: { type: "STRING", nullable: true },
    watering_interval_days: { type: "INTEGER", nullable: true },
    winterization_cutoff: { type: "STRING", nullable: true },
  },
};

/** Transient upstream statuses worth a quick retry within the abort budget. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 600;

/**
 * Call Gemini with the downscaled image and return a normalized suggestion.
 * Retries transient upstream errors (free-tier 503 "model overloaded", 429
 * spikes) a couple of times within the caller's abort budget. Throws on a
 * non-retryable status, exhausted retries, transport error, or an unparseable
 * body — the caller (`/api/plants/suggest`) catches and degrades to
 * `ai_unavailable`.
 */
export async function requestSuggestion(
  apiKey: string,
  base64: string,
  mimeType: string,
  signal: AbortSignal,
): Promise<AiSuggestion> {
  const requestBody = JSON.stringify({
    contents: [
      {
        parts: [{ text: PROMPT }, { inlineData: { mimeType, data: base64 } }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  let lastStatus = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: requestBody,
    });

    if (res.ok) {
      const data: unknown = await res.json();
      const text = extractText(data);
      if (text === null) {
        throw new Error("Gemini response missing JSON text part");
      }
      const parsed: unknown = JSON.parse(text);
      return normalizeSuggestion(parsed);
    }

    lastStatus = res.status;
    if (attempt < MAX_ATTEMPTS && RETRYABLE_STATUSES.has(res.status)) {
      await sleep(RETRY_BASE_DELAY_MS * attempt, signal);
      continue;
    }
    break;
  }

  throw new Error(`Gemini request failed: ${lastStatus.toString()}`);
}

/** Resolve after `ms`, or reject early if `signal` aborts (keeps retries inside the abort budget). */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const handle: { timer?: ReturnType<typeof setTimeout> } = {};
    const onAbort = () => {
      if (handle.timer !== undefined) {
        clearTimeout(handle.timer);
      }
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    handle.timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
  });
}

/**
 * Coerce an arbitrary provider payload into the `AiSuggestion` DTO. Pure: no
 * network or provider import. Every field falls back to null; numeric/date
 * fields are validated, not just cast.
 */
export function normalizeSuggestion(raw: unknown): AiSuggestion {
  const obj = isRecord(raw) ? raw : {};
  return {
    species: asNonEmptyString(obj.species),
    description: asNonEmptyString(obj.description),
    sunlight: asNonEmptyString(obj.sunlight),
    watering_interval_days: asPositiveInt(obj.watering_interval_days),
    winterization_cutoff: asIsoDate(obj.winterization_cutoff),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Walk `candidates[0].content.parts[*].text` defensively. */
function extractText(data: unknown): string | null {
  if (!isRecord(data) || !Array.isArray(data.candidates)) {
    return null;
  }
  const first: unknown = data.candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) {
    return null;
  }
  for (const part of first.content.parts) {
    if (isRecord(part) && typeof part.text === "string" && part.text.length > 0) {
      return part.text;
    }
  }
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asPositiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) {
    return null;
  }
  const rounded = Math.round(n);
  return rounded > 0 ? rounded : null;
}

/** Accept a leading `YYYY-MM-DD`, else any Date-parseable string; else null. */
function asIsoDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const leading = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (leading) {
    const candidate = leading[1];
    if (!Number.isNaN(new Date(`${candidate}T00:00:00Z`).getTime())) {
      return candidate;
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}
