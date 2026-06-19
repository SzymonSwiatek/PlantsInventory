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

/**
 * Best-effort batch delete of Storage objects by path. Swallows errors — a
 * Storage failure after a successful location delete is a nuisance, not a
 * user-facing error. No-op on empty input.
 */
export async function removePhotos(supabase: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(paths);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[storage] removePhotos failed:", error);
  }
}

/**
 * Batch variant of {@link signedPhotoUrl}: mint signed **read** URLs for many
 * `plant-photos` objects in a single round-trip via the plural
 * `createSignedUrls`, instead of one `createSignedUrl` call per object. Returns
 * a Map keyed by input path → URL, or null where minting failed for that item.
 * Paths absent from the map fall back to a placeholder, same as the singular.
 */
export async function signedPhotoUrls(
  supabase: SupabaseClient,
  paths: string[],
  ttlSeconds = 3600,
): Promise<Map<string, string | null>> {
  const urls = new Map<string, string | null>();
  if (paths.length === 0) {
    return urls;
  }
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, ttlSeconds);
  if (error) {
    return urls;
  }
  for (const item of data) {
    if (item.path) {
      urls.set(item.path, item.error ? null : item.signedUrl);
    }
  }
  return urls;
}
