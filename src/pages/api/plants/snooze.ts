import type { APIRoute } from "astro";
import { json, requireUser, UUID_RE, CLIENT_ERROR_CODES } from "@/lib/api";
import { createClient } from "@/lib/supabase";

const MIN_DAYS = 1;
const MAX_DAYS = 30;

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

  const plantId = readString(body, "plantId");
  if (!plantId || !UUID_RE.test(plantId)) {
    return json({ error: "invalid_plant_id" }, 400);
  }

  const days = readPositiveInt(body, "days");
  if (days === null || days < MIN_DAYS || days > MAX_DAYS) {
    return json({ error: "invalid_days" }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "supabase_unavailable" }, 503);
  }

  const snoozedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase.from("plants").update({ water_snooze_until: snoozedUntil }).eq("id", plantId);
  if (error) {
    if (error.code && CLIENT_ERROR_CODES.has(error.code)) {
      return json({ error: "invalid_request" }, 400);
    }
    // eslint-disable-next-line no-console
    console.error("[snooze] update failed:", error);
    return json({ error: "update_failed" }, 500);
  }

  return json({ snoozed_until: snoozedUntil });
};

function readString(body: unknown, key: string): string | null {
  if (typeof body !== "object" || body === null || !(key in body)) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Returns null when absent/non-integer; the caller validates range. */
function readPositiveInt(body: unknown, key: string): number | null {
  if (typeof body !== "object" || body === null || !(key in body)) return null;
  const value = (body as Record<string, unknown>)[key];
  if (typeof value !== "number") return null;
  if (!Number.isInteger(value)) return null;
  return value;
}
