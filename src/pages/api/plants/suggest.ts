import type { APIRoute } from "astro";
import { AI_API_KEY } from "astro:env/server";
import { json, requireUser, requireSameOrigin } from "@/lib/api";
import { requestSuggestion } from "@/lib/ai/suggest";
import {
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_BYTES,
  readString,
  isLikelyBase64,
  decodedByteLength,
} from "@/lib/ai/image-guards";

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

export const POST: APIRoute = async (context) => {
  const originErr = requireSameOrigin(context.request);
  if (originErr) return originErr;

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
