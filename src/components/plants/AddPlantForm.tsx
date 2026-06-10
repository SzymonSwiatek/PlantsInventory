import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, ImagePlus, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { AiSuggestion } from "@/types";
import { downscaleToBase64 } from "@/lib/image";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

/**
 * The slice's first `fetch`-based island. Orchestrates the three seams stood up
 * in Phases 3–4 into one flow: on photo select it (a) mints a signed URL and
 * PUTs the full-res file DIRECTLY to Storage and (b) in parallel downscales a
 * copy and asks `/api/plants/suggest` for a care profile. The user edits any
 * field, may replace the photo (reusing the same `plantId`/folder), and saves
 * via `/api/plants`. AI absence/timeout degrades to a manual form — the photo is
 * never lost, and Save stays gated until a full-res object is confirmed so a
 * plant is never persisted with a dangling `photo_path`.
 */

interface Props {
  locationId: string;
}

const ALLOWED_TYPES = "image/png,image/jpeg,image/webp";
const SUGGEST_TIMEOUT_MS = 15_000;

type UploadStatus = "idle" | "uploading" | "uploaded" | "failed";
type AiStatus = "idle" | "suggesting" | "done";

interface MintResponse {
  plantId: string;
  path: string;
  token: string;
  signedUrl: string;
}

interface SuggestResponse {
  status: "ok" | "ai_unavailable" | "error";
  suggestion?: AiSuggestion;
}

