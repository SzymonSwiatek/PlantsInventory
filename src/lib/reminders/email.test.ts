import { describe, expect, it } from "vitest";

import { composeDigest } from "./email";
import type { DuePlant } from "./email";

describe("composeDigest", () => {
  const plants: DuePlant[] = [
    { name: "Monstera", locationName: "Living Room", daysOverdue: 0 },
    { name: "Ficus", locationName: "Office", daysOverdue: 3 },
  ];

  it("names each plant and its location in the subject and body", () => {
    const { subject, text, html } = composeDigest(plants, "https://example.com");

    expect(subject).toContain("2 plants");
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
    const { subject } = composeDigest([plants[0]], "https://example.com");
    expect(subject).toContain("1 plant");
    expect(subject).not.toContain("plants");
  });

  it("includes the /today link using the provided siteUrl", () => {
    const { text, html } = composeDigest(plants, "https://myapp.com");
    expect(text).toContain("https://myapp.com/today");
    expect(html).toContain("https://myapp.com/today");
  });

  it("falls back to a bare /today path when siteUrl is empty", () => {
    const { text, html } = composeDigest(plants, "");
    expect(text).toContain("/today");
    expect(html).toContain("/today");
    expect(text).not.toMatch(/https?:\/\//);
  });

  it("shows overdue count for plants past their due date", () => {
    const { text } = composeDigest(plants, "https://example.com");
    expect(text).toContain("3 days overdue");
  });

  it("does not show overdue label for plants due today", () => {
    const { text } = composeDigest([plants[0]], "https://example.com");
    expect(text).not.toContain("overdue");
  });

  it("escapes HTML in user-controlled plant and location names", () => {
    const malicious: DuePlant[] = [
      { name: '<img src=x onerror="alert(1)">', locationName: "Den & <b>Patio</b>", daysOverdue: 0 },
    ];
    const { html } = composeDigest(malicious, "https://example.com");

    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>Patio</b>");
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain("Den &amp; &lt;b&gt;Patio&lt;/b&gt;");
  });
});
