import { describe, expect, it } from "vitest";

import { normalizeSuggestion } from "@/lib/ai/suggest";

// Oracle-driven contract suite for `normalizeSuggestion` (Risk #5). Every
// assertion derives from sources — the PRD care-profile contract, the
// `AiSuggestion` type, and the DB CHECK constraints (research §2) — never from
// re-reading the function's current output. The suite proves the normalizer
// (1) never throws, (2) always emits the five-key `AiSuggestion` shape, and
// (3) honours the per-field coercion policies decided at plan time.

const CONTRACT_KEYS = ["description", "species", "sunlight", "watering_interval_days", "winterization_cutoff"] as const;

const ALL_NULL = {
  species: null,
  description: null,
  sunlight: null,
  watering_interval_days: null,
  winterization_cutoff: null,
};

/**
 * Assert the cross-domain output invariants from research §2: exactly the five
 * `AiSuggestion` keys, the string fields `string | null`, watering
 * `number | null`, winterization `string | null`. Reads go through a
 * `Record<string, unknown>` so each runtime check is meaningful — the static
 * type would otherwise make these conditions redundant (and a regression that
 * broke them at runtime would slip past a type-narrowed check).
 */
function assertContractShape(result: Record<string, unknown>): void {
  expect(Object.keys(result).sort()).toEqual([...CONTRACT_KEYS]);
  for (const key of ["species", "description", "sunlight"] as const) {
    const value = result[key];
    expect(value === null || typeof value === "string").toBe(true);
  }
  const watering = result.watering_interval_days;
  expect(watering === null || typeof watering === "number").toBe(true);
  const cutoff = result.winterization_cutoff;
  expect(cutoff === null || typeof cutoff === "string").toBe(true);
}

