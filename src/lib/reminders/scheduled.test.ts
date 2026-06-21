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

function makeQueryBuilder(result: { data: unknown[] | null; error: null }) {
  const builder = {
    not: vi.fn(),
    lte: vi.fn(),
    or: vi.fn().mockResolvedValue(result),
  };
  builder.not.mockReturnValue(builder);
  builder.lte.mockReturnValue(builder);
  return builder;
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
    const builder = makeQueryBuilder({ data: [], error: null });
    const mockClient = {
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(builder) }),
      auth: { admin: { getUserById: vi.fn() } },
    };
    vi.mocked(createServiceClient).mockReturnValue(mockClient as never);

    await runScheduledTick(now, EMPTY_ENV);

    expect(sendDigest).not.toHaveBeenCalled();
  });

  it("sends digest to each user with due plants; excludes users with no due plants (3.1)", async () => {
    const now = new Date("2026-01-15T08:00:00.000Z");
    const dueDate = "2026-01-14T00:00:00.000Z"; // yesterday — 1 day overdue

    const builder = makeQueryBuilder({
      data: [
        { name: "Monstera", user_id: "user-1", next_water_due_at: dueDate, locations: { name: "Living Room" } },
        { name: "Cactus", user_id: "user-2", next_water_due_at: dueDate, locations: { name: "Office" } },
      ],
      error: null,
    });

    const getUserById = vi.fn((userId: string) => {
      const emails: Record<string, string> = {
        "user-1": "alice@example.com",
        "user-2": "bob@example.com",
      };
      return Promise.resolve({ data: { user: { email: emails[userId] } }, error: null });
    });

    const mockClient = {
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(builder) }),
      auth: { admin: { getUserById } },
    };
    vi.mocked(createServiceClient).mockReturnValue(mockClient as never);

    await runScheduledTick(now, EMPTY_ENV);

    expect(sendDigest).toHaveBeenCalledTimes(2);
    const sentEmails = vi.mocked(sendDigest).mock.calls.map((args) => args[0]);
    expect(sentEmails).toContain("alice@example.com");
    expect(sentEmails).toContain("bob@example.com");
  });

  it("skips a user whose email lookup fails and continues to the next (partial 3.1)", async () => {
    const now = new Date("2026-01-15T08:00:00.000Z");
    const dueDate = "2026-01-14T00:00:00.000Z";

    const builder = makeQueryBuilder({
      data: [
        { name: "Monstera", user_id: "user-1", next_water_due_at: dueDate, locations: { name: "Living Room" } },
        { name: "Cactus", user_id: "user-2", next_water_due_at: dueDate, locations: { name: "Office" } },
      ],
      error: null,
    });

    const getUserById = vi.fn((userId: string) => {
      if (userId === "user-1") return Promise.resolve({ data: null, error: { message: "not found" } });
      return Promise.resolve({ data: { user: { email: "bob@example.com" } }, error: null });
    });

    const mockClient = {
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(builder) }),
      auth: { admin: { getUserById } },
    };
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

    const builder = makeQueryBuilder({
      data: [{ name: "Fern", user_id: "user-1", next_water_due_at: dueDate, locations: { name: "Hallway" } }],
      error: null,
    });

    const mockClient = {
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(builder) }),
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({ data: { user: { email: "alice@example.com" } }, error: null }),
        },
      },
    };
    vi.mocked(createServiceClient).mockReturnValue(mockClient as never);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runScheduledTick(now, EMPTY_ENV);

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "scheduled.summary", total: 1, emails_sent: 1 }),
    );

    logSpy.mockRestore();
  });
});
