import type { APIRoute } from "astro";
import { requireSameOrigin } from "@/lib/api";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const originErr = requireSameOrigin(context.request);
  if (originErr) return originErr;

  const supabase = createClient(context.request.headers, context.cookies);
  if (supabase) {
    await supabase.auth.signOut();
  }
  return context.redirect("/");
};
