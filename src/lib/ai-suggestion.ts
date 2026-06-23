export type FieldKind = "text" | "multiline" | "number" | "date" | "select";

/**
 * Decide whether a field's current value still equals its original AI
 * suggestion, normalizing per field kind so the UI can show the "AI suggested"
 * indicator only on fields the user hasn't edited away.
 *
 * Returns `false` when there is no AI value to match (`null` / `undefined` /
 * `""`). Normalization by kind:
 * - `number`  → numeric equality (`7` matches `"7"`).
 * - `date`    → both sides reduced to `YYYY-MM-DD` via a string slice, never
 *               `new Date(...)`, which would TZ-shift a bare date.
 * - `text` / `multiline` → trimmed string equality.
 * - `select`  → always `false` (no AI suggestion applies to selects).
 */
export function aiValueUnchanged(
  kind: FieldKind,
  value: string | number | null,
  aiValue: string | number | null,
): boolean {
  if (aiValue == null || aiValue === "") return false;
  if (kind === "select") return false;
  if (value == null || value === "") return false;

  switch (kind) {
    case "number":
      return Number(value) === Number(aiValue);
    case "date":
      return String(value).slice(0, 10) === String(aiValue).slice(0, 10);
    case "text":
    case "multiline":
      return String(value).trim() === String(aiValue).trim();
  }
}
