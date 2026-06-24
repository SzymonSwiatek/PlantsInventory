import type { APIRoute } from "astro";
import type { Json } from "@/db/database.types";
import type { PlantInsert } from "@/types";
import { json, requireUser, requireSameOrigin, UUID_RE, CLIENT_ERROR_CODES } from "@/lib/api";
import { createClient } from "@/lib/supabase";
import { normalizeSuggestion } from "@/lib/ai/suggest";

/**
 * Persist the finished plant (AI-path or manual) with the pre-minted id so the
 * row matches its `<uid>/<plantId>/` photo folder. The AI suggestion snapshot is
 * stored write-once in `plants.ai_suggestion` (NULL on a manual create) — the
 * adoption metric is `ai_suggestion IS NOT NULL`, so we keep the client's posted
 * snapshot rather than re-deriving it (the MVP fidelity caveat in the plan).
 *
 * `user_id` is NEVER set here — it defaults to `auth.uid()` server-side, and the
 * BEFORE-trigger rejects a `location_id` owned by another user. `/api/*` is
 * outside the middleware guard, so this endpoint self-guards.
 */

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

  const id = readString(body, "id");
  const locationId = readString(body, "locationId");
  const photoPath = readString(body, "photoPath");
  const name = readString(body, "name")?.trim() ?? null;

  if (!id || !UUID_RE.test(id)) {
    return json({ error: "invalid_plant_id" }, 400);
  }
  if (!locationId) {
    return json({ error: "missing_location" }, 400);
  }
  if (!name || name.length < 1 || name.length > 100) {
    return json({ error: "invalid_name" }, 400);
  }
  // Defense-in-depth: the photo key must live under the caller's own folder
  // (Storage RLS already enforces this on write, but never trust the client).
  if (!photoPath?.startsWith(`${user.id}/`)) {
    return json({ error: "invalid_photo_path" }, 400);
  }

  const wateringIntervalDays = asPositiveInt(readValue(body, "watering_interval_days"));
  if (wateringIntervalDays === INVALID) {
    return json({ error: "invalid_watering_interval" }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "supabase_unavailable" }, 503);
  }

  const rawSuggestion = readValue(body, "aiSuggestion");
  const aiSuggestion: Json | null = rawSuggestion == null ? null : snapshotToJson(normalizeSuggestion(rawSuggestion));

  // Explicit `id` (matches the photo folder); `user_id` omitted on purpose.
  const insert: PlantInsert = {
    id,
    location_id: locationId,
    name,
    species: emptyToNull(readString(body, "species")),
    description: emptyToNull(readString(body, "description")),
    sunlight: emptyToNull(readString(body, "sunlight")),
    watering_interval_days: wateringIntervalDays,
    winterization_cutoff: emptyToNull(readString(body, "winterization_cutoff")),
    photo_path: photoPath,
    ai_suggestion: aiSuggestion,
  };

  const { error } = await supabase.from("plants").insert(insert);
  if (error) {
    // A bad location (foreign/missing) or constraint breach is the client's
    // fault → 400, not a 500. Anything else is a genuine server error.
    if (error.code && CLIENT_ERROR_CODES.has(error.code)) {
      return json({ error: "invalid_request" }, 400);
    }
    // eslint-disable-next-line no-console
    console.error("[plants] insert failed:", error);
    return json({ error: "insert_failed" }, 500);
  }

  return json({ id }, 201);
};

/** Sentinel distinguishing "absent/empty → null" from "present but invalid → 400". */
const INVALID = Symbol("invalid");

function readValue(body: unknown, key: string): unknown {
  if (typeof body === "object" && body !== null && key in body) {
    return (body as Record<string, unknown>)[key];
  }
  return undefined;
}

function readString(body: unknown, key: string): string | null {
  const value = readValue(body, key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function emptyToNull(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** null/absent → null; a positive integer → that int; anything else → INVALID. */
function asPositiveInt(value: unknown): number | null | typeof INVALID {
  if (value == null || value === "") {
    return null;
  }
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 1) {
    return INVALID;
  }
  return n;
}

/**
 * Convert the normalized `AiSuggestion` into a plain JSON object literal so it
 * satisfies the jsonb column's `Json` type (an interface lacks the index
 * signature `Json` requires; a fresh literal of `string | number | null` values
 * is assignable directly).
 */
function snapshotToJson(s: ReturnType<typeof normalizeSuggestion>): Json {
  return {
    species: s.species,
    description: s.description,
    sunlight: s.sunlight,
    watering_interval_days: s.watering_interval_days,
    winterization_cutoff: s.winterization_cutoff,
  };
}
