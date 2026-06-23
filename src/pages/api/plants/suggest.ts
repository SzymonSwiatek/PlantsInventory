import type { APIRoute } from "astro";
import { AI_API_KEY } from "astro:env/server";
import { json, requireUser } from "@/lib/api";
import { requestSuggestion } from "@/lib/ai/suggest";

/**
 * First JSON endpoint of the slice: receive a browser-downscaled base64 image,
 * return a normalized `AiSuggestion`, and degrade UNIFORMLY when AI is
 * unavailable. The client treats a missing key, a timeout, and a provider
 * error identically (`{ status: "ai_unavailable" }`, HTTP 200) so the manual
 * fallback path is the same regardless of why AI did not answer.
 *
 * `/api/*` is outside the middleware guard — this endpoint self-guards.
 */

const AI_TIMEOUT_MS = 12_000;

// Gemini inline-data vision formats we accept. The client downscaler always
// emits `image/jpeg`; the rest cover direct/native uploads without widening the
// surface to arbitrary `mimeType` strings forwarded to the paid provider.
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Decoded-byte cap on the inline image. The browser downscale (longest edge
// 1024px, JPEG q0.8) yields well under 1 MB; 7 MB is a generous ceiling that
// still blocks abuse and stays clear of Gemini's ~20 MB inline request limit.
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;

export const POST: APIRoute = async (context) => {
  const user = requireUser(context);
  if (user instanceof Response) {
    return user;
  }

  // Missing key → degrade to manual (PRD guardrail: catalog survives AI outage).
  if (!AI_API_KEY) {
    return json({ status: "ai_unavailable" });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ status: "error", error: "invalid_json" }, 400);
  }

  const imageBase64 = readString(body, "imageBase64");
  const mimeType = readString(body, "mimeType");
  if (!imageBase64 || !mimeType) {
    return json({ status: "error", error: "missing_image" }, 400);
  }

  // Don't forward an unrecognized format or an oversized payload to the paid
  // provider — reject at the edge before the AI call.
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return json({ status: "error", error: "unsupported_media_type" }, 415);
  }
  if (!isLikelyBase64(imageBase64) || decodedByteLength(imageBase64) > MAX_IMAGE_BYTES) {
    return json({ status: "error", error: "image_too_large" }, 413);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, AI_TIMEOUT_MS);
  try {
    const suggestion = await requestSuggestion(AI_API_KEY, imageBase64, mimeType, controller.signal);
    return json({ status: "ok", suggestion });
  } catch (err) {
    // Timeout, transport failure, non-2xx, or unparseable body all collapse here.
    // Logged for prod observability — the client only ever sees `ai_unavailable`.
    // eslint-disable-next-line no-console
    console.error("[plants/suggest] AI suggestion failed:", err);
    return json({ status: "ai_unavailable" });
  } finally {
    clearTimeout(timer);
  }
};

function readString(body: unknown, key: string): string | null {
  if (typeof body === "object" && body !== null && key in body) {
    const value = (body as Record<string, unknown>)[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  }
  return null;
}

/** Cheap shape check: standard base64 alphabet with optional `=` padding. */
function isLikelyBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/** Decoded byte length of a base64 string, derived from its length + padding. */
function decodedByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}
