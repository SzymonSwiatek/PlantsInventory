import type { APIRoute } from "astro";
import { AI_API_KEY } from "astro:env/server";
import { json, requireUser, requireSameOrigin } from "@/lib/api";
import { requestDiagnosis } from "@/lib/ai/diagnose";
import {
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_BYTES,
  readString,
  isLikelyBase64,
  decodedByteLength,
} from "@/lib/ai/image-guards";
import type { DiagnosisMessage } from "@/types";

/**
 * Multi-turn AI chat endpoint for plant disease diagnosis.
 *
 * The client sends the complete conversation history plus the photo on every
 * request (the server is stateless — it re-attaches the image to the first
 * user turn before calling Gemini). Cost ceilings: MAX_TURNS per conversation,
 * MAX_OUTPUT_TOKENS per reply, AI_TIMEOUT_MS per request.
 *
 * Guard order: requireSameOrigin → requireUser → key check → validation → AI.
 * All failure paths collapse to `{ status: "ai_unavailable" }` at HTTP 200.
 */

const AI_TIMEOUT_MS = 30_000;
const MAX_TURNS = 10;

export const POST: APIRoute = async (context) => {
  const originErr = requireSameOrigin(context.request);
  if (originErr) return originErr;

  const user = requireUser(context);
  if (user instanceof Response) return user;

  if (!AI_API_KEY) {
    return json({ status: "ai_unavailable" });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ status: "error", error: "invalid_json" }, 400);
  }

  if (!isRecord(body) || !Array.isArray(body.messages)) {
    return json({ status: "error", error: "missing_messages" }, 400);
  }

  const rawMessages = body.messages as unknown[];

  if (rawMessages.length === 0) {
    return json({ status: "error", error: "missing_messages" }, 400);
  }
  if (rawMessages.length > MAX_TURNS) {
    return json({ status: "error", error: "turn_limit_exceeded" }, 400);
  }

  const messages: DiagnosisMessage[] = [];
  for (const msg of rawMessages) {
    if (!isRecord(msg) || (msg.role !== "user" && msg.role !== "model") || typeof msg.content !== "string") {
      return json({ status: "error", error: "invalid_message" }, 400);
    }
    messages.push({ role: msg.role, content: msg.content });
  }

  // Image is required on every request — the stateless endpoint re-attaches it
  // to the first user turn before calling Gemini.
  const imageObj: unknown = isRecord(body) ? body.image : undefined;
  if (!isRecord(imageObj)) {
    return json({ status: "error", error: "missing_image" }, 400);
  }

  const imageBase64 = readString(imageObj, "base64");
  const mimeType = readString(imageObj, "mimeType");
  if (!imageBase64 || !mimeType) {
    return json({ status: "error", error: "missing_image" }, 400);
  }

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
    const reply = await requestDiagnosis(AI_API_KEY, messages, { base64: imageBase64, mimeType }, controller.signal);
    return json({ status: "ok", reply });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[diagnose] AI diagnosis failed:", err);
    return json({ status: "ai_unavailable" });
  } finally {
    clearTimeout(timer);
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
