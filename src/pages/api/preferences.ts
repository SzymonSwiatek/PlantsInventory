import type { APIRoute } from "astro";
import { json, requireUser, requireSameOrigin } from "@/lib/api";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const originErr = requireSameOrigin(context.request);
  if (originErr) return originErr;

  const user = requireUser(context);
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("remindersEnabled" in body) ||
    typeof (body as Record<string, unknown>).remindersEnabled !== "boolean"
  ) {
    return json({ error: "invalid_body" }, 400);
  }

  const remindersEnabled = (body as { remindersEnabled: boolean }).remindersEnabled;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return json({ error: "supabase_unavailable" }, 503);

  const { error } = await supabase
    .from("user_preferences")
    .upsert({ user_id: user.id, reminders_enabled: remindersEnabled }, { onConflict: "user_id" });

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[preferences] upsert failed:", error);
    return json({ error: "upsert_failed" }, 500);
  }

  return json({ remindersEnabled });
};
