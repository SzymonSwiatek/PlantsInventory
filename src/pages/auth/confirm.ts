import type { APIRoute } from "astro";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";

const INVALID_LINK = "This sign-in link is invalid. Enter your email to get a new one.";
const EXPIRED_LINK = "This sign-in link is expired or already used. Enter your email to get a new one.";

/**
 * Reject anything that isn't a same-origin absolute path. Without this the
 * magic-link endpoint becomes an open redirector.
 */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes(":")) {
    return "/dashboard";
  }
  return next;
}

export const GET: APIRoute = async (context) => {
  const url = new URL(context.request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type: EmailOtpType = url.searchParams.get("type") ?? "email";
  const next = safeNext(url.searchParams.get("next"));

  if (!tokenHash) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(INVALID_LINK)}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(EXPIRED_LINK)}`);
  }

  return context.redirect(next);
};
