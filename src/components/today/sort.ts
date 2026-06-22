import type { TodayPlant, TodayWinterPlant } from "@/types";

/** Sort by most-overdue first, then alphabetically by name. Does not mutate input. */
export function sortPlants(plants: TodayPlant[]): TodayPlant[] {
  return [...plants].sort((a, b) => b.daysOverdue - a.daysOverdue || a.name.localeCompare(b.name));
}

/** Sort by earliest cutoff first, then alphabetically by name. Does not mutate input. */
export function sortWinterPlants(plants: TodayWinterPlant[]): TodayWinterPlant[] {
  return [...plants].sort((a, b) => a.cutoff.localeCompare(b.cutoff) || a.name.localeCompare(b.name));
}
