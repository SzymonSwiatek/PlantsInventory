import type { createClient } from "@/lib/supabase";

/** A configured (non-null) Supabase client, kept in lockstep with `createClient`. */
type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

const PHOTO_BUCKET = "plant-photos";

/**
 * Mint a short-lived signed **read** URL for a private `plant-photos` object,
 * used by the plant-list render. Returns the URL or null (unreadable / missing
 * path), so callers can fall back to a placeholder rather than throwing.
 */
export async function signedPhotoUrl(
  supabase: SupabaseClient,
  path: string,
  ttlSeconds = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, ttlSeconds);
  if (error) {
    return null;
  }
  return data.signedUrl;
}