describe("normalizeSuggestion", () => {
  describe("contract invariants across the provider input domain", () => {
    const fixtures: { label: string; input: unknown }[] = [
      {
        label: "a fully-valid happy-path object",
        input: {
          species: "Monstera deliciosa",
          description: "A popular tropical houseplant.",
          sunlight: "bright indirect light",
          watering_interval_days: 7,
          winterization_cutoff: "2026-10-15",
        },
      },
      { label: "an empty object", input: {} },
      { label: "an object missing all but one field", input: { species: "Monstera" } },
      {
        label: "an object with extra/unknown keys",
        input: { species: "Monstera", toxicity: "toxic to cats", hardiness_zones: [9, 10, 11] },
      },
      {
        label: "an object with every field explicitly null",
        input: {
          species: null,
          description: null,
          sunlight: null,
          watering_interval_days: null,
          winterization_cutoff: null,
        },
      },
      {
        label: "an object with wrong-typed fields",
        input: {
          species: 12345,
          description: true,
          sunlight: {},
          watering_interval_days: "7",
          winterization_cutoff: 20261015,
        },
      },
      {
        label: "an object with empty/whitespace strings",
        input: { species: "", description: "  ", sunlight: "\t" },
      },
      { label: "a null root", input: null },
      { label: "an undefined root", input: undefined },
      { label: "a boolean root", input: true },
      { label: "a string root", input: "Monstera" },
      { label: "an array root", input: [1, 2, 3] },
    ];

    it.each(fixtures)("never throws and emits the 5-key typed contract for $label", ({ input }) => {
      expect(() => normalizeSuggestion(input)).not.toThrow();
      assertContractShape(normalizeSuggestion(input) as unknown as Record<string, unknown>);
    });

    const nonObjectRoots: { label: string; input: unknown }[] = [
      { label: "null", input: null },
      { label: "undefined", input: undefined },
      { label: "a boolean", input: true },
      { label: "a string", input: "Monstera" },
      // `isRecord` is true for arrays (typeof [] === "object"), but no keys match.
      { label: "an array", input: [1, 2, 3] },
    ];

    it.each(nonObjectRoots)("maps the non-object root $label to an all-null suggestion", ({ input }) => {
      expect(normalizeSuggestion(input)).toEqual(ALL_NULL);
    });

    it("preserves every valid field on the happy path", () => {
      expect(
        normalizeSuggestion({
          species: "Monstera deliciosa",
          description: "A popular tropical houseplant.",
          sunlight: "bright indirect light",
          watering_interval_days: 7,
          winterization_cutoff: "2026-10-15",
        }),
      ).toEqual({
        species: "Monstera deliciosa",
        description: "A popular tropical houseplant.",
        sunlight: "bright indirect light",
        watering_interval_days: 7,
        winterization_cutoff: "2026-10-15",
      });
    });

    it("drops extra/unknown keys and keeps only the contract fields", () => {
      const result = normalizeSuggestion({
        species: "Monstera",
        toxicity: "toxic to cats",
        hardiness_zones: [9, 10, 11],
      });
      expect(Object.keys(result).sort()).toEqual([...CONTRACT_KEYS]);
      expect(result.species).toBe("Monstera");
    });
  });

  describe("watering_interval_days policy (DB check: positive integer or null)", () => {
    const wateringInputs: { label: string; input: unknown }[] = [
      { label: "0", input: 0 },
      { label: "-5", input: -5 },
      { label: "7.5", input: 7.5 },
      { label: '"7" (numeric string)', input: "7" },
      { label: '"every few days"', input: "every few days" },
      { label: "Infinity", input: Number.POSITIVE_INFINITY },
      { label: "NaN", input: Number.NaN },
      { label: "12", input: 12 },
      { label: "true", input: true },
      { label: "null", input: null },
    ];

    it.each(wateringInputs)("coerces $label to null or a positive integer (never a DB-rejected value)", ({ input }) => {
      const out: unknown = normalizeSuggestion({ watering_interval_days: input }).watering_interval_days;
      const valid = out === null || (typeof out === "number" && Number.isInteger(out) && out >= 1);
      expect(valid).toBe(true);
    });

    it('coerces the numeric string "7" to 7', () => {
      expect(normalizeSuggestion({ watering_interval_days: "7" }).watering_interval_days).toBe(7);
    });

    it("rounds 7.5 to 8 (round-to-nearest is the chosen contract)", () => {
      expect(normalizeSuggestion({ watering_interval_days: 7.5 }).watering_interval_days).toBe(8);
    });
  });

  describe("winterization_cutoff date policy (DB type: date; PRD 'none' → null)", () => {
    it("passes a leading YYYY-MM-DD through unchanged", () => {
      expect(normalizeSuggestion({ winterization_cutoff: "2026-10-01" }).winterization_cutoff).toBe("2026-10-01");
    });

    it("truncates an ISO datetime to its calendar date", () => {
      expect(normalizeSuggestion({ winterization_cutoff: "2026-10-01T08:30:00Z" }).winterization_cutoff).toBe(
        "2026-10-01",
      );
    });

    it.each(["none", "sometime in autumn"])('maps the non-date string "%s" to null', (value) => {
      expect(normalizeSuggestion({ winterization_cutoff: value }).winterization_cutoff).toBeNull();
    });

    it("maps a non-string cutoff to null", () => {
      expect(normalizeSuggestion({ winterization_cutoff: 20261001 }).winterization_cutoff).toBeNull();
    });

    // Node + TZ=UTC scoped: `new Date("2026/10/01")` parses as local time, and the
    // setup file pins TZ=UTC so `.toISOString().slice(0,10)` is stable here. This is
    // NOT guaranteed on workerd — see plan §"Critical Implementation Details".
    it("parses a non-ISO date via the Node new Date() fallback (TZ=UTC-scoped)", () => {
      expect(normalizeSuggestion({ winterization_cutoff: "2026/10/01" }).winterization_cutoff).toBe("2026-10-01");
    });

    const dateOutputs: { label: string; input: unknown }[] = [
      { label: "a valid ISO date", input: "2026-10-01" },
      { label: "an ISO datetime", input: "2026-10-01T08:30:00Z" },
      // "none" is the one input that can expose a "none"-leak (the `not.toBe("none")`
      // guard below); generic non-date prose is exact-asserted in the `→ null` test
      // above, so it would only be a redundant copy of this same fallback branch here.
      { label: '"none"', input: "none" },
      { label: "a non-string", input: 20261001 },
      { label: "a non-ISO date", input: "2026/10/01" },
      { label: "an empty string", input: "" },
    ];

    it.each(dateOutputs)('emits null or a YYYY-MM-DD string (never "none") for $label', ({ input }) => {
      const out: unknown = normalizeSuggestion({ winterization_cutoff: input }).winterization_cutoff;
      const valid = out === null || (typeof out === "string" && /^\d{4}-\d{2}-\d{2}$/.test(out));
      expect(valid).toBe(true);
      expect(out).not.toBe("none");
    });
  });

  describe("string fields trim and null out empties", () => {
    it("maps empty/whitespace species, description, and sunlight to null", () => {
      expect(normalizeSuggestion({ species: "", description: "  ", sunlight: "\t" })).toEqual(ALL_NULL);
    });

    it("trims surrounding whitespace on a non-empty string", () => {
      expect(normalizeSuggestion({ species: "  Monstera  " }).species).toBe("Monstera");
    });
  });

  // KNOWN GAP (Risk #5, 2nd face) — to be fixed under a Lesson-5 change.
  // `asIsoDate`'s leading-regex branch returns a regex-matching but
  // calendar-invalid date verbatim (JS `Date` rolls 2024-02-30 over, so the
  // `T00:00:00Z` validity check passes). The DB `date` column would REJECT this
  // value. The test below characterizes the current behavior; it does NOT endorse
  // it as the desired contract. Escalated in test-plan §6.6.
  describe("KNOWN GAP (Risk #5, 2nd face): calendar-invalid date passthrough", () => {
    it("characterizes 2024-02-30 passing through verbatim (documented, not fixed — see test-plan §6.6)", () => {
      expect(normalizeSuggestion({ winterization_cutoff: "2024-02-30" }).winterization_cutoff).toBe("2024-02-30");
    });
  });
});
