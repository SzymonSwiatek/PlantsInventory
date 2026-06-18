import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { anonClient, serviceRoleClient, type IntegrationClient } from "./helpers/clients";
import { createTestUser, deleteTestUser, type TestUser } from "./helpers/sessions";

// Phase 2: Risk #2 — cross-user data isolation (RLS + trigger child-scoping).
//
// Two real sessioned clients (A and B) hit a locally running Supabase. Every
// assertion targets the DENIED / zero-rows shape — never "no error on the happy
// path". The matrix covers all three domain tables × all four CRUD operations,
// plus the two trigger-enforced child-scoping cases (SQLSTATE 23514), anon
// denial, and the delete-user FK cascade.

type DomainTable = "locations" | "plants" | "care_events";

const DOMAIN_TABLES: DomainTable[] = ["locations", "plants", "care_events"];

// Seeded row IDs for user A — populated in beforeAll, read lazily by each test.
const aId: Record<DomainTable, string> = { locations: "", plants: "", care_events: "" };

// Per-table SELECT helper — one typed branch per table so the Database-typed
// client validates the query without falling back to `any`.
async function selectIds(client: IntegrationClient, table: DomainTable) {
  switch (table) {
    case "locations":
      return client.from("locations").select("id");
    case "plants":
      return client.from("plants").select("id");
    case "care_events":
      return client.from("care_events").select("id");
  }
}

// Per-table UPDATE helper — targets A's row by id, no-ops when RLS hides it.
async function updateById(client: IntegrationClient, table: DomainTable, id: string) {
  switch (table) {
    case "locations":
      return client.from("locations").update({ name: "b-hacked" }).eq("id", id).select("id");
    case "plants":
      return client.from("plants").update({ name: "b-hacked" }).eq("id", id).select("id");
    case "care_events":
      return client.from("care_events").update({ kind: "winterize" }).eq("id", id).select("id");
  }
}

// Per-table DELETE helper — targets A's row by id, no-ops when RLS hides it.
async function deleteById(client: IntegrationClient, table: DomainTable, id: string) {
  switch (table) {
    case "locations":
      return client.from("locations").delete().eq("id", id).select("id");
    case "plants":
      return client.from("plants").delete().eq("id", id).select("id");
    case "care_events":
      return client.from("care_events").delete().eq("id", id).select("id");
  }
}

