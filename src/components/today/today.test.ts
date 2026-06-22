import { describe, expect, it } from "vitest";

import { sortPlants, sortWinterPlants } from "./sort";
import type { TodayPlant, TodayWinterPlant } from "@/types";

const plant = (id: string, name: string, daysOverdue: number): TodayPlant => ({
  id,
  name,
  locationName: "Test",
  daysOverdue,
});

const winterPlant = (id: string, name: string, cutoff: string): TodayWinterPlant => ({
  id,
  name,
  locationName: "Test",
  cutoff,
});

describe("sortPlants", () => {
  it("places the most-overdue plant first", () => {
    const result = sortPlants([plant("1", "A", 1), plant("2", "B", 3)]);
    expect(result[0].id).toBe("2");
  });

  it("sorts alphabetically by name when daysOverdue is equal", () => {
    const result = sortPlants([plant("1", "Zebra", 2), plant("2", "Apple", 2)]);
    expect(result[0].id).toBe("2");
  });

  it("does not mutate the input array", () => {
    const plants = [plant("1", "B", 1), plant("2", "A", 2)];
    const copy = [...plants];
    sortPlants(plants);
    expect(plants).toEqual(copy);
  });

  it("returns an empty array unchanged", () => {
    expect(sortPlants([])).toEqual([]);
  });

  it("handles a single plant", () => {
    const p = plant("1", "Monstera", 5);
    expect(sortPlants([p])).toEqual([p]);
  });
});

describe("sortWinterPlants", () => {
  it("places the earliest cutoff first", () => {
    const result = sortWinterPlants([winterPlant("1", "A", "2026-11-15"), winterPlant("2", "B", "2026-10-01")]);
    expect(result[0].id).toBe("2");
  });

  it("sorts alphabetically by name when cutoff is equal", () => {
    const result = sortWinterPlants([winterPlant("1", "Zebra", "2026-10-01"), winterPlant("2", "Apple", "2026-10-01")]);
    expect(result[0].id).toBe("2");
  });

  it("does not mutate the input array", () => {
    const plants = [winterPlant("1", "B", "2026-11-01"), winterPlant("2", "A", "2026-10-01")];
    const copy = [...plants];
    sortWinterPlants(plants);
    expect(plants).toEqual(copy);
  });

  it("returns an empty array unchanged", () => {
    expect(sortWinterPlants([])).toEqual([]);
  });

  it("handles a single plant", () => {
    const p = winterPlant("1", "Monstera", "2026-10-15");
    expect(sortWinterPlants([p])).toEqual([p]);
  });
});
