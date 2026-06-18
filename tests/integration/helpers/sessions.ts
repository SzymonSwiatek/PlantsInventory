import { anonClient, serviceRoleClient, sessionedClient, type IntegrationClient, type TestSession } from "./clients";

const PHOTO_BUCKET = "plant-photos";

export interface TestUser {
  id: string;
  email: string;
  password: string;
  session: TestSession;
  /** RLS-respecting client scoped to this user — the assertion client. */
  client: IntegrationClient;
}

/**
 * Mint a fresh, unique user against local GoTrue and return an RLS-respecting
 * sessioned client for it. Creation goes through the service-role admin API
 * (autoconfirm is on locally, so `email_confirm: true` yields an immediately
 * usable account); the session itself is obtained through the anon client's
 * `signInWithPassword`, i.e. the real production sign-in path. Emails carry a
 * timestamp + random suffix so parallel files and re-runs never collide (and the
 * small user count stays under the local `sign_in_sign_ups = 30`/5 min limit).
 */
export async function createTestUser(): Promise<TestUser> {
  const admin = serviceRoleClient();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `test-${unique}@example.com`;
  const password = `pw-${unique}-secret`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError !== null) {
    throw new Error(`createTestUser: admin.createUser failed: ${createError.message}`);
  }

  const { data: signedIn, error: signInError } = await anonClient().auth.signInWithPassword({ email, password });
  if (signInError !== null) {
    throw new Error(`createTestUser: signInWithPassword failed: ${signInError.message}`);
  }

  const session: TestSession = {
    access_token: signedIn.session.access_token,
    refresh_token: signedIn.session.refresh_token,
  };

  return { id: created.user.id, email, password, session, client: sessionedClient(session) };
}

/**
 * Tear a test user down completely. Storage objects under `<uid>/...` are NOT
 * FK-cascaded by `admin.deleteUser`, so they are listed and removed first; the
 * user delete then cascades all domain rows (`on delete cascade`).
 */
export async function deleteTestUser(user: TestUser): Promise<void> {
  await deleteTestUserById(user.id);
}

/**
 * Tear a user down by id alone — for callers (e.g. the Playwright
 * `globalTeardown`, a separate process) that only persisted the user id, not the
 * full `TestUser`. Storage objects under `<uid>/...` are removed first, then the
 * user delete cascades all domain rows.
 */
export async function deleteTestUserById(userId: string): Promise<void> {
  const admin = serviceRoleClient();
  await removeUserStorage(admin, userId);
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error !== null) {
    throw new Error(`deleteTestUser: admin.deleteUser failed: ${error.message}`);
  }
}

/**
 * Remove every object under the user's `<uid>/` prefix. Keys are
 * `<uid>/<plantId>/<file>`, so a two-level walk (plant folders, then their
 * files) covers the bucket. Runs as service-role, which bypasses Storage RLS for
 * cleanup regardless of owner.
 */
async function removeUserStorage(admin: IntegrationClient, userId: string): Promise<void> {
  const paths: string[] = [];
  const { data: plantFolders } = await admin.storage.from(PHOTO_BUCKET).list(userId);
  for (const folder of plantFolders ?? []) {
    const prefix = `${userId}/${folder.name}`;
    const { data: files } = await admin.storage.from(PHOTO_BUCKET).list(prefix);
    for (const file of files ?? []) {
      paths.push(`${prefix}/${file.name}`);
    }
  }
  if (paths.length > 0) {
    await admin.storage.from(PHOTO_BUCKET).remove(paths);
  }
}
