import type { APIRoute } from "astro";
import { json, requireUser, requireSameOrigin, UUID_RE } from "@/lib/api";
import { createClient } from "@/lib/supabase";

/**
 * Mint a one-time signed upload URL so the browser can `PUT` the full-res photo
 * DIRECTLY to Storage — the bytes never transit the Worker (decoding a ~10 MB
 * image trips the free-tier 10 ms CPU budget; see the F-02 storage migration).
 *
 * The plant row does not exist yet: we pre-mint `plantId` here so it can become
 * both the photo folder (`<uid>/<plantId>/<file>`) and, in Phase 5, the row id.
 * On a retake the client sends the same `plantId` back so the existing object is
 * overwritten in place (`upsert`) rather than orphaning a second file.
 *
 * Object key MUST start with `auth.uid()` — Storage RLS gates on the first path
 * segment only, so any key not under the caller's uid is rejected on write/read.
 *
 * `/api/*` is outside the middleware guard — this endpoint self-guards.
 */

const PHOTO_BUCKET = "plant-photos";
const ALLOWED_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export const POST: APIRoute = async (context) => {
  const originErr = requireSameOrigin(context.request);
  if (originErr) return originErr;

  const user = requireUser(context);
  if (user instanceof Response) {
    return user;
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const locationId = readString(body, "locationId");
  const filename = readString(body, "filename");
  const contentType = readString(body, "contentType");
  const suppliedPlantId = readString(body, "plantId");

  if (!locationId || !filename || !contentType) {
    return json({ error: "missing_field" }, 400);
  }
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return json({ error: "unsupported_content_type" }, 400);
  }
  // A supplied plantId only ever comes from a prior mint (retake). Validate its
  // shape so it can't smuggle extra path segments into the storage key.
  if (suppliedPlantId !== null && !UUID_RE.test(suppliedPlantId)) {
    return json({ error: "invalid_plant_id" }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "supabase_unavailable" }, 503);
  }

  // RLS-scoped: a foreign or missing location is indistinguishable here, both 404.
  const { data: location, error: locationError } = await supabase
    .from("locations")
    .select("id")
    .eq("id", locationId)
    .maybeSingle();
  if (locationError || !location) {
    return json({ error: "location_not_found" }, 404);
  }

  // Reuse the supplied id on a retake, else mint a fresh one for the first call.
  const plantId = suppliedPlantId ?? crypto.randomUUID();
  const path = `${user.id}/${plantId}/${sanitizeFilename(filename)}`;

  // `upsert: true` lets a retake overwrite the object at the same key; the
  // default rejects an existing key. The returned `signedUrl` is ABSOLUTE and
  // carries the token, so the browser PUTs to it with no Supabase secret.
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[plants/upload-url] failed to mint signed upload URL:", error);
    return json({ error: "sign_failed" }, 500);
  }

  return json({ plantId, path: data.path, token: data.token, signedUrl: data.signedUrl });
};

function readString(body: unknown, key: string): string | null {
  if (typeof body === "object" && body !== null && key in body) {
    const value = (body as Record<string, unknown>)[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  }
  return null;
}

/**
 * Reduce a user-supplied filename to a safe single path segment: drop any
 * directory parts, keep only `[A-Za-z0-9._-]`, collapse the rest to `_`. Never
 * empty (the `<uid>/<plantId>/` prefix is what Storage RLS actually enforces).
 */
function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned : "photo";
}
