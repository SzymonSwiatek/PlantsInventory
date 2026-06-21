import { useState } from "react";
import { toast, Toaster } from "sonner";
import { Check, Clock, Droplets, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TodayPlant } from "@/types";
import { sortPlants } from "./sort";

interface Props {
  plants: TodayPlant[];
}

const SNOOZE_OPTIONS = [1, 3, 7] as const;
const UNDO_DURATION_MS = 5000;

export default function TodayList({ plants: initialPlants }: Props) {
  const [plants, setPlants] = useState<TodayPlant[]>(initialPlants);
  const [snoozePlantId, setSnoozePlantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function markWatered(ids: string[]) {
    if (loading) return;
    setLoading(true);

    const removed = plants.filter((p) => ids.includes(p.id));
    setPlants((prev) => prev.filter((p) => !ids.includes(p.id)));

    const label = removed.length === 1 ? removed[0].name : `${removed.length} plants`;
    const toastId = toast.success(`${label} marked as watered`, {
      duration: UNDO_DURATION_MS,
      action: { label: "Undo", onClick: () => void undoWater(ids, removed) },
    });

    try {
      const res = await fetch("/api/plants/water", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plantIds: ids }),
      });
      if (!res.ok) throw new Error("water_failed");
    } catch {
      toast.dismiss(toastId);
      setPlants((prev) => sortPlants([...prev, ...removed]));
      toast.error("Could not mark as watered. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function undoWater(ids: string[], restored: TodayPlant[]) {
    try {
      const res = await fetch("/api/plants/water-undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plantIds: ids }),
      });
      if (!res.ok) throw new Error("undo_failed");
      setPlants((prev) => sortPlants([...prev, ...restored]));
      toast.success("Action undone");
    } catch {
      toast.error("Could not undo. Please refresh the page.");
    }
  }

  async function snooze(plantId: string, days: number) {
    setSnoozePlantId(null);
    if (loading) return;
    setLoading(true);

    const removed = plants.filter((p) => p.id === plantId);
    setPlants((prev) => prev.filter((p) => p.id !== plantId));

    try {
      const res = await fetch("/api/plants/snooze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plantId, days }),
      });
      if (!res.ok) throw new Error("snooze_failed");
      toast.success(`Snoozed for ${days} day${days === 1 ? "" : "s"}`);
    } catch {
      setPlants((prev) => sortPlants([...prev, ...removed]));
      toast.error("Could not snooze. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Toaster richColors position="bottom-right" />

      {plants.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-8 text-center text-sm text-blue-100/60">
          All caught up — nothing needs water today.
        </div>
      ) : (
        <div>
          {plants.length > 1 && (
            <div className="mb-4 flex justify-end">
              <Button
                onClick={() => void markWatered(plants.map((p) => p.id))}
                disabled={loading}
                className="gap-2 rounded-lg border border-white/20 bg-white/10 text-sm text-white hover:bg-white/20"
                variant="ghost"
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Mark all watered
              </Button>
            </div>
          )}

          <ul className="space-y-3">
            {plants.map((plant) => (
              <li
                key={plant.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/10 px-5 py-4 backdrop-blur-xl"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{plant.name}</span>
                  <span className="ml-2 text-sm text-blue-100/60">{plant.locationName}</span>
                  {plant.daysOverdue > 0 && (
                    <span className="ml-2 text-sm text-red-300">{plant.daysOverdue}d overdue</span>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {snoozePlantId === plant.id ? (
                    <div className="flex items-center gap-1">
                      {SNOOZE_OPTIONS.map((days) => (
                        <Button
                          key={days}
                          size="sm"
                          variant="ghost"
                          onClick={() => void snooze(plant.id, days)}
                          disabled={loading}
                          className={cn(
                            "rounded-lg border border-white/20 bg-white/5 text-xs text-white hover:bg-white/20",
                          )}
                        >
                          {days}d
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSnoozePlantId(null);
                        }}
                        className="text-xs text-blue-100/60 hover:text-white"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setSnoozePlantId(plant.id);
                      }}
                      disabled={loading}
                      title="Snooze"
                      className="size-8 text-blue-100/60 hover:text-white"
                    >
                      <Clock className="size-4" />
                    </Button>
                  )}

                  <Button
                    size="sm"
                    onClick={() => void markWatered([plant.id])}
                    disabled={loading}
                    className="gap-1.5 rounded-lg border border-white/20 bg-white/10 text-sm text-white hover:bg-white/20"
                    variant="ghost"
                  >
                    {loading ? <Loader2 className="size-4 animate-spin" /> : <Droplets className="size-4" />}
                    Water
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
