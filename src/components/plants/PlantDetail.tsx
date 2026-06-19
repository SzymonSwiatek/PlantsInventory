import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, ImagePlus, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
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

const UPLOAD_TIMEOUT_MS = 60_000;
const ALLOWED_TYPES = "image/png,image/jpeg,image/webp";

type UploadStatus = "idle" | "uploading" | "uploaded" | "failed";

interface LocationOption {
  id: string;
  name: string;
}

interface MintResponse {
  plantId: string;
  path: string;
  token: string;
  signedUrl: string;
}

interface Props {
  plant: Plant;
  locations: LocationOption[];
  photoUrl: string | null;
}

export default function PlantDetail({ plant, locations, photoUrl }: Props) {
  const [currentLocationId, setCurrentLocationId] = useState(plant.location_id);
  const [currentPhotoUrl, setCurrentPhotoUrl] = useState<string | null>(photoUrl);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fileRef = useRef<File | null>(null);
  const previewRef = useRef<string | null>(null);

  const ai = plant.ai_suggestion as AiSuggestion | null;
  const aiWateringHint =
    ai?.watering_interval_days != null
      ? `every ${ai.watering_interval_days} day${ai.watering_interval_days === 1 ? "" : "s"}`
      : null;

  useEffect(() => {
    return () => {
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current);
      }
    };
  }, []);

  async function runPhotoUpload(file: File) {
    setUploadStatus("uploading");
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, UPLOAD_TIMEOUT_MS);
    try {
      const mintRes = await fetch("/api/plants/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: currentLocationId,
          filename: file.name,
          contentType: file.type,
          plantId: plant.id,
        }),
        signal: controller.signal,
      });
      if (!mintRes.ok) {
        throw new Error(`mint failed: ${mintRes.status.toString()}`);
      }
      const mint = (await mintRes.json()) as MintResponse;

      const putRes = await fetch(mint.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type, "x-upsert": "true" },
        body: file,
        signal: controller.signal,
      });
      if (!putRes.ok) {
        throw new Error(`upload failed: ${putRes.status.toString()}`);
      }

      const patchRes = await fetch(`/api/plants/${plant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_path: mint.path }),
        signal: controller.signal,
      });
      if (!patchRes.ok) {
        throw new Error(`patch failed: ${patchRes.status.toString()}`);
      }

      setCurrentPhotoUrl(previewRef.current);
      setUploadStatus("uploaded");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[PlantDetail] photo upload failed:", err);
      setUploadStatus("failed");
    } finally {
      clearTimeout(timer);
    }
  }

  function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    fileRef.current = file;
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current);
    }
    const url = URL.createObjectURL(file);
    previewRef.current = url;
    void runPhotoUpload(file);
  }

  function retryPhotoUpload() {
    const file = fileRef.current;
    if (file) {
      void runPhotoUpload(file);
    }
  }

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
      <div className="mb-8">
        {currentPhotoUrl ? (
          <img src={currentPhotoUrl} alt={plant.name} className="h-64 w-full rounded-2xl object-cover" />
        ) : (
          <div className="flex h-64 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-4xl text-blue-100/30">
            🌱
          </div>
        )}
        <label
          htmlFor="replace-photo"
          className={cn(
            "mt-2 flex w-fit items-center gap-1.5 text-sm text-blue-300",
            uploadStatus === "uploading" ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:text-blue-200",
          )}
        >
          {uploadStatus === "uploading" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ImagePlus className="size-4" />
          )}
          {uploadStatus === "uploading" ? "Uploading…" : "Replace photo"}
          <input
            id="replace-photo"
            type="file"
            accept={ALLOWED_TYPES}
            className="hidden"
            onChange={handlePhotoChange}
            disabled={uploadStatus === "uploading"}
          />
        </label>
        {uploadStatus === "uploaded" && <p className="mt-1 text-xs text-emerald-400">Photo updated.</p>}
        {uploadStatus === "failed" && (
          <Alert variant="destructive" className="mt-2 py-2">
            <AlertCircle className="size-3" />
            <AlertDescription className="flex items-center gap-2 text-xs">
              Photo upload failed.
              <Button type="button" variant="outline" size="sm" onClick={retryPhotoUpload} className="h-6 px-2 text-xs">
                <RefreshCw className="size-3" /> Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </div>

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
