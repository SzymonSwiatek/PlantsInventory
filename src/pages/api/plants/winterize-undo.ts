import type { APIRoute } from "astro";
import { json, requireUser, UUID_RE, CLIENT_ERROR_CODES } from "@/lib/api";
import { createClient } from "@/lib/supabase";

const MAX_BULK = 200;

export const POST: APIRoute = async (context) => {
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

  // Fetch winterize care_events for these plants ordered newest-first.
  // RLS scopes the query to the authenticated user's own plants.
  const { data: events, error: fetchError } = await supabase
    .from("care_events")
    .select("id, plant_id, done_at")
    .in("plant_id", plantIds)
    .eq("kind", "winterize")
    .order("done_at", { ascending: false })
    .order("created_at", { ascending: false });
  if (fetchError) {
    // eslint-disable-next-line no-console
    console.error("[winterize-undo] fetch care_events failed:", fetchError);
    return json({ error: "fetch_failed" }, 500);
  }

  // Group by plant_id: first occurrence = most recent (to delete), second = prior.
  const byPlant = new Map<string, { toDeleteId: string; priorDoneAt: string | null }>();
  for (const ev of events) {
    const existing = byPlant.get(ev.plant_id);
    if (!existing) {
      byPlant.set(ev.plant_id, { toDeleteId: ev.id, priorDoneAt: null });
    } else {
      existing.priorDoneAt ??= ev.done_at;
    }
  }

  const toDeleteIds = [...byPlant.values()].map((e) => e.toDeleteId);
  if (toDeleteIds.length > 0) {
    const { error: deleteError } = await supabase.from("care_events").delete().in("id", toDeleteIds);
    if (deleteError) {
      if (deleteError.code && CLIENT_ERROR_CODES.has(deleteError.code)) {
        return json({ error: "invalid_request" }, 400);
      }
      // eslint-disable-next-line no-console
      console.error("[winterize-undo] delete care_events failed:", deleteError);
      return json({ error: "delete_failed" }, 500);
    }
  }

  // Update each plant's winterized_at to the prior event's done_at (or null).
  // Each plant may have a different prior value, so we iterate individually.
  const reverted: string[] = [];
  for (const plantId of plantIds) {
    const entry = byPlant.get(plantId);
    const winterizedAt = entry?.priorDoneAt ?? null;
    const { error: updateError } = await supabase
      .from("plants")
      .update({ winterized_at: winterizedAt })
      .eq("id", plantId);
    if (updateError) {
      if (updateError.code && CLIENT_ERROR_CODES.has(updateError.code)) {
        return json({ error: "invalid_request" }, 400);
      }
      // eslint-disable-next-line no-console
      console.error("[winterize-undo] update plant failed:", updateError);
      return json({ error: "update_failed" }, 500);
    }
    reverted.push(plantId);
  }

  return json({ reverted });
};

function readStringArray(body: unknown, key: string): string[] | null {
  if (typeof body !== "object" || body === null || !(key in body)) return null;
  const value = (body as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return null;
  if (!value.every((v) => typeof v === "string")) return null;
  return value;
}
