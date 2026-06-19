import type { APIRoute } from "astro";
import type { PlantUpdate } from "@/types";
import { json, requireUser, UUID_RE, CLIENT_ERROR_CODES } from "@/lib/api";
import { createClient } from "@/lib/supabase";
import { removePhotos } from "@/lib/storage";

// Whitelisted editable fields — ai_suggestion, user_id, id, and timestamps are never accepted.
const WHITELIST = new Set([
  "name",
  "species",
  "description",
  "sunlight",
  "note",
  "watering_interval_days",
  "winterization_cutoff",
  "location_id",
  "photo_path",
]);

export const PATCH: APIRoute = async (context) => {
  const user = requireUser(context);
  if (user instanceof Response) {
    return user;
  }

  const { id } = context.params;
  if (!id || !UUID_RE.test(id)) {
    return json({ error: "invalid_id" }, 400);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "supabase_unavailable" }, 503);
  }

  const update: PlantUpdate = {};

  if (has(body, "name")) {
    const name = emptyToNull(readString(body, "name"));
    if (!name || name.length < 1 || name.length > 100) {
      return json({ error: "invalid_name" }, 400);
    }
    update.name = name;
  }

  if (has(body, "species")) {
    update.species = emptyToNull(readString(body, "species"));
  }

  if (has(body, "description")) {
    update.description = emptyToNull(readString(body, "description"));
  }

  if (has(body, "sunlight")) {
    update.sunlight = emptyToNull(readString(body, "sunlight"));
  }

  if (has(body, "note")) {
    update.note = emptyToNull(readString(body, "note"));
  }

  if (has(body, "watering_interval_days")) {
    const w = asPositiveInt(readValue(body, "watering_interval_days"));
    if (w === INVALID) {
      return json({ error: "invalid_watering_interval" }, 400);
    }
    update.watering_interval_days = w;
  }

  if (has(body, "winterization_cutoff")) {
    update.winterization_cutoff = emptyToNull(readString(body, "winterization_cutoff"));
  }

  if (has(body, "location_id")) {
    const loc = readString(body, "location_id");
    if (!loc || !UUID_RE.test(loc)) {
      return json({ error: "invalid_location_id" }, 400);
    }
    update.location_id = loc;
  }

  if (has(body, "photo_path")) {
    update.photo_path = emptyToNull(readString(body, "photo_path"));
  }

  // Strip non-whitelisted keys (safety net: only the above assignments reach `update`)
  const whitelistedKeys = Object.keys(update).filter((k) => WHITELIST.has(k));
  if (whitelistedKeys.length === 0) {
    return json({ error: "no_fields" }, 400);
  }

  // When photo_path changes, collect the current path for best-effort orphan removal.
  let oldPhotoPath: string | null = null;
  if ("photo_path" in update) {
    const { data: current } = await supabase.from("plants").select("photo_path").eq("id", id).maybeSingle();
    oldPhotoPath = current?.photo_path ?? null;
  }

  const { error } = await supabase.from("plants").update(update).eq("id", id);
  if (error) {
    if (error.code && CLIENT_ERROR_CODES.has(error.code)) {
      return json({ error: "invalid_request" }, 400);
    }
    // eslint-disable-next-line no-console
    console.error("[plants] PATCH failed:", error);
    return json({ error: "update_failed" }, 500);
  }

  // Best-effort removal of the now-orphaned old photo object when path changed.
  if ("photo_path" in update && oldPhotoPath && oldPhotoPath !== update.photo_path) {
    await removePhotos(supabase, [oldPhotoPath]);
  }

  return json({ id }, 200);
};

export const DELETE: APIRoute = async (context) => {
  const user = requireUser(context);
  if (user instanceof Response) {
    return user;
  }

  const { id } = context.params;
  if (!id || !UUID_RE.test(id)) {
    return json({ error: "invalid_id" }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "supabase_unavailable" }, 503);
  }

  // Collect the photo path before deleting so we can best-effort remove the object.
  const { data: plant, error: fetchError } = await supabase
    .from("plants")
    .select("photo_path")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) {
    // eslint-disable-next-line no-console
    console.error("[plants] DELETE photo-path collect failed:", fetchError);
  }
  const photoPath = plant?.photo_path ?? null;

  const { error } = await supabase.from("plants").delete().eq("id", id);
  if (error) {
    if (error.code && CLIENT_ERROR_CODES.has(error.code)) {
      return json({ error: "invalid_request" }, 400);
    }
    // eslint-disable-next-line no-console
    console.error("[plants] DELETE failed:", error);
    return json({ error: "delete_failed" }, 500);
  }

  if (photoPath) {
    await removePhotos(supabase, [photoPath]);
  }

  return json({ id }, 200);
};

// ── helpers ──────────────────────────────────────────────────────────────────

const INVALID = Symbol("invalid");

function has(body: unknown, key: string): boolean {
  return typeof body === "object" && body !== null && key in body;
}

function readValue(body: unknown, key: string): unknown {
  if (has(body, key)) {
    return (body as Record<string, unknown>)[key];
  }
  return undefined;
}

function readString(body: unknown, key: string): string | null {
  const value = readValue(body, key);
  return typeof value === "string" ? value : null;
}

function emptyToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asPositiveInt(value: unknown): number | null | typeof INVALID {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 1) return INVALID;
  return n;
}
