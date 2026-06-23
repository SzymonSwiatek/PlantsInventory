# Add Camera Capture Button for Mobile Photo Input — Implementation Plan

## Overview

Mobile users currently choose a plant photo through a generic file/gallery picker — there is no one-tap way to open the device camera. This change adds a dedicated **"Take photo"** affordance: a second `<input type="file">` carrying `capture="environment"` rendered next to the existing gallery picker, in both photo-selection flows (add a plant, replace a photo). The new input reuses the existing `handlePhotoChange` handler, so the entire downstream pipeline (signed-URL mint → direct Storage PUT → AI suggest) is untouched.

## Current State Analysis

Photo selection happens in two React islands, each using a hidden `<input type="file" accept="image/png,image/jpeg,image/webp">` behind a styled `<label>`:

- `src/components/plants/AddPlantForm.tsx:285` — the primary add-plant flow. The label (`htmlFor="photo"`) wraps the preview/empty-state and the hidden input. `handlePhotoChange` (line 190) reads `e.target.files?.[0]` and kicks off `runUpload` + `runSuggest`.
- `src/components/plants/PlantDetail.tsx:180` — the "Replace photo" affordance. A label (`htmlFor="replace-photo"`) wraps a hidden input with its own `handlePhotoChange`, disabled while `uploadStatus === "uploading"`.

Neither input sets the HTML `capture` attribute, so mobile browsers open the file/gallery picker instead of the camera. Both handlers operate purely on the resulting `File`, so the change is confined to the input affordance.

## Desired End State

In both flows, mobile users see two affordances: the existing picker (gallery/files — preserves the ability to upload an existing photo) **and** a new "Take photo" button that opens the rear camera directly. On desktop the camera button still renders and degrades to the normal file dialog (browsers ignore `capture`). Selecting or capturing a photo behaves identically downstream.

Verify: on a real mobile device, tapping "Take photo" opens the rear camera; the captured image flows through upload + AI suggestion exactly as a gallery pick does. The gallery picker continues to work. `npm run lint`, `npm run build`, and `npm run test:run` pass.

### Key Discoveries:

- Both flows share an identically-named `handlePhotoChange(e)` reading `e.target.files?.[0]` (`AddPlantForm.tsx:190`, `PlantDetail.tsx`) — the new capture input wires to the same handler, no logic change.
- The decision driver: adding `capture` to the *existing* input would force the camera and remove gallery choice. A **separate** capture input avoids that regression (confirmed decision).
- `accept` and `disabled`/`uploading` gating must match the existing input so both affordances stay consistent (PlantDetail disables its input during upload — the capture input must too).
- Two inputs on the same screen need **distinct `id`s** for their `htmlFor` labels (`photo` + e.g. `photo-camera`; `replace-photo` + e.g. `replace-photo-camera`).

## What We're NOT Doing

- No backend, API, data-model, or Storage changes — the pipeline is `File`-agnostic.
- Not modifying the existing gallery/file input's behavior or its `capture` (it stays gallery-capable).
- No responsive/breakpoint hiding — the camera button always renders and degrades gracefully on desktop (confirmed decision).
- No front-camera support — `capture="environment"` (rear) only.
- No in-app camera UI / `getUserMedia` / live preview — relying on the native OS camera via the `capture` attribute.

## Implementation Approach

For each flow, add a second hidden `<input type="file" accept={ALLOWED_TYPES} capture="environment">` with a unique `id`, fronted by its own styled `<label>`/button reading "Take photo" (camera icon — `lucide-react` `Camera`). Point its `onChange` at the existing `handlePhotoChange`. Mirror any `disabled`-while-uploading gating from the sibling input. Keep the two affordances visually grouped so the relationship (snap vs. choose) reads clearly.

## Phase 1: Add-plant flow camera button

### Overview

Add the "Take photo" capture input + button to `AddPlantForm.tsx`, alongside the existing photo picker.

### Changes Required:

#### 1. AddPlantForm photo picker

**File**: `src/components/plants/AddPlantForm.tsx`

**Intent**: Add a second photo-input affordance that opens the rear camera on mobile, without disturbing the existing gallery picker or the preview/empty-state label. Wire it to the existing `handlePhotoChange` so upload + AI suggest run unchanged.

**Contract**: New hidden `<input type="file" id="photo-camera" accept={ALLOWED_TYPES} capture="environment" onChange={handlePhotoChange}>` fronted by a `<label htmlFor="photo-camera">` styled as a secondary button reading "Take photo" with a `Camera` icon (import from `lucide-react`). The existing `id="photo"` input is unchanged. Both affordances grouped within the existing Photo `<div className="space-y-2">` block.

