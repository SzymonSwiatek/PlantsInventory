import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

export interface ReminderEnv {
  SUPABASE_URL: string | undefined;
  SUPABASE_SERVICE_ROLE_KEY: string | undefined;
  RESEND_API_KEY: string | undefined;
  REMINDER_FROM_EMAIL: string | undefined;
  PUBLIC_SITE_URL: string | undefined;
  REMINDER_UNSUBSCRIBE_SECRET: string | undefined;
}

export function createServiceClient(env: ReminderEnv) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}
