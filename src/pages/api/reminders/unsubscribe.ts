import type { APIRoute } from "astro";
import { REMINDER_UNSUBSCRIBE_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { verifyUnsubscribeToken } from "@/lib/reminders/unsubscribe-token";

function buildServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function parseParams(request: Request): { userId: string; token: string } | null {
  const url = new URL(request.url);
  const userId = url.searchParams.get("u");
  const token = url.searchParams.get("t");
  if (!userId || !token) return null;
  return { userId, token };
}

async function flipOptOut(userId: string): Promise<Response | null> {
  const supabase = buildServiceClient();
  if (!supabase) return new Response(null, { status: 503 });

  const { error } = await supabase
    .from("user_preferences")
    .upsert({ user_id: userId, reminders_enabled: false }, { onConflict: "user_id" });

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[unsubscribe] upsert failed:", error);
    return new Response(null, { status: 500 });
  }
  return null;
}

export const GET: APIRoute = async ({ request }) => {
  if (!REMINDER_UNSUBSCRIBE_SECRET) return new Response(null, { status: 404 });

  const params = parseParams(request);
  if (!params) return new Response(null, { status: 400 });

  const valid = await verifyUnsubscribeToken(params.userId, params.token, REMINDER_UNSUBSCRIBE_SECRET);
  if (!valid) return new Response(null, { status: 400 });

  const err = await flipOptOut(params.userId);
  if (err) return err;

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:24px">
  <h1>Unsubscribed</h1>
  <p>You've been unsubscribed from plant reminders.</p>
  <p><a href="/settings">Manage your notification settings</a></p>
</body>
</html>`;

  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
};

// RFC 8058 one-click: mail providers POST with no session and no Origin header.
// Auth is via the signed token only — no CSRF check needed here.
export const POST: APIRoute = async ({ request }) => {
  if (!REMINDER_UNSUBSCRIBE_SECRET) return new Response(null, { status: 404 });

  const params = parseParams(request);
  if (!params) return new Response(null, { status: 400 });

  const valid = await verifyUnsubscribeToken(params.userId, params.token, REMINDER_UNSUBSCRIBE_SECRET);
  if (!valid) return new Response(null, { status: 400 });

  const err = await flipOptOut(params.userId);
  if (err) return err;

  return new Response(null, { status: 200 });
};
