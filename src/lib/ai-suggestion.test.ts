import { describe, expect, it } from "vitest";

import { aiValueUnchanged } from "./ai-suggestion";

describe("aiValueUnchanged", () => {
  describe("number kind", () => {
    it('matches across string/number representations (7 vs "7")', () => {
      expect(aiValueUnchanged("number", "7", 7)).toBe(true);
      expect(aiValueUnchanged("number", 7, "7")).toBe(true);
    });

    it("is false when the numbers differ (7 vs 8)", () => {
      expect(aiValueUnchanged("number", 8, 7)).toBe(false);
    });
  });

  describe("date kind", () => {
    it("matches the same day with and without a time component", () => {
      expect(aiValueUnchanged("date", "2026-11-01T00:00:00.000Z", "2026-11-01")).toBe(true);
    });

    it("matches a bare YYYY-MM-DD without a TZ shift (string-slice path)", () => {
      expect(aiValueUnchanged("date", "2026-11-01", "2026-11-01")).toBe(true);
    });

    it("is false when the days differ", () => {
      expect(aiValueUnchanged("date", "2026-11-02", "2026-11-01")).toBe(false);
    });
  });

  describe("text / multiline kind", () => {
    it('trims before comparing ("Aloe " vs "Aloe")', () => {
      expect(aiValueUnchanged("text", "Aloe ", "Aloe")).toBe(true);
      expect(aiValueUnchanged("multiline", " A succulent. ", "A succulent.")).toBe(true);
    });

    it("is false when the trimmed text differs", () => {
      expect(aiValueUnchanged("text", "Aloe vera", "Aloe")).toBe(false);
    });
  });

  describe("select kind", () => {
    it("is always false (no AI suggestion applies)", () => {
      expect(aiValueUnchanged("select", "loc-1", "loc-1")).toBe(false);
    });
  });

  describe("absent AI value", () => {
    it("is false when aiValue is null, undefined, or empty string", () => {
      expect(aiValueUnchanged("text", "Aloe", null)).toBe(false);
      expect(aiValueUnchanged("number", 7, "")).toBe(false);
      expect(aiValueUnchanged("date", "2026-11-01", "")).toBe(false);
    });
  });

  describe("cleared current value", () => {
    it("is false when the current value is cleared against a non-null AI value", () => {
      expect(aiValueUnchanged("text", "", "Aloe")).toBe(false);
      expect(aiValueUnchanged("text", null, "Aloe")).toBe(false);
      expect(aiValueUnchanged("date", null, "2026-11-01")).toBe(false);
    });
  });
});
