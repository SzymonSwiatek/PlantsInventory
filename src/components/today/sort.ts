import type { TodayPlant } from "@/types";

/** Sort by most-overdue first, then alphabetically by name. Does not mutate input. */
export function sortPlants(plants: TodayPlant[]): TodayPlant[] {
  return [...plants].sort((a, b) => b.daysOverdue - a.daysOverdue || a.name.localeCompare(b.name));
}