describe("cross-user isolation (RLS)", () => {
  let userA: TestUser;
  let userB: TestUser;

  beforeAll(async () => {
    [userA, userB] = await Promise.all([createTestUser(), createTestUser()]);

    // A seeds one row in each domain table via A's sessioned (RLS-scoped) client.
    // user_id defaults to auth.uid(), so no explicit value is needed.
    const { data: loc, error: locErr } = await userA.client
      .from("locations")
      .insert({ name: "A's location" })
      .select("id")
      .single();
    if (locErr !== null) throw new Error(`seed location: ${locErr.message}`);
    aId.locations = loc.id;

    const { data: plant, error: plantErr } = await userA.client
      .from("plants")
      .insert({ location_id: aId.locations, name: "A's plant" })
      .select("id")
      .single();
    if (plantErr !== null) throw new Error(`seed plant: ${plantErr.message}`);
    aId.plants = plant.id;

    const { data: event, error: eventErr } = await userA.client
      .from("care_events")
      .insert({ plant_id: aId.plants, kind: "water" })
      .select("id")
      .single();
    if (eventErr !== null) throw new Error(`seed care_event: ${eventErr.message}`);
    aId.care_events = event.id;
  });

  afterAll(async () => {
    await Promise.all([deleteTestUser(userA), deleteTestUser(userB)]);
  });

  // ── SELECT matrix ─────────────────────────────────────────────────────────
  // RLS policies for SELECT filter rows by user_id = auth.uid(), so B's query
  // returns an empty result set — not an error. This distinguishes RLS filtering
  // from a connection or permission error.
  it.each(DOMAIN_TABLES.map((table) => ({ table })))(
    "B SELECT $table → zero rows (RLS filters silently, no error)",
    async ({ table }) => {
      const { data, error } = await selectIds(userB.client, table);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    },
  );

  // ── UPDATE matrix ─────────────────────────────────────────────────────────
  // The `.eq("id", A's id)` filter targets A's row. RLS makes it invisible to B,
  // so the effective WHERE clause matches nothing → zero rows affected, no error.
  // Asserting `data.length === 0` (not "no error") confirms RLS denial, not a
  // silent no-op unrelated to isolation.
  it.each(DOMAIN_TABLES.map((table) => ({ table })))(
    "B UPDATE $table (A's row by id) → zero rows affected",
    async ({ table }) => {
      const { data, error } = await updateById(userB.client, table, aId[table]);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    },
  );

  // ── DELETE matrix ─────────────────────────────────────────────────────────
  // Same invisibility mechanism: A's row is filtered out before DELETE executes.
  it.each(DOMAIN_TABLES.map((table) => ({ table })))(
    "B DELETE $table (A's row by id) → zero rows affected",
    async ({ table }) => {
      const { data, error } = await deleteById(userB.client, table, aId[table]);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    },
  );

  // ── INSERT: RLS with_check denial ─────────────────────────────────────────
  // B explicitly supplies user_id = A.id. The locations INSERT policy
  // `with check ((select auth.uid()) = user_id)` evaluates to B.id = A.id → false
  // → PostgREST returns a 403 / insufficient_privilege error.
  it("B INSERT location with user_id = A's id → RLS with_check denial", async () => {
    const { error } = await userB.client.from("locations").insert({ name: "hijack", user_id: userA.id });
    expect(error).not.toBeNull();
  });

  // ── Child-scoping: trigger SQLSTATE 23514 ─────────────────────────────────
  // `assert_plant_location_same_user` is SECURITY INVOKER: it looks up the
  // parent location under B's RLS context — A's location is invisible → the
  // subquery returns NULL → NULL IS DISTINCT FROM new.user_id (B.id) → trigger
  // raises check_violation (23514). RLS alone would not close this gap because
  // the INSERT with_check passes when user_id defaults to auth.uid().
  it("B INSERT plant with A's location_id → check_violation (23514)", async () => {
    const { error } = await userB.client.from("plants").insert({ location_id: aId.locations, name: "hijack" });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
  });

  it("B INSERT care_event with A's plant_id → check_violation (23514)", async () => {
    const { error } = await userB.client.from("care_events").insert({ plant_id: aId.plants, kind: "water" });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
  });

  // ── Anon denial ───────────────────────────────────────────────────────────
  // All RLS policies are `to authenticated`. An anon client (no JWT) has the
  // `anon` role — no policies match → default-deny → zero rows, no error.
  it.each(DOMAIN_TABLES.map((table) => ({ table })))(
    "anon SELECT $table → zero rows (anon role, no policies match)",
    async ({ table }) => {
      const { data, error } = await selectIds(anonClient(), table);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    },
  );

  // ── Delete-user cascade ───────────────────────────────────────────────────
  // Uses a dedicated user C (not A/B) so the main seed data stays intact for
  // the other assertions. The test deletes C and verifies FK cascade removes all
  // three tables' rows via a service-role count (bypasses RLS, so a zero count
  // is unambiguous).
  describe("delete-user cascade", () => {
    let userC: TestUser;
    let cascadeRan = false;

    beforeAll(async () => {
      userC = await createTestUser();

      const { data: loc, error: locErr } = await userC.client
        .from("locations")
        .insert({ name: "C's location" })
        .select("id")
        .single();
      if (locErr !== null) throw new Error(`seed C location: ${locErr.message}`);

      const { data: plant, error: plantErr } = await userC.client
        .from("plants")
        .insert({ location_id: loc.id, name: "C's plant" })
        .select("id")
        .single();
      if (plantErr !== null) throw new Error(`seed C plant: ${plantErr.message}`);

      const { error: eventErr } = await userC.client.from("care_events").insert({ plant_id: plant.id, kind: "water" });
      if (eventErr !== null) throw new Error(`seed C care_event: ${eventErr.message}`);
    });

    afterAll(async () => {
      // Defensive: skip if the cascade test already deleted C; otherwise clean
      // up so no orphan user remains after a failed run.
      if (!cascadeRan) {
        await deleteTestUser(userC);
      }
    });

    it("admin.deleteUser cascades all domain rows for that user", async () => {
      const admin = serviceRoleClient();

      const { error: delErr } = await admin.auth.admin.deleteUser(userC.id);
      expect(delErr).toBeNull();
      cascadeRan = true;

      // Service-role SELECT bypasses RLS — a zero count is unambiguous proof of
      // cascade, not just "B can't see C's rows".
      const [locResult, plantResult, eventResult] = await Promise.all([
        admin.from("locations").select("id", { count: "exact", head: true }).eq("user_id", userC.id),
        admin.from("plants").select("id", { count: "exact", head: true }).eq("user_id", userC.id),
        admin.from("care_events").select("id", { count: "exact", head: true }).eq("user_id", userC.id),
      ]);

      expect(locResult.count).toBe(0);
      expect(plantResult.count).toBe(0);
      expect(eventResult.count).toBe(0);
    });
  });
});
