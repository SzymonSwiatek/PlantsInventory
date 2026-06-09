import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

/**
 * Create a location for the signed-in user from a native form POST, then
 * redirect back to the dashboard. Intentionally form-POST→redirect (mirrors the
 * auth endpoints) rather than JSON — the JSON convention is owned by the plant
 * endpoints. `/api/*` is outside the middleware guard, so self-guard here.
 */
export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const name = ((form.get("name") as string | null) ?? "").trim();

  if (name.length < 1 || name.length > 100) {
    return context.redirect(`/dashboard?error=${encodeURIComponent("Name must be 1–100 characters.")}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/dashboard?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  // user_id defaults to auth.uid() server-side; never set it from the client.
  const { error } = await supabase.from("locations").insert({ name });
  if (error) {
    return context.redirect(`/dashboard?error=${encodeURIComponent("Could not create the location. Try again.")}`);
  }

  return context.redirect("/dashboard");
};
