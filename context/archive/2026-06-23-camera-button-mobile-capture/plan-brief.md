# Add Camera Capture Button for Mobile Photo Input — Plan Brief

> Full plan: `context/changes/camera-button-mobile-capture/plan.md`

## What & Why

Mobile users have no one-tap way to open their device camera when adding or replacing a plant photo — they go through the generic gallery/file picker. This adds a dedicated "Take photo" button that opens the rear camera directly, while keeping the gallery picker intact.

## Starting Point

Photo selection lives in two React islands, each a hidden `<input type="file">` behind a styled label: `AddPlantForm.tsx` (add a plant) and `PlantDetail.tsx` ("Replace photo"). Neither sets the HTML `capture` attribute, so mobile opens the file/gallery picker, never the camera. Both wire to a `handlePhotoChange` handler that operates on the resulting `File`.

## Desired End State

Both flows show two affordances: the existing gallery/file picker and a new "Take photo" button (`capture="environment"`) that opens the rear camera on mobile. On desktop the button degrades to the normal file dialog. A captured photo flows through the existing upload + AI-suggestion pipeline unchanged.

## Key Decisions Made

| Decision              | Choice                              | Why (1 sentence)                                                                 | Source |
| --------------------- | ----------------------------------- | -------------------------------------------------------------------------------- | ------ |
| Affordance pattern    | Separate "Take photo" button        | Adding `capture` to the existing input would force camera and kill gallery choice. | Plan   |
| Scope                 | Both add and replace flows          | Consistent mobile experience wherever a photo is chosen.                          | Plan   |
| Camera facing         | Rear (`capture="environment"`)      | Correct default for photographing a plant in front of you.                       | Plan   |
| Desktop behavior      | Always render, harmless fallback    | Zero conditional logic; browsers ignore `capture` and open the file dialog.      | Plan   |

## Scope

**In scope:** A second hidden capture input + "Take photo" button in `AddPlantForm.tsx` and `PlantDetail.tsx`, sharing the existing change handler.

**Out of scope:** Backend/API/data-model changes; modifying the existing gallery input; responsive hiding; front-camera support; in-app `getUserMedia` camera UI.

## Architecture / Approach

Per flow, add a hidden `<input type="file" accept={ALLOWED_TYPES} capture="environment">` with a unique `id`, fronted by a styled `<label>` button ("Take photo", `Camera` icon), `onChange` pointed at the existing `handlePhotoChange`. PlantDetail's variant mirrors the existing disabled-while-uploading gating.

## Phases at a Glance

| Phase                          | What it delivers                                  | Key risk                                          |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------- |
| 1. Add-plant flow              | Camera button in `AddPlantForm.tsx`               | Duplicate `id`/label wiring breaking the picker   |
| 2. Replace-photo flow          | Camera button in `PlantDetail.tsx` w/ gating      | Upload-in-progress gating drift from sibling input |

**Prerequisites:** None — self-contained front-end change.
**Estimated effort:** ~1 short session across 2 phases.

## Open Risks & Assumptions

- `capture` cannot be exercised in headless Playwright; verification is manual on-device.
- Assumes native OS camera via the `capture` attribute is acceptable (no custom in-app camera UI).

## Success Criteria (Summary)

- On mobile, "Take photo" opens the rear camera and the captured photo flows through upload + AI suggestion (add) / replace (detail).
- The existing gallery picker still works in both flows.
- `npm run lint`, `npm run build`, and `npm run test:run` pass.
