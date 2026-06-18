import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildAuthCookieHeader } from "./helpers/cookies";
import { startServer, type ServerHandle } from "./helpers/server";
import { createTestUser, deleteTestUser, type TestUser } from "./helpers/sessions";

// Phase 3: Risk #1 — AI-outage resilience (server-side degrade chain).
//
// Boots the real SSR app WITHOUT an AI key (`startServer()` writes `.dev.vars`
// with only `SUPABASE_*`, omitting `AI_API_KEY`), so every `/api/plants/suggest`
// call hits the missing-key degrade branch — the zero-stub outage lever. The
// suite then proves the guarantee a user actually cares about: an
// `ai_unavailable` suggest response does NOT stop an independently-minted
// `photoPath` from persisting a plant.
//
// This is the END-TO-END photo-preservation chain, not just the degraded shape:
// the same `path` minted by `/api/plants/upload-url` (step 2) is asserted to be
// the `photo_path` that lands on the row (step 3). That linkage is the proof the
// photo survives the outage. The client-rendered "create manually" banner is
// React and unreachable from here — it is covered by the Phase 2 e2e.
//
// All fetches carry the user's auth cookie (emitted by `@supabase/ssr` via
// `buildAuthCookieHeader`, never hand-rolled) and use `redirect: "manual"` so a
// silent 302 cannot mask a denial.

// Tiny valid PNG (1×1 white pixel) — the fixture bytes PUT to the signed URL.
const TINY_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49,
  0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

// A minimal base64 image for the suggest call. The missing-key branch
// short-circuits before reading the body, so the exact bytes are irrelevant —
// but we send a well-formed request to mirror the real client.
const IMAGE_BASE64 = Buffer.from(TINY_PNG).toString("base64");

describe("ai-outage resilience (server-side degrade chain)", () => {
  let server: ServerHandle;
  let base: string;
  let user: TestUser;
  let cookie: string;
  let locationId: string;

  beforeAll(async () => {
    server = await startServer();
    base = server.baseUrl;
    user = await createTestUser();
    cookie = await buildAuthCookieHeader(user.session);

    // Seed a location for the user via their RLS-scoped client — needed for the
    // plant's `locationId`. user_id defaults to auth.uid(), so it is not set.
    const { data: location, error } = await user.client
      .from("locations")
      .insert({ name: "Outage test location" })
      .select("id")
      .single();
    if (error !== null) {
      throw new Error(`beforeAll: seed location failed: ${error.message}`);
    }
    locationId = location.id;
  }, 120_000); // generous timeout — workerd cold start

  afterAll(async () => {
    await deleteTestUser(user);
    await server.stop();
  });

  it("suggest degrades to ai_unavailable, yet the minted photoPath still persists a plant (201)", async () => {
    // ── Step 1: suggest degrades (server has no AI key) ──────────────────────
    const suggestRes = await fetch(`${base}/api/plants/suggest`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ imageBase64: IMAGE_BASE64, mimeType: "image/png" }),
    });
    expect(suggestRes.status).toBe(200);
    expect(await suggestRes.json()).toEqual({ status: "ai_unavailable" });

    // ── Step 2: mint a signed upload URL and PUT the fixture bytes ───────────
    // (mirrors AddPlantForm.runUpload — the photo path is minted independently
    // of the AI call).
    const uploadUrlRes = await fetch(`${base}/api/plants/upload-url`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ locationId, filename: "plant.png", contentType: "image/png" }),
    });
    expect(uploadUrlRes.status).toBe(200);
    const mint = (await uploadUrlRes.json()) as { plantId: string; path: string; signedUrl: string };
    expect(mint.plantId).toBeTruthy();
    expect(mint.path).toMatch(new RegExp(`^${user.id}/`));
    expect(mint.signedUrl).toBeTruthy();

    const putRes = await fetch(mint.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: TINY_PNG,
    });
    expect(putRes.ok).toBe(true);

    // ── Step 3: persist the plant with that photoPath despite AI being down ──
    const createRes = await fetch(`${base}/api/plants`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        id: mint.plantId,
        locationId,
        photoPath: mint.path,
        aiSuggestion: null, // manual create — AI did not answer
        name: `Outage plant ${Date.now().toString()}`,
        species: "Manually entered species",
      }),
    });
    expect(createRes.status).toBe(201);
    expect(await createRes.json()).toEqual({ id: mint.plantId });

    // ── Linkage assertion: the SAME path minted in step 2 is what persisted ──
    // This is the photo-preservation proof — not just the degraded shape.
    const { data: row, error } = await user.client
      .from("plants")
      .select("id, photo_path")
      .eq("id", mint.plantId)
      .single();
    expect(error).toBeNull();
    expect(row?.photo_path).toBe(mint.path);
  });
});
