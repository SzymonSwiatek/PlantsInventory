import type { APIRoute } from "astro";
import { requireSameOrigin } from "@/lib/api";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const originErr = requireSameOrigin(context.request);
  if (originErr) return originErr;

  const form = await context.request.formData();
  const email = ((form.get("email") as string | null) ?? "").trim().toLowerCase();

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const emailRedirectTo = `${new URL(context.request.url).origin}/auth/confirm`;
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } });

  if (error) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect(`/auth/check-email?email=${encodeURIComponent(email)}`);
};
