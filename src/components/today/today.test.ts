import { describe, expect, it } from "vitest";

import { sortPlants } from "./sort";
import type { TodayPlant } from "@/types";

const plant = (id: string, name: string, daysOverdue: number): TodayPlant => ({
  id,
  name,
  locationName: "Test",
  daysOverdue,
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
