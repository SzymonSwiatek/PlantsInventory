import { describe, expect, it, vi } from "vitest";

vi.mock("./service-client", () => ({ createServiceClient: vi.fn() }));
vi.mock("./email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./email")>();
  return { ...actual, sendDigest: vi.fn() };
});

import { createServiceClient } from "./service-client";
import { sendDigest } from "./email";
import type { ReminderEnv } from "./service-client";
import { runScheduledTick } from "./scheduled";

const ENV: ReminderEnv = {
  SUPABASE_URL: "http://test",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  RESEND_API_KEY: "resend-key",
  REMINDER_FROM_EMAIL: "from@test.com",
  PUBLIC_SITE_URL: "https://example.com",
};

describe("runScheduledTick — per-user fault isolation (3.2)", () => {
  it("continues sending to remaining users when one user's sendDigest rejects", async () => {
    const now = new Date("2026-01-15T08:00:00.000Z");
    const dueDate = "2026-01-14T00:00:00.000Z";

    const waterBuilder = {
      not: vi.fn(),
      lte: vi.fn(),
      or: vi.fn().mockResolvedValue({
        data: [
          { name: "Plant A", user_id: "user-1", next_water_due_at: dueDate, locations: { name: "Room A" } },
          { name: "Plant B", user_id: "user-2", next_water_due_at: dueDate, locations: { name: "Room B" } },
        ],
        error: null,
      }),
    };
    waterBuilder.not.mockReturnValue(waterBuilder);
    waterBuilder.lte.mockReturnValue(waterBuilder);

    const getUserById = vi.fn((userId: string) => {
      const emails: Record<string, string> = { "user-1": "alice@example.com", "user-2": "bob@example.com" };
      return Promise.resolve({ data: { user: { email: emails[userId] } }, error: null });
    });

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "winterization_due_plants") {
          return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }
        if (table === "user_preferences") {
          return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) };
        }
        return { select: vi.fn().mockReturnValue(waterBuilder) };
      }),
      auth: { admin: { getUserById } },
    };
    vi.mocked(createServiceClient).mockReturnValue(mockClient as never);

    vi.mocked(sendDigest).mockImplementation((to: string) => {
      if (to === "alice@example.com") return Promise.reject(new Error("Resend unavailable"));
      return Promise.resolve(undefined);
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runScheduledTick(now, ENV);

    expect(sendDigest).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ event: "scheduled.email_error" }));
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "scheduled.summary", total: 2, emails_sent: 1 }),
    );

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("sends nothing when user_preferences query fails (2.3)", async () => {
    const now = new Date("2026-01-15T08:00:00.000Z");
    const dueDate = "2026-01-14T00:00:00.000Z";

    const waterBuilder = {
      not: vi.fn(),
      lte: vi.fn(),
      or: vi.fn().mockResolvedValue({
        data: [{ name: "Monstera", user_id: "user-1", next_water_due_at: dueDate, locations: { name: "Room" } }],
        error: null,
      }),
    };
    waterBuilder.not.mockReturnValue(waterBuilder);
    waterBuilder.lte.mockReturnValue(waterBuilder);

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "winterization_due_plants") {
          return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }
        if (table === "user_preferences") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: { message: "db_error" } }),
            }),
          };
        }
        return { select: vi.fn().mockReturnValue(waterBuilder) };
      }),
      auth: { admin: { getUserById: vi.fn() } },
    };
    vi.mocked(createServiceClient).mockReturnValue(mockClient as never);
    vi.mocked(sendDigest).mockReset();

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runScheduledTick(now, ENV);

    expect(sendDigest).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "scheduled.query_error", query: "preferences" }),
    );

    errorSpy.mockRestore();
  });
});
