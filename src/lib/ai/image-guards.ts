/**
 * Shared image-validation helpers used by both /api/plants/suggest and
 * /api/diagnose. Kept in one place so both paid-AI endpoints enforce the
 * same limits and format checks.
 */

/** Gemini inline-data vision formats we accept. */
export const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Decoded-byte cap on the inline image. The browser downscale (longest edge
 * 1024px, JPEG q0.8) yields well under 1 MB; 7 MB is a generous ceiling that
 * still blocks abuse and stays clear of Gemini's ~20 MB inline request limit.
 */
export const MAX_IMAGE_BYTES = 7 * 1024 * 1024;

/** Extract a non-empty string field from an unknown JSON body. */
export function readString(body: unknown, key: string): string | null {
  if (typeof body === "object" && body !== null && key in body) {
    const value = (body as Record<string, unknown>)[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  }
  return null;
}

/** Cheap shape check: standard base64 alphabet with optional `=` padding. */
export function isLikelyBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/** Decoded byte length of a base64 string, derived from its length + padding. */
export function decodedByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}
