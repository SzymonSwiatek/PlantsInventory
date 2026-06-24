import type { APIRoute } from "astro";
import { json, requireUser, requireSameOrigin, UUID_RE, CLIENT_ERROR_CODES } from "@/lib/api";
import { createClient } from "@/lib/supabase";

const MAX_BULK = 200;

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

  const plantIds = readStringArray(body, "plantIds");
  if (!plantIds || plantIds.length === 0) {
    return json({ error: "missing_plant_ids" }, 400);
  }
  if (plantIds.length > MAX_BULK) {
    return json({ error: "too_many_plant_ids" }, 400);
  }
  if (!plantIds.every((id) => UUID_RE.test(id))) {
    return json({ error: "invalid_plant_id" }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "supabase_unavailable" }, 503);
  }

  const now = new Date().toISOString();

  const { error: insertError } = await supabase
    .from("care_events")
    .insert(plantIds.map((plantId) => ({ plant_id: plantId, kind: "water" as const, done_at: now })));
  if (insertError) {
    if (insertError.code && CLIENT_ERROR_CODES.has(insertError.code)) {
      return json({ error: "invalid_request" }, 400);
    }
    // eslint-disable-next-line no-console
    console.error("[water] insert care_events failed:", insertError);
    return json({ error: "insert_failed" }, 500);
  }

  const { error: updateError } = await supabase
    .from("plants")
    .update({ last_watered_at: now, water_snooze_until: null })
    .in("id", plantIds);
  if (updateError) {
    if (updateError.code && CLIENT_ERROR_CODES.has(updateError.code)) {
      return json({ error: "invalid_request" }, 400);
    }
    // eslint-disable-next-line no-console
    console.error("[water] update plants failed:", updateError);
    return json({ error: "update_failed" }, 500);
  }

  return json({ watered: plantIds });
};

function readStringArray(body: unknown, key: string): string[] | null {
  if (typeof body !== "object" || body === null || !(key in body)) return null;
  const value = (body as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return null;
  if (!value.every((v) => typeof v === "string")) return null;
  return value;
}
