import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./service-client", () => ({ createServiceClient: vi.fn() }));
vi.mock("./email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./email")>();
  return { ...actual, sendDigest: vi.fn() };
});

import { createServiceClient } from "./service-client";
import { sendDigest } from "./email";
import type { ReminderEnv } from "./service-client";
import { runScheduledTick } from "./scheduled";

const EMPTY_ENV: ReminderEnv = {
  SUPABASE_URL: undefined,
  SUPABASE_SERVICE_ROLE_KEY: undefined,
  RESEND_API_KEY: undefined,
  REMINDER_FROM_EMAIL: undefined,
  PUBLIC_SITE_URL: undefined,
};

/** Water query builder: resolves after the .not().not().lte().or() chain. */
function makeWaterBuilder(result: { data: unknown[] | null; error: null }) {
  const builder = {
    not: vi.fn(),
    lte: vi.fn(),
    or: vi.fn().mockResolvedValue(result),
  };
  builder.not.mockReturnValue(builder);
  builder.lte.mockReturnValue(builder);
  return builder;
}

/** Mock client whose from() returns the right builder for each table. */
function makeMockClient(
  waterResult: { data: unknown[] | null; error: null },
  winterResult: { data: unknown[] | null; error: null },
  getUserById: ReturnType<typeof vi.fn> = vi
    .fn()
    .mockResolvedValue({ data: { user: { email: "test@example.com" } }, error: null }),
  prefsResult: { data: { user_id: string }[] | null; error: null } = { data: [], error: null },
) {
  const waterBuilder = makeWaterBuilder(waterResult);
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "winterization_due_plants") {
        return { select: vi.fn().mockResolvedValue(winterResult) };
      }
      if (table === "user_preferences") {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue(prefsResult) }) };
      }
      return { select: vi.fn().mockReturnValue(waterBuilder) };
    }),
    auth: { admin: { getUserById } },
  };
}

