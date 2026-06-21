import { composeDigest, sendDigest } from "./email";
import type { DuePlant } from "./email";
import { createServiceClient } from "./service-client";
import type { ReminderEnv } from "./service-client";

export async function runScheduledTick(now: Date, env: ReminderEnv): Promise<void> {
  console.log({ event: "scheduled.tick", ts: now.toISOString() });

  const supabase = createServiceClient(env);
  if (!supabase) {
    console.log({ event: "scheduled.skip", reason: "service_client_unavailable" });
    return;
  }

  const siteUrl = env.PUBLIC_SITE_URL ?? "";

  const { data: rows, error } = await supabase
    .from("plants")
    .select("name, user_id, next_water_due_at, locations(name)")
    .not("watering_interval_days", "is", null)
    .not("next_water_due_at", "is", null)
    .lte("next_water_due_at", now.toISOString())
    .or(`water_snooze_until.is.null,water_snooze_until.lte.${now.toISOString()}`);

  if (error) {
    console.error({ event: "scheduled.query_error", err: error.message });
    return;
  }

  // Group by user_id
  const byUser = new Map<string, DuePlant[]>();
  for (const row of rows) {
    const loc = row.locations as { name: string } | null;
    const locationName = loc?.name ?? "Unknown";
    const daysOverdue = row.next_water_due_at
      ? Math.max(0, Math.floor((now.getTime() - new Date(row.next_water_due_at).getTime()) / 86_400_000))
      : 0;
    const plant: DuePlant = { name: row.name, locationName, daysOverdue };
    const bucket = byUser.get(row.user_id);
    if (bucket) {
      bucket.push(plant);
    } else {
      byUser.set(row.user_id, [plant]);
    }
  }

  let emailsSent = 0;
  for (const [userId, plants] of byUser) {
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    if (userError || !userData.user.email) {
      console.error({ event: "scheduled.user_lookup_error", userId, err: userError?.message ?? "no_email" });
      continue;
    }

    const digest = composeDigest(plants, siteUrl);
    try {
      await sendDigest(userData.user.email, digest, env);
      emailsSent++;
    } catch (err: unknown) {
      console.error({ event: "scheduled.email_error", userId, err: String(err) });
    }
  }

  console.log({ event: "scheduled.summary", total: rows.length, emails_sent: emailsSent });
}