export default function AddPlantForm({ locationId }: Props) {
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [aiStatus, setAiStatus] = useState<AiStatus>("idle");
  const [aiUnavailable, setAiUnavailable] = useState(false);

  // Verbatim `/suggest` snapshot, posted back unchanged so the adoption/
  // acceptance metric stays trustworthy — distinct from the editable fields.
  const [snapshot, setSnapshot] = useState<AiSuggestion | null>(null);

  const [name, setName] = useState("");
  const [species, setSpecies] = useState("");
  const [description, setDescription] = useState("");
  const [sunlight, setSunlight] = useState("");
  const [wateringDays, setWateringDays] = useState("");
  const [winterizationCutoff, setWinterizationCutoff] = useState("");
  const [noWinterization, setNoWinterization] = useState(false);

  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const plantIdRef = useRef<string | null>(null);
  const fileRef = useRef<File | null>(null);
  const previewRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current);
      }
    };
  }, []);

  function setPreview(file: File) {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current);
    }
    const url = URL.createObjectURL(file);
    previewRef.current = url;
    setPhotoPreview(url);
  }

  async function runUpload(file: File) {
    setUploadStatus("uploading");
    setPhotoPath(null);
    try {
      const mintRes = await fetch("/api/plants/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          filename: file.name,
          contentType: file.type,
          // Reuse the id on a retake so the same folder is overwritten in place.
          plantId: plantIdRef.current ?? undefined,
        }),
      });
      if (!mintRes.ok) {
        throw new Error(`mint failed: ${mintRes.status.toString()}`);
      }
      const mint = (await mintRes.json()) as MintResponse;
      plantIdRef.current = mint.plantId;

      // Raw PUT straight to Storage — the bytes never transit the Worker. The
      // signed URL is absolute and carries the token; `x-upsert` lets a retake
      // overwrite the prior object at the same key.
      const putRes = await fetch(mint.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type, "x-upsert": "true" },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`upload failed: ${putRes.status.toString()}`);
      }
      setPhotoPath(mint.path);
      setUploadStatus("uploaded");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[AddPlantForm] photo upload failed:", err);
      setUploadStatus("failed");
    }
  }

  async function runSuggest(file: File) {
    setAiStatus("suggesting");
    setAiUnavailable(false);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, SUGGEST_TIMEOUT_MS);
    try {
      const { base64, mimeType } = await downscaleToBase64(file);
      const res = await fetch("/api/plants/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
        signal: controller.signal,
      });
      const data = (await res.json()) as SuggestResponse;
      if (data.status === "ok" && data.suggestion) {
        applySuggestion(data.suggestion);
      } else {
        setAiUnavailable(true);
      }
    } catch {
      // Timeout, transport failure, or unparseable body → manual fallback.
      setAiUnavailable(true);
    } finally {
      clearTimeout(timer);
      setAiStatus("done");
    }
  }

  function applySuggestion(s: AiSuggestion) {
    setSnapshot(s);
    setName(s.species ?? "");
    setSpecies(s.species ?? "");
    setDescription(s.description ?? "");
    setSunlight(s.sunlight ?? "");
    setWateringDays(s.watering_interval_days !== null ? String(s.watering_interval_days) : "");
    setWinterizationCutoff(s.winterization_cutoff ?? "");
    setNoWinterization(false);
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    fileRef.current = file;
    setSaveError(null);
    setPreview(file);
    void runUpload(file);
    void runSuggest(file);
  }

  function retryUpload() {
    const file = fileRef.current;
    if (file) {
      void runUpload(file);
    }
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaveError(null);

    const trimmedName = name.trim();
    if (trimmedName.length < 1 || trimmedName.length > 100) {
      setSaveError("Give the plant a name (1–100 characters).");
      return;
    }
    if (uploadStatus !== "uploaded" || !photoPath || !plantIdRef.current) {
      setSaveError("The photo hasn't finished uploading yet.");
      return;
    }
    const watering = wateringDays.trim();
    if (watering !== "" && !/^\d+$/.test(watering)) {
      setSaveError("Watering interval must be a whole number of days.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/plants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: plantIdRef.current,
          locationId,
          photoPath,
          name: trimmedName,
          species: species.trim() || null,
          description: description.trim() || null,
          sunlight: sunlight.trim() || null,
          watering_interval_days: watering === "" ? null : Number(watering),
          winterization_cutoff: noWinterization ? null : winterizationCutoff.trim() || null,
          // The verbatim snapshot (or null on a manual create) — never the edits.
          aiSuggestion: snapshot,
        }),
      });
      if (res.status === 201) {
        window.location.href = `/locations/${locationId}`;
        return;
      }
      setSaveError("Could not save the plant. Please check the fields and try again.");
      setSaving(false);
    } catch {
      setSaveError("Could not reach the server. Please try again.");
      setSaving(false);
    }
  }

  const hasPhoto = photoPreview !== null;
  const canSave = uploadStatus === "uploaded" && !saving;

  return (
    <Card className="shadow-xl">
      <CardContent>
        <form className="space-y-6" onSubmit={handleSubmit} noValidate>
          {/* Photo picker / preview */}
          <div className="space-y-2">
            <Label htmlFor="photo">Photo</Label>
            <label
              htmlFor="photo"
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm transition-colors",
                "border-input text-muted-foreground hover:bg-accent/50",
              )}
            >
              {hasPhoto ? (
                <img src={photoPreview} alt="Selected plant" className="h-40 w-40 rounded-lg object-cover shadow-sm" />
              ) : (
                <>
                  <ImagePlus className="size-6" />
                  <span>Tap to upload a photo (PNG, JPEG, or WebP)</span>
                </>
              )}
              <span className="text-primary text-xs font-medium">{hasPhoto ? "Replace photo" : ""}</span>
              <input
                id="photo"
                name="photo"
                type="file"
                accept={ALLOWED_TYPES}
                className="hidden"
                onChange={handlePhotoChange}
              />
            </label>

            {uploadStatus === "uploading" && (
              <p className="text-muted-foreground flex items-center gap-2 text-xs">
                <Loader2 className="size-3 animate-spin" /> Uploading photo…
              </p>
            )}
            {uploadStatus === "uploaded" && <p className="text-xs text-emerald-600">Photo uploaded.</p>}
          </div>

          {uploadStatus === "failed" && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Photo upload failed</AlertTitle>
              <AlertDescription>
                We were unable to store the photo, so the plant cannot be saved yet.
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={retryUpload}>
                  <RefreshCw className="size-3" /> Retry upload
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* AI status */}
          {aiStatus === "suggesting" && (
            <div className="space-y-2" aria-live="polite">
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <Sparkles className="size-4 animate-pulse" /> Identifying your plant…
              </p>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}
          {aiUnavailable && aiStatus === "done" && (
            <Alert>
              <AlertCircle />
              <AlertTitle>Could not reach the AI</AlertTitle>
              <AlertDescription>Your photo is saved — just fill in the details below yourself.</AlertDescription>
            </Alert>
          )}

          {/* Editable fields — shown once a photo is chosen */}
          {hasPhoto && aiStatus !== "suggesting" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  value={name}
                  maxLength={100}
                  required
                  onChange={(e) => {
                    setName(e.target.value);
                  }}
                  placeholder="e.g. Living-room monstera"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="species">Species</Label>
                <Input
                  id="species"
                  value={species}
                  onChange={(e) => {
                    setSpecies(e.target.value);
                  }}
                  placeholder="e.g. Monstera deliciosa"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                  }}
                  placeholder="A short note about the plant"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sunlight">Sunlight</Label>
                <Input
                  id="sunlight"
                  value={sunlight}
                  onChange={(e) => {
                    setSunlight(e.target.value);
                  }}
                  placeholder="e.g. Bright, indirect light"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="watering">Watering interval (days)</Label>
                <Input
                  id="watering"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={wateringDays}
                  onChange={(e) => {
                    setWateringDays(e.target.value);
                  }}
                  placeholder="e.g. 7"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="winterization">Bring indoors by</Label>
                <Input
                  id="winterization"
                  type="date"
                  value={winterizationCutoff}
                  disabled={noWinterization}
                  onChange={(e) => {
                    setWinterizationCutoff(e.target.value);
                  }}
                />
                <Label htmlFor="no-winterization" className="text-muted-foreground font-normal">
                  <Checkbox
                    id="no-winterization"
                    checked={noWinterization}
                    onCheckedChange={(v) => {
                      setNoWinterization(v === true);
                    }}
                  />
                  No winterization needed
                </Label>
              </div>

              {saveError && (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertDescription>{saveError}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={!canSave}>
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Saving…
                  </>
                ) : (
                  "Save plant"
                )}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
