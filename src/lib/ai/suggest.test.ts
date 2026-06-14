import { describe, expect, it } from "vitest";

import { normalizeSuggestion } from "@/lib/ai/suggest";

// Phase 1 smoke test: proves the Vitest runner + `@` alias + module isolation
// work end to end. `normalizeSuggestion` import-resolves with no `astro:env` or
// workerd machinery, and an empty object yields the five-key `AiSuggestion`
// shape with every field null. Phase 2 expands this file into the full
// oracle-driven contract suite.
describe("normalizeSuggestion", () => {
  it("returns the five-key AiSuggestion shape (all null) for an empty object", () => {
    expect(normalizeSuggestion({})).toEqual({
      species: null,
      description: null,
      sunlight: null,
      watering_interval_days: null,
      winterization_cutoff: null,
    });
  });
});