describe("runScheduledTick", () => {
  beforeEach(() => {
    vi.mocked(createServiceClient).mockReturnValue(null);
    vi.mocked(sendDigest).mockReset();
    vi.mocked(sendDigest).mockResolvedValue(undefined);
  });

  it("emits a structured heartbeat log with the expected event marker", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const now = new Date("2026-01-15T08:00:00.000Z");

    await runScheduledTick(now, EMPTY_ENV);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: "scheduled.tick", ts: now.toISOString() }));

    spy.mockRestore();
  });

  it("logs scheduled.skip and returns when service client is unavailable", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const now = new Date("2026-01-15T08:00:00.000Z");

    await runScheduledTick(now, EMPTY_ENV);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: "scheduled.skip" }));

    spy.mockRestore();
  });

  it("does not call sendDigest when no plants are due (3.3)", async () => {
    const now = new Date("2026-01-15T08:00:00.000Z");
    const mockClient = makeMockClient({ data: [], error: null }, { data: [], error: null });
    vi.mocked(createServiceClient).mockReturnValue(mockClient as never);

    await runScheduledTick(now, EMPTY_ENV);

    expect(sendDigest).not.toHaveBeenCalled();
  });

  it("sends digest to each user with due water plants; excludes users with no due plants (3.1)", async () => {
    const now = new Date("2026-01-15T08:00:00.000Z");
    const dueDate = "2026-01-14T00:00:00.000Z";

    const getUserById = vi.fn((userId: string) => {
      const emails: Record<string, string> = {
        "user-1": "alice@example.com",
        "user-2": "bob@example.com",
      };
      return Promise.resolve({ data: { user: { email: emails[userId] } }, error: null });
    });

    const mockClient = makeMockClient(
      {
        data: [
          { name: "Monstera", user_id: "user-1", next_water_due_at: dueDate, locations: { name: "Living Room" } },
          { name: "Cactus", user_id: "user-2", next_water_due_at: dueDate, locations: { name: "Office" } },
        ],
        error: null,
      },
      { data: [], error: null },
      getUserById,
    );
    vi.mocked(createServiceClient).mockReturnValue(mockClient as never);

    await runScheduledTick(now, EMPTY_ENV);

    expect(sendDigest).toHaveBeenCalledTimes(2);
    const sentEmails = vi.mocked(sendDigest).mock.calls.map((args) => args[0]);
    expect(sentEmails).toContain("alice@example.com");
    expect(sentEmails).toContain("bob@example.com");
  });

  it("sends digest to a winter-only user (no water due) (2.2)", async () => {
    const now = new Date("2026-01-15T08:00:00.000Z");

    const getUserById = vi.fn().mockResolvedValue({ data: { user: { email: "winter@example.com" } }, error: null });

    const mockClient = makeMockClient(
      { data: [], error: null },
      {
        data: [
          {
            name: "Olive Tree",
            user_id: "user-w",
            location_name: "Balcony",
            winterization_cutoff: "2026-10-15",
          },
        ],
        error: null,
      },
      getUserById,
    );
    vi.mocked(createServiceClient).mockReturnValue(mockClient as never);

    await runScheduledTick(now, EMPTY_ENV);

    expect(sendDigest).toHaveBeenCalledOnce();
    expect(sendDigest).toHaveBeenCalledWith("winter@example.com", expect.anything(), EMPTY_ENV);
  });

  it("winter-due rows are grouped per user in the digest (2.2)", async () => {
    const now = new Date("2026-01-15T08:00:00.000Z");

    const getUserById = vi.fn((userId: string) => {
      const emails: Record<string, string> = {
        "user-1": "alice@example.com",
        "user-2": "bob@example.com",
      };
      return Promise.resolve({ data: { user: { email: emails[userId] } }, error: null });
    });

    const mockClient = makeMockClient(
      { data: [], error: null },
      {
        data: [
          { name: "Olive Tree", user_id: "user-1", location_name: "Balcony", winterization_cutoff: "2026-10-15" },
          { name: "Lemon", user_id: "user-2", location_name: "Garden", winterization_cutoff: "2026-11-01" },
        ],
        error: null,
      },
      getUserById,
    );
    vi.mocked(createServiceClient).mockReturnValue(mockClient as never);

    await runScheduledTick(now, EMPTY_ENV);

    expect(sendDigest).toHaveBeenCalledTimes(2);
  });

  it("skips a user whose email lookup fails and continues to the next (partial 3.1)", async () => {
    const now = new Date("2026-01-15T08:00:00.000Z");
    const dueDate = "2026-01-14T00:00:00.000Z";

    const getUserById = vi.fn((userId: string) => {
      if (userId === "user-1") return Promise.resolve({ data: null, error: { message: "not found" } });
      return Promise.resolve({ data: { user: { email: "bob@example.com" } }, error: null });
    });

    const mockClient = makeMockClient(
      {
        data: [
          { name: "Monstera", user_id: "user-1", next_water_due_at: dueDate, locations: { name: "Living Room" } },
          { name: "Cactus", user_id: "user-2", next_water_due_at: dueDate, locations: { name: "Office" } },
        ],
        error: null,
      },
      { data: [], error: null },
      getUserById,
    );
    vi.mocked(createServiceClient).mockReturnValue(mockClient as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runScheduledTick(now, EMPTY_ENV);

    expect(sendDigest).toHaveBeenCalledOnce();
    expect(sendDigest).toHaveBeenCalledWith("bob@example.com", expect.anything(), EMPTY_ENV);

    vi.restoreAllMocks();
  });

  it("emits scheduled.summary with correct counts", async () => {
    const now = new Date("2026-01-15T08:00:00.000Z");
    const dueDate = "2026-01-14T00:00:00.000Z";

    const mockClient = makeMockClient(
      {
        data: [{ name: "Fern", user_id: "user-1", next_water_due_at: dueDate, locations: { name: "Hallway" } }],
        error: null,
      },
      { data: [], error: null },
      vi.fn().mockResolvedValue({ data: { user: { email: "alice@example.com" } }, error: null }),
    );
    vi.mocked(createServiceClient).mockReturnValue(mockClient as never);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runScheduledTick(now, EMPTY_ENV);

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "scheduled.summary", total: 1, emails_sent: 1 }),
    );

    logSpy.mockRestore();
  });

  it("skips opted-out user but emails user with no preferences row (2.2)", async () => {
    const now = new Date("2026-01-15T08:00:00.000Z");
    const dueDate = "2026-01-14T00:00:00.000Z";

    const getUserById = vi.fn((userId: string) => {
      const emails: Record<string, string> = {
        "user-opted-out": "optout@example.com",
        "user-enabled": "enabled@example.com",
      };
      return Promise.resolve({ data: { user: { email: emails[userId] } }, error: null });
    });

    const mockClient = makeMockClient(
      {
        data: [
          { name: "Plant A", user_id: "user-opted-out", next_water_due_at: dueDate, locations: { name: "Room" } },
          { name: "Plant B", user_id: "user-enabled", next_water_due_at: dueDate, locations: { name: "Room" } },
        ],
        error: null,
      },
      { data: [], error: null },
      getUserById,
      { data: [{ user_id: "user-opted-out" }], error: null },
    );
    vi.mocked(createServiceClient).mockReturnValue(mockClient as never);

    await runScheduledTick(now, EMPTY_ENV);

    expect(sendDigest).toHaveBeenCalledOnce();
    expect(sendDigest).toHaveBeenCalledWith("enabled@example.com", expect.anything(), EMPTY_ENV);
  });

  it("includes opted_out count in scheduled.summary log (2.2)", async () => {
    const now = new Date("2026-01-15T08:00:00.000Z");
    const dueDate = "2026-01-14T00:00:00.000Z";

    const mockClient = makeMockClient(
      {
        data: [{ name: "Fern", user_id: "user-1", next_water_due_at: dueDate, locations: { name: "Hall" } }],
        error: null,
      },
      { data: [], error: null },
      vi.fn().mockResolvedValue({ data: { user: { email: "alice@example.com" } }, error: null }),
      { data: [{ user_id: "user-skipped" }], error: null },
    );
    vi.mocked(createServiceClient).mockReturnValue(mockClient as never);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runScheduledTick(now, EMPTY_ENV);

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ event: "scheduled.summary", opted_out: 1 }));

    logSpy.mockRestore();
  });
});