> **Placement (do not nest):** The existing `id="photo"` input is nested *inside* the large `<label htmlFor="photo">` that wraps the preview/empty-state (`AddPlantForm.tsx:269–293`). The new `<label htmlFor="photo-camera">` + input must be a **sibling** of that existing `<label>` — placed after it but still inside the same `<div className="space-y-2">` — **never nested within it**. Nesting would produce invalid nested `<label>` elements and ambiguous click behavior (tapping "Take photo" could also fire the gallery input).

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking + build passes: `npm run build`
- Tests pass: `npm run test:run`

#### Manual Verification:

- On a mobile device, tapping "Take photo" opens the rear camera; capturing a photo populates the preview and triggers upload + AI suggestion.
- The existing picker still opens the gallery/files and is unaffected.
- On desktop, "Take photo" opens the normal file dialog (graceful fallback) with no console errors.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the mobile testing was successful before proceeding to Phase 2.

---

## Phase 2: Replace-photo flow camera button

### Overview

Mirror the Phase 1 affordance in `PlantDetail.tsx`'s "Replace photo" area, including the upload-in-progress gating.

### Changes Required:

#### 1. PlantDetail replace-photo control

**File**: `src/components/plants/PlantDetail.tsx`

**Intent**: Add a "Take photo" capture button next to the existing "Replace photo" picker so users can re-photograph a plant from the camera on mobile. Match the existing input's disabled-while-uploading behavior.

**Contract**: New hidden `<input type="file" id="replace-photo-camera" accept={ALLOWED_TYPES} capture="environment" onChange={handlePhotoChange} disabled={uploadStatus === "uploading"}>` fronted by a `<label htmlFor="replace-photo-camera">` styled consistently with the existing replace-photo label (camera icon, same `cursor-not-allowed`/opacity treatment while uploading). The existing `id="replace-photo"` input is unchanged.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking + build passes: `npm run build`
- Tests pass: `npm run test:run`

#### Manual Verification:

- On a mobile device, the plant detail "Take photo" button opens the rear camera; the captured photo replaces the current one (upload + "Photo updated." confirmation).
- The button is disabled during an in-flight upload, matching the existing picker.
- On desktop, the button degrades to the file dialog with no console errors.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the mobile testing was successful.

---

## Testing Strategy

### Unit Tests:

- No new pure logic is introduced (the change is markup + an attribute), so no new unit tests are required. Existing tests must continue to pass.

### Integration Tests:

- Existing add-plant / replace-photo flows continue to work via the gallery picker.

### Manual Testing Steps:

1. On a mobile device (iOS Safari + Android Chrome if available), open the add-plant form: tap "Take photo" → rear camera opens → capture → preview shows, upload + AI suggestion proceed.
2. On the same form, tap the gallery picker → confirm it still opens the gallery, not the camera.
3. Open a plant's detail view: tap "Take photo" → camera opens → capture → photo replaces and shows "Photo updated."
4. Start an upload and confirm the "Take photo" button is disabled until it finishes (PlantDetail).
5. On desktop, confirm both "Take photo" buttons open the file dialog without errors.

> Note: the `capture` attribute cannot be meaningfully exercised in headless Playwright (no camera device), so this affordance is verified manually on-device rather than via E2E.

## Performance Considerations

None — no new network calls, state, or render paths; one extra hidden input per flow.

## Migration Notes

None — no data or schema changes.

## References

- Existing add-plant photo input: `src/components/plants/AddPlantForm.tsx:285`
- Existing replace-photo input: `src/components/plants/PlantDetail.tsx:180`
- Shared handler pattern: `handlePhotoChange` (`AddPlantForm.tsx:190`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Add-plant flow camera button

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — aae490a
- [x] 1.2 Type checking + build passes: `npm run build` — aae490a
- [x] 1.3 Tests pass: `npm run test:run` — aae490a

#### Manual

- [x] 1.4 Mobile "Take photo" opens rear camera and runs upload + AI suggestion — aae490a
- [x] 1.5 Existing gallery picker still opens gallery, unaffected — aae490a
- [x] 1.6 Desktop "Take photo" degrades to file dialog, no console errors — aae490a

### Phase 2: Replace-photo flow camera button

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — 783e111
- [x] 2.2 Type checking + build passes: `npm run build` — 783e111
- [x] 2.3 Tests pass: `npm run test:run` — 783e111

#### Manual

- [x] 2.4 Mobile "Take photo" opens rear camera and replaces the photo — 783e111
- [x] 2.5 Button disabled during in-flight upload, matching existing picker — 783e111
- [x] 2.6 Desktop "Take photo" degrades to file dialog, no console errors — 783e111
