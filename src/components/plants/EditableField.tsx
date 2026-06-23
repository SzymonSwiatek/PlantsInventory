import { useState } from "react";
import { AlertCircle, Check, Loader2, Pencil, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NumberStepper } from "@/components/ui/number-stepper";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { aiValueUnchanged, type FieldKind } from "@/lib/ai-suggestion";

interface Option {
  id: string;
  name: string;
}

interface Props {
  plantId: string;
  field: string;
  label: string;
  kind: FieldKind;
  value: string | number | null;
  options?: Option[];
  aiHint?: string | null;
  aiValue?: string | number | null;
  onSaved?: (newValue: string | number | null) => void;
}

function formatDisplay(kind: FieldKind, value: string | number | null, options?: Option[]): string | null {
  if (kind === "number") {
    if (value === null) return null;
    const n = Number(value);
    return `Every ${n} day${n === 1 ? "" : "s"}`;
  }
  if (kind === "select") {
    if (!value || !options) return null;
    return options.find((o) => o.id === String(value))?.name ?? null;
  }
  if (value === null || value === "") return null;
  return String(value);
}

export default function EditableField({
  plantId,
  field,
  label,
  kind,
  value,
  options,
  aiHint,
  aiValue,
  onSaved,
}: Props) {
  const [localValue, setLocalValue] = useState<string | number | null>(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [noWinter, setNoWinter] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    if (kind === "date") {
      const v = localValue ? String(localValue) : "";
      setDraft(v);
      setNoWinter(!v);
    } else {
      setDraft(localValue !== null ? String(localValue) : "");
    }
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  async function handleSave() {
    let payload: string | number | null;

    if (kind === "number") {
      const trimmed = draft.trim();
      if (trimmed === "") {
        payload = null;
      } else {
        const n = Number(trimmed);
        if (!Number.isInteger(n) || n < 1) {
          setError("Enter a whole number of days (1 or more), or leave empty.");
          return;
        }
        payload = n;
      }
    } else if (kind === "date") {
      payload = noWinter ? null : draft.trim() || null;
    } else if (kind === "select") {
      payload = draft || null;
    } else {
      payload = draft.trim() || null;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/plants/${plantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: payload }),
      });
      if (!res.ok) {
        throw new Error(`patch failed: ${res.status.toString()}`);
      }
      setLocalValue(payload);
      onSaved?.(payload);
      setEditing(false);
      setSaving(false);
    } catch {
      setError("Could not save. Please try again.");
      setSaving(false);
    }
  }

  const displayValue = formatDisplay(kind, localValue, options);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs font-medium tracking-wider text-blue-100/50 uppercase">{label}</p>
        {!editing && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 text-blue-100/50 hover:text-blue-100"
            onClick={startEdit}
          >
            <Pencil className="size-3" />
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          {kind === "text" && (
            <Input
              value={draft}
              autoFocus
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
                if (e.key === "Escape") cancelEdit();
              }}
              className="border-white/20 bg-white/10 text-white placeholder:text-blue-100/40"
            />
          )}
          {kind === "multiline" && (
            <Textarea
              value={draft}
              autoFocus
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelEdit();
              }}
              className="border-white/20 bg-white/10 text-white placeholder:text-blue-100/40"
            />
          )}
          {kind === "number" && (
            <NumberStepper
              value={draft}
              onChange={setDraft}
              autoFocus
              inputClassName="border-white/20 bg-white/10 text-white placeholder:text-blue-100/40"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
                if (e.key === "Escape") cancelEdit();
              }}
            />
          )}
          {kind === "date" && (
            <div className="space-y-2">
              <Input
                type="date"
                value={draft}
                disabled={noWinter}
                onChange={(e) => {
                  setDraft(e.target.value);
                }}
                className="border-white/20 bg-white/10 text-white disabled:opacity-50"
              />
              <Label className="flex cursor-pointer items-center gap-2 text-sm font-normal text-blue-100/70">
                <Checkbox
                  checked={noWinter}
                  onCheckedChange={(v) => {
                    setNoWinter(v === true);
                  }}
                />
                No winterization needed
              </Label>
            </div>
          )}
          {kind === "select" && options && (
            <select
              value={draft}
              autoFocus
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              className="w-full rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:ring-2 focus:ring-white/30 focus:outline-none"
            >
              {options.map((o) => (
                <option key={o.id} value={o.id} className="bg-slate-900 text-white">
                  {o.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 text-blue-100/70 hover:text-blue-100"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 text-blue-100/70 hover:text-blue-100"
              onClick={cancelEdit}
              disabled={saving}
            >
              <X className="size-4" />
            </Button>
          </div>

          {error && (
            <Alert variant="destructive" className="py-2">
              <AlertCircle className="size-3" />
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}
        </div>
      ) : (
        <div>
          {kind === "date" && !localValue ? (
            <p className="text-sm text-blue-100/40 italic">No winterization needed</p>
          ) : displayValue ? (
            <p className={cn("font-medium", kind === "multiline" && "text-sm leading-relaxed whitespace-pre-wrap")}>
              {displayValue}
            </p>
          ) : (
            <p className="text-blue-100/40 italic">—</p>
          )}
          {aiHint && aiValueUnchanged(kind, localValue, aiValue ?? null) && (
            <span className="mt-1 inline-block rounded-full border border-blue-300/20 bg-blue-300/10 px-2 py-0.5 text-xs text-blue-300/60">
              AI suggested
            </span>
          )}
        </div>
      )}
    </div>
  );
}
