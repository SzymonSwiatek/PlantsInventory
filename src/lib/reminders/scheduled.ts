import { composeDigest, sendDigest } from "./email";
import type { DuePlant, DueWinterPlant } from "./email";
import { createServiceClient } from "./service-client";
import type { ReminderEnv } from "./service-client";

interface UserBucket {
  water: DuePlant[];
  winter: DueWinterPlant[];
}

export async function runScheduledTick(now: Date, env: ReminderEnv): Promise<void> {
  console.log({ event: "scheduled.tick", ts: now.toISOString() });

  const supabase = createServiceClient(env);
  if (!supabase) {
    console.log({ event: "scheduled.skip", reason: "service_client_unavailable" });
    return;
  }

  const siteUrl = env.PUBLIC_SITE_URL ?? "";

  const { data: waterRows, error: waterError } = await supabase
    .from("plants")
    .select("name, user_id, next_water_due_at, locations(name)")
    .not("watering_interval_days", "is", null)
    .not("next_water_due_at", "is", null)
    .lte("next_water_due_at", now.toISOString())
    .or(`water_snooze_until.is.null,water_snooze_until.lte.${now.toISOString()}`);

  if (waterError) {
    console.error({ event: "scheduled.query_error", query: "water", err: waterError.message });
    return;
  }

  const { data: winterRows, error: winterError } = await supabase
    .from("winterization_due_plants")
    .select("name, user_id, location_name, winterization_cutoff");

  if (winterError) {
    console.error({ event: "scheduled.query_error", query: "winter", err: winterError.message });
    return;
  }

  // Build combined per-user map
  const byUser = new Map<string, UserBucket>();

  const getBucket = (userId: string): UserBucket => {
    let bucket = byUser.get(userId);
    if (!bucket) {
      bucket = { water: [], winter: [] };
      byUser.set(userId, bucket);
    }
    return bucket;
  };

  for (const row of waterRows) {
    const loc = row.locations as { name: string } | null;
    const locationName = loc?.name ?? "Unknown";
    const daysOverdue = row.next_water_due_at
      ? Math.max(0, Math.floor((now.getTime() - new Date(row.next_water_due_at).getTime()) / 86_400_000))
      : 0;
    getBucket(row.user_id).water.push({ name: row.name, locationName, daysOverdue });
  }

  for (const row of winterRows) {
    if (!row.user_id) continue;
    const cutoff = row.winterization_cutoff ?? "";
    getBucket(row.user_id).winter.push({
      name: row.name ?? "",
      locationName: row.location_name ?? "Unknown",
      cutoff,
    });
  }

  let emailsSent = 0;
  for (const [userId, bucket] of byUser) {
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    if (userError || !userData.user.email) {
      console.error({ event: "scheduled.user_lookup_error", userId, err: userError?.message ?? "no_email" });
      continue;
    }

    const digest = composeDigest({ water: bucket.water, winter: bucket.winter }, siteUrl);
    try {
      await sendDigest(userData.user.email, digest, env);
      emailsSent++;
    } catch (err: unknown) {
      console.error({ event: "scheduled.email_error", userId, err: String(err) });
    }
  }

  console.log({
    event: "scheduled.summary",
    water_due: waterRows.length,
    winter_due: winterRows.length,
    total: waterRows.length + winterRows.length,
    emails_sent: emailsSent,
  });
}
