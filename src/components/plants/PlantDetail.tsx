import { useState } from "react";
import { AlertCircle, Loader2, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { Plant, AiSuggestion } from "@/types";
import EditableField from "./EditableField";

interface LocationOption {
  id: string;
  name: string;
}

interface Props {
  plant: Plant;
  locations: LocationOption[];
  photoUrl: string | null;
}

export default function PlantDetail({ plant, locations, photoUrl }: Props) {
  const [currentLocationId, setCurrentLocationId] = useState(plant.location_id);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const ai = plant.ai_suggestion as AiSuggestion | null;
  const aiWateringHint =
    ai?.watering_interval_days != null
      ? `every ${ai.watering_interval_days} day${ai.watering_interval_days === 1 ? "" : "s"}`
      : null;

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/plants/${plant.id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error(`delete failed: ${res.status.toString()}`);
      }
      window.location.href = `/locations/${currentLocationId}`;
    } catch {
      setDeleteError("Could not delete the plant. Please try again.");
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      {photoUrl ? (
        <div className="mb-8">
          <img src={photoUrl} alt={plant.name} className="h-64 w-full rounded-2xl object-cover" />
        </div>
      ) : (
        <div className="mb-8 flex h-64 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-4xl text-blue-100/30">
          🌱
        </div>
      )}

      <div className="space-y-5 rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
        <EditableField plantId={plant.id} field="name" label="Name" kind="text" value={plant.name} />
        <EditableField
          plantId={plant.id}
          field="species"
          label="Species"
          kind="text"
          value={plant.species}
          aiHint={ai?.species}
        />
        <EditableField
          plantId={plant.id}
          field="description"
          label="Description"
          kind="multiline"
          value={plant.description}
          aiHint={ai?.description}
        />
        <EditableField
          plantId={plant.id}
          field="sunlight"
          label="Sunlight"
          kind="text"
          value={plant.sunlight}
          aiHint={ai?.sunlight}
        />
        <EditableField
          plantId={plant.id}
          field="watering_interval_days"
          label="Watering interval"
          kind="number"
          value={plant.watering_interval_days}
          aiHint={aiWateringHint}
        />
        <EditableField
          plantId={plant.id}
          field="winterization_cutoff"
          label="Winterization cutoff"
          kind="date"
          value={plant.winterization_cutoff}
          aiHint={ai?.winterization_cutoff}
        />
        <EditableField plantId={plant.id} field="note" label="Note" kind="multiline" value={plant.note} />
        <EditableField
          plantId={plant.id}
          field="location_id"
          label="Location"
          kind="select"
          value={currentLocationId}
          options={locations}
          onSaved={(v) => {
            if (typeof v === "string") setCurrentLocationId(v);
          }}
        />
      </div>

      <div className="flex flex-col items-end gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="text-red-400 hover:bg-red-950/30 hover:text-red-300"
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 size-4" />
                  Delete plant
                </>
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete plant?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove {plant.name} and its photo. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {deleteError && (
          <Alert variant="destructive" className="py-2">
            <AlertCircle className="size-3" />
            <AlertDescription className="text-xs">{deleteError}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
