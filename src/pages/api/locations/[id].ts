import type { APIRoute } from "astro";
import { json, requireUser, requireSameOrigin, UUID_RE, CLIENT_ERROR_CODES } from "@/lib/api";
import { createClient } from "@/lib/supabase";
import { removePhotos } from "@/lib/storage";

export const PATCH: APIRoute = async (context) => {
  const originErr = requireSameOrigin(context.request);
  if (originErr) return originErr;

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

  const rawName =
    typeof body === "object" && body !== null && "name" in body ? (body as Record<string, unknown>).name : undefined;
  const name = typeof rawName === "string" ? rawName.trim() : null;
  if (!name || name.length < 1 || name.length > 100) {
    return json({ error: "invalid_name" }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "supabase_unavailable" }, 503);
  }

  const { error } = await supabase.from("locations").update({ name }).eq("id", id);
  if (error) {
    if (error.code && CLIENT_ERROR_CODES.has(error.code)) {
      return json({ error: "invalid_request" }, 400);
    }
    // eslint-disable-next-line no-console
    console.error("[locations] PATCH failed:", error);
    return json({ error: "update_failed" }, 500);
  }

  return json({ id }, 200);
};

export const DELETE: APIRoute = async (context) => {
  const originErr = requireSameOrigin(context.request);
  if (originErr) return originErr;

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

  // Collect photo paths before deleting (cascade removes the rows, making paths unrecoverable after).
  const { data: plants, error: plantsError } = await supabase.from("plants").select("photo_path").eq("location_id", id);
  if (plantsError) {
    // eslint-disable-next-line no-console
    console.error("[locations] DELETE photo-path collect failed:", plantsError);
  }
  const paths = (plants ?? []).map((p) => p.photo_path).filter((p): p is string => p !== null);

  const { error } = await supabase.from("locations").delete().eq("id", id);
  if (error) {
    if (error.code && CLIENT_ERROR_CODES.has(error.code)) {
      return json({ error: "invalid_request" }, 400);
    }
    // eslint-disable-next-line no-console
    console.error("[locations] DELETE failed:", error);
    return json({ error: "delete_failed" }, 500);
  }

  await removePhotos(supabase, paths);

  return json({ id }, 200);
};
