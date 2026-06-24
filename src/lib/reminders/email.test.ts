import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("resend");

import { composeDigest, sendDigest } from "./email";
import type { DuePlant, DueWinterPlant } from "./email";
import type { ReminderEnv } from "./service-client";

const waterPlants: DuePlant[] = [
  { name: "Monstera", locationName: "Living Room", daysOverdue: 0 },
  { name: "Ficus", locationName: "Office", daysOverdue: 3 },
];

const winterPlants: DueWinterPlant[] = [
  { name: "Olive Tree", locationName: "Balcony", cutoff: "2026-10-15" },
  { name: "Lemon", locationName: "Garden", cutoff: "2026-11-01" },
];

describe("composeDigest — water-only", () => {
  it("names each plant and its location in the subject and body", () => {
    const { subject, text, html } = composeDigest({ water: waterPlants, winter: [] }, "https://example.com");

    expect(subject).toContain("2 plants");
    expect(subject).toContain("watering");
    expect(text).toContain("Monstera");
    expect(text).toContain("Living Room");
    expect(text).toContain("Ficus");
    expect(text).toContain("Office");
    expect(html).toContain("Monstera");
    expect(html).toContain("Living Room");
    expect(html).toContain("Ficus");
    expect(html).toContain("Office");
  });

  it("uses singular for a single plant", () => {
    const { subject } = composeDigest({ water: [waterPlants[0]], winter: [] }, "https://example.com");
    expect(subject).toContain("1 plant");
    expect(subject).not.toContain("plants");
  });

  it("includes the /today link using the provided siteUrl", () => {
    const { text, html } = composeDigest({ water: waterPlants, winter: [] }, "https://myapp.com");
    expect(text).toContain("https://myapp.com/today");
    expect(html).toContain("https://myapp.com/today");
  });

  it("falls back to a bare /today path when siteUrl is empty", () => {
    const { text, html } = composeDigest({ water: waterPlants, winter: [] }, "");
    expect(text).toContain("/today");
    expect(html).toContain("/today");
    expect(text).not.toMatch(/https?:\/\//);
  });

  it("shows overdue count for plants past their due date", () => {
    const { text } = composeDigest({ water: waterPlants, winter: [] }, "https://example.com");
    expect(text).toContain("3 days overdue");
  });

  it("does not show overdue label for plants due today", () => {
    const { text } = composeDigest({ water: [waterPlants[0]], winter: [] }, "https://example.com");
    expect(text).not.toContain("overdue");
  });

  it("escapes HTML in user-controlled plant and location names", () => {
    const malicious: DuePlant[] = [
      { name: '<img src=x onerror="alert(1)">', locationName: "Den & <b>Patio</b>", daysOverdue: 0 },
    ];
    const { html } = composeDigest({ water: malicious, winter: [] }, "https://example.com");

    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>Patio</b>");
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain("Den &amp; &lt;b&gt;Patio&lt;/b&gt;");
  });
});

describe("composeDigest — winter-only", () => {
  it("produces a winterization subject when only winter plants are present", () => {
    const { subject } = composeDigest({ water: [], winter: winterPlants }, "https://example.com");
    expect(subject).toContain("2 plants");
    expect(subject).toContain("winteriz");
    expect(subject).not.toContain("watering");
  });

  it("uses singular for a single winter plant", () => {
    const { subject } = composeDigest({ water: [], winter: [winterPlants[0]] }, "https://example.com");
    expect(subject).toContain("1 plant");
    expect(subject).not.toContain("plants need");
  });

  it("renders the winterization heading in text and html", () => {
    const { text, html } = composeDigest({ water: [], winter: winterPlants }, "https://example.com");
    expect(text).toContain("Bring indoors or secure before cutoff");
    expect(html).toContain("Bring indoors or secure before cutoff");
  });

  it("names each winter plant and its location and cutoff", () => {
    const { text, html } = composeDigest({ water: [], winter: winterPlants }, "https://example.com");
    expect(text).toContain("Olive Tree");
    expect(text).toContain("Balcony");
    expect(text).toContain("2026-10-15");
    expect(html).toContain("Olive Tree");
    expect(html).toContain("Balcony");
    expect(html).toContain("2026-10-15");
  });

  it("escapes HTML in winter plant names and locations", () => {
    const malicious: DueWinterPlant[] = [
      { name: "<script>evil()</script>", locationName: "Yard & <b>Shed</b>", cutoff: "2026-10-15" },
    ];
    const { html } = composeDigest({ water: [], winter: malicious }, "https://example.com");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Shed</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Yard &amp; &lt;b&gt;Shed&lt;/b&gt;");
  });

  it("does not include a watering section", () => {
    const { text, html } = composeDigest({ water: [], winter: winterPlants }, "https://example.com");
    expect(text).not.toContain("watering");
    expect(html).not.toContain("watering");
  });
});

describe("composeDigest — unsubscribe link", () => {
  it("includes the unsubscribe URL in text and html when provided", () => {
    const url = "https://myapp.com/api/reminders/unsubscribe?u=user-1&t=token123";
    const { text, html } = composeDigest({ water: waterPlants, winter: [] }, "https://myapp.com", url);
    expect(text).toContain(url);
    expect(text).toContain("Unsubscribe from these reminders");
    expect(html).toContain(url);
    expect(html).toContain("Unsubscribe from these reminders");
  });

  it("omits unsubscribe content when no URL is provided", () => {
    const { text, html } = composeDigest({ water: waterPlants, winter: [] }, "https://myapp.com");
    expect(text).not.toContain("Unsubscribe");
    expect(html).not.toContain("Unsubscribe");
  });
});

describe("sendDigest — List-Unsubscribe headers", () => {
  const ENV: ReminderEnv = {
    SUPABASE_URL: undefined,
    SUPABASE_SERVICE_ROLE_KEY: undefined,
    RESEND_API_KEY: "resend-key",
    REMINDER_FROM_EMAIL: "from@example.com",
    PUBLIC_SITE_URL: undefined,
    REMINDER_UNSUBSCRIBE_SECRET: undefined,
  };

  // sendFn is replaced in beforeEach so each test gets a fresh spy
  let sendFn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    sendFn = vi.fn().mockResolvedValue({ error: null });
    const { Resend } = await import("resend");
    vi.mocked(Resend).mockImplementation(
      () => ({ emails: { send: sendFn } }) as unknown as InstanceType<typeof import("resend").Resend>,
    );
  });

  it("passes List-Unsubscribe headers to Resend when unsubscribeUrl is provided", async () => {
    const url = "https://myapp.com/api/reminders/unsubscribe?u=user-1&t=token";
    const digest = composeDigest({ water: waterPlants, winter: [] }, "https://myapp.com", url);
    await sendDigest("to@example.com", digest, ENV, url);
    expect(sendFn).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          "List-Unsubscribe": `<${url}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    );
  });

  it("omits headers when no unsubscribeUrl is provided", async () => {
    const digest = composeDigest({ water: waterPlants, winter: [] }, "https://myapp.com");
    await sendDigest("to@example.com", digest, ENV);
    const callArg = sendFn.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArg?.headers).toBeUndefined();
  });
});

describe("composeDigest — combined", () => {
  it("subject mentions both watering and winterizing counts", () => {
    const { subject } = composeDigest({ water: waterPlants, winter: winterPlants }, "https://example.com");
    expect(subject).toContain("2 plants need watering");
    expect(subject).toContain("2 plants need winterizing");
  });

  it("renders both sections in text and html", () => {
    const { text, html } = composeDigest({ water: waterPlants, winter: winterPlants }, "https://example.com");
    // Watering section
    expect(text).toContain("Monstera");
    expect(html).toContain("Monstera");
    // Winterization heading
    expect(text).toContain("Bring indoors or secure before cutoff");
    expect(html).toContain("Bring indoors or secure before cutoff");
    // Winterization plant
    expect(text).toContain("Olive Tree");
    expect(html).toContain("Olive Tree");
  });

  it("includes a single /today link", () => {
    const { text, html } = composeDigest({ water: waterPlants, winter: winterPlants }, "https://example.com");
    expect(text.match(/\/today/g)?.length).toBeGreaterThanOrEqual(1);
    expect(html.match(/\/today/g)?.length).toBeGreaterThanOrEqual(1);
  });
});
