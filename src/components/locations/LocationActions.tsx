import { useState } from "react";
import { AlertCircle, Check, Loader2, Pencil, Trash2, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";

interface Props {
  id: string;
  name: string;
  plantCount: number;
}

export default function LocationActions({ id, name, plantCount }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [nameValue, setNameValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRenameSubmit() {
    const trimmed = nameValue.trim();
    if (trimmed.length < 1 || trimmed.length > 100) {
      setError("Name must be between 1 and 100 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/locations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        throw new Error(`rename failed: ${res.status.toString()}`);
      }
      window.location.reload();
    } catch {
      setError("Could not rename location. Please try again.");
      setSaving(false);
    }
  }

  function handleRenameCancel() {
    setNameValue(name);
    setRenaming(false);
    setError(null);
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/locations/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error(`delete failed: ${res.status.toString()}`);
      }
      window.location.reload();
    } catch {
      setError("Could not delete location. Please try again.");
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        {renaming ? (
          <>
            <Input
              value={nameValue}
              onChange={(e) => {
                setNameValue(e.target.value);
              }}
              maxLength={100}
              className="h-8 w-40 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRenameSubmit();
                if (e.key === "Escape") handleRenameCancel();
              }}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={() => void handleRenameSubmit()}
              disabled={saving}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={handleRenameCancel}
              disabled={saving}
            >
              <X className="size-4" />
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={() => {
              setRenaming(true);
              setError(null);
            }}
          >
            <Pencil className="size-4" />
          </Button>
        )}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" size="icon" variant="ghost" className="size-8" disabled={deleting}>
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete location?</AlertDialogTitle>
              <AlertDialogDescription>
                {plantCount > 0
                  ? `This location contains ${plantCount === 1 ? "1 plant" : `${plantCount} plants`} and their photos. All of them will be permanently removed. This action cannot be undone.`
                  : "This location is empty. It will be permanently removed. This action cannot be undone."}
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
      </div>

      {error && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="size-3" />
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
