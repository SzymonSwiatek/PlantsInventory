import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteTestUser, type TestUser } from "./helpers/sessions";
import { createTestUser } from "./helpers/sessions";

// Phase 3: Risk #4 — storage path-scoping (IDOR).
//
// Two real sessioned clients (A and B) drive the `plant-photos` bucket directly.
// Every cross-user assertion targets the DENIED / empty shape — never "no error
// on the happy path". Storage RLS binds to the session JWT, so the sessionedClient
// (Authorization: Bearer) is the real production path.
//
// Object-key convention: `<user_id>/<plant_id>/<filename>`.
// Only the first folder segment matters to the policies — the plant_id here is a
// static placeholder; the Storage layer does not FK-validate it.

const BUCKET = "plant-photos";
const PLANT_ID = "00000000-0000-0000-0000-000000000001";

// Tiny valid PNG (1×1 white pixel) so the upload hits a real MIME check.
const TINY_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49,
  0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe("storage path-scoping (IDOR)", () => {
  let userA: TestUser;
  let userB: TestUser;
  let aObjectPath: string;

  beforeAll(async () => {
    [userA, userB] = await Promise.all([createTestUser(), createTestUser()]);
    aObjectPath = `${userA.id}/${PLANT_ID}/photo.png`;

    // A uploads to their own prefix — must succeed (proves the owner path works
    // before we assert that B is denied against the same prefix).
    const { error } = await userA.client.storage.from(BUCKET).upload(aObjectPath, TINY_PNG, {
      contentType: "image/png",
      upsert: false,
    });
    if (error !== null) {
      throw new Error(`beforeAll: A's own upload failed unexpectedly: ${error.message}`);
    }
  });

  afterAll(async () => {
    // deleteTestUser calls removeUserStorage first (handles non-cascaded objects).
    await Promise.all([deleteTestUser(userA), deleteTestUser(userB)]);
  });

  // ── Owner-path happy path ────────────────────────────────────────────────────
  // A can sign their own object. If this fails, the subsequent denial tests have
  // no evidentiary value (we'd be asserting denial of a non-existent object).
  it("A createSignedUrl for own object → success", async () => {
    const { data, error } = await userA.client.storage.from(BUCKET).createSignedUrl(aObjectPath, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();
  });

  // ── B upload to A's prefix → denied (RLS WITH CHECK) ────────────────────────
  // The INSERT policy checks `(storage.foldername(name))[1] = auth.uid()`.
  // B's uid ≠ A's uid → WITH CHECK fails → PostgREST/Storage returns an error.
  it("B upload to A's prefix → denied", async () => {
    const bPath = `${userA.id}/${PLANT_ID}/b-injected.png`;
    const { error } = await userB.client.storage.from(BUCKET).upload(bPath, TINY_PNG, {
      contentType: "image/png",
      upsert: false,
    });
    expect(error).not.toBeNull();
  });

  // ── B createSignedUploadUrl for A's prefix → denied ─────────────────────────
  // Signed upload URLs are issued by Storage only when the caller has INSERT
  // permission on the target path. B does not → error returned.
  it("B createSignedUploadUrl under A's prefix → denied", async () => {
    const bPath = `${userA.id}/${PLANT_ID}/b-signed.png`;
    const { error } = await userB.client.storage.from(BUCKET).createSignedUploadUrl(bPath);
    expect(error).not.toBeNull();
  });

  // ── B list A's prefix → empty (RLS USING filters by uid) ────────────────────
  // The SELECT policy filters rows where the first folder segment = auth.uid().
  // B's uid ≠ A's uid → A's objects are invisible to B → empty listing, no error.
  // Asserting an empty array (not "no error") confirms RLS denial, not a silent
  // misconfiguration.
  it("B list A's prefix → empty array (USING filters, not errors)", async () => {
    const { data, error } = await userB.client.storage.from(BUCKET).list(userA.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  // ── B createSignedUrl for A's object → denied ───────────────────────────────
  // Signing an object requires SELECT. The USING policy hides A's object from B,
  // so Storage returns an error rather than a signed URL.
  it("B createSignedUrl for A's object → denied", async () => {
    const { error } = await userB.client.storage.from(BUCKET).createSignedUrl(aObjectPath, 60);
    expect(error).not.toBeNull();
  });
});
