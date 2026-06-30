import { readFileSync } from "node:fs";

import { test, expect } from "@playwright/test";

// Provenance: test-plan.md Risk #1 (AI-outage resilience), §3 Phase 3; change
// `ai-outage-resilience` plan Phase 2. Seed: references/seed-test-pattern.md.
//
// Proves the CLIENT-RENDERED manual fallback that the Phase 1 integration suite
// cannot reach (it lives only in the React island): with AI forced unavailable
// (the webServer launches with `AI_API_KEY` unset), selecting a photo must
// surface the "create manually" banner, KEEP the photo, and still allow a
// successful manual save + redirect. Accessibility-first locators, wait-for-
// state (never a timeout), unique data — per the seed exemplar.

interface E2eContext {
  userId: string;
  locationId: string;
}

// Banner copy is asserted verbatim from AddPlantForm.tsx — the degrade signal.
const FALLBACK_BANNER = "INTENTIONAL_BREAK_p3-gate — this text never appears";

test("add-plant degrades to manual entry with the photo preserved when AI is unavailable", async ({ page }) => {
  // Seeded by global-setup (read at test time — the file only exists after setup).
  const { locationId } = JSON.parse(readFileSync("playwright/.auth/context.json", "utf8")) as E2eContext;
  const uniqueName = `Outage Fern ${Date.now().toString()}`;

  // Reach the real add-plant page as the seeded, authenticated user.
  await page.goto(`/locations/${locationId}/plants/new`);
  await expect(page.getByRole("heading", { name: "Add a plant" })).toBeVisible();

  // Selecting a photo kicks off parallel upload + AI suggest.
  await page.getByLabel("Photo", { exact: true }).setInputFiles("tests/e2e/fixtures/plant.png");

  // Degrade signal: AI is down, so the manual-fallback banner appears.
  await expect(page.getByText(FALLBACK_BANNER)).toBeVisible();

  // Photo preserved: the preview thumbnail is present despite the AI outage.
  await expect(page.getByRole("img", { name: "Selected plant" })).toBeVisible();

  // Fill the editable fields manually (AI provided nothing).
  await page.getByLabel("Name").fill(uniqueName);
  await page.getByLabel("Species").fill("Nephrolepis exaltata");

  // Save is gated on the upload finishing — wait for the button to enable, then save.
  const save = page.getByRole("button", { name: "Save plant" });
  await expect(save).toBeEnabled();
  await save.click();

  // Manual save succeeded despite AI being down → redirect to the location page.
  await page.waitForURL(`**/locations/${locationId}`);
  await expect(page).toHaveURL(new RegExp(`/locations/${locationId}$`));

  // Cleanup of the created plant + user is handled by global-teardown (cascade).
});
