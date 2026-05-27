import { expect, test } from "@playwright/test";

/**
 * Layer/flip semantics in OpenPCB:
 *  - Switching active layer (sidebar click / T / B / 1 / 2) does NOT flip the
 *    view. This direction stays orthogonal.
 *  - Shift+F / "Flip view" flips the view AND syncs the active copper layer
 *    to the side now facing the user (bottom → B.Cu, top → F.Cu).
 *  - viewSide persists across reload via localStorage.
 *  - Per-placement "Flip part" stays disabled when nothing is selected.
 */

const CANVAS = '[data-testid="designer-pcb-canvas"]';
const FLIP_VIEW_BUTTON = '[data-testid="pcb-flip-view-button"]';
const FLIP_BADGE = '[data-testid="pcb-viewing-bottom-badge"]';
const FLIP_TINT = '[data-testid="pcb-flip-tint"]';

async function openPcb(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "New Design" }).first().click();
  await page.getByRole("tab", { name: "PCB" }).click();
  await expect(page.locator(CANVAS)).toBeVisible();
}

function layerRow(page: import("@playwright/test").Page, layer: "F.Cu" | "B.Cu") {
  return page.getByTestId(`pcb-layer-row-${layer}`);
}

test("active layer switch does not flip the view", async ({ page }) => {
  await openPcb(page);
  await expect(page.locator(FLIP_BADGE)).toHaveCount(0);
  await expect(page.locator(FLIP_TINT)).toHaveCount(0);

  // Toolbar layer button toggles F.Cu ↔ B.Cu (label is the single source of
  // truth). View overlays must stay absent.
  await layerRow(page, "B.Cu").click();
  await expect(page.locator(FLIP_BADGE)).toHaveCount(0);
  await expect(page.locator(FLIP_TINT)).toHaveCount(0);
});

test("Shift+F flips view and syncs active layer to the visible side", async ({
  page,
}) => {
  await openPcb(page);
  await page.locator(CANVAS).click();

  await page.keyboard.press("Shift+F");

  await expect(page.locator(FLIP_BADGE)).toBeVisible();
  await expect(page.locator(FLIP_TINT)).toBeVisible();
  await expect(page.locator(FLIP_VIEW_BUTTON)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Shift+F again returns to top view and F.Cu active.
  await page.keyboard.press("Shift+F");
  await expect(page.locator(FLIP_BADGE)).toHaveCount(0);
});

test("T and B keys switch active layer, view stays put", async ({ page }) => {
  await openPcb(page);
  await page.locator(CANVAS).click();

  await page.keyboard.press("b");
  await expect(page.locator(FLIP_BADGE)).toHaveCount(0);

  await page.keyboard.press("t");
  await expect(page.locator(FLIP_BADGE)).toHaveCount(0);
});

test("viewSide persists across reload", async ({ page }) => {
  await openPcb(page);
  await page.locator(CANVAS).click();
  await page.keyboard.press("Shift+F");
  await expect(page.locator(FLIP_BADGE)).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: "PCB" }).click();
  await expect(page.locator(CANVAS)).toBeVisible();
  await expect(page.locator(FLIP_BADGE)).toBeVisible();
});

test('"Flip part" is disabled when no placement is selected', async ({
  page,
}) => {
  await openPcb(page);
  const flipPart = page.getByRole("button", { name: /^Flip part$/ });
  await expect(flipPart).toBeVisible();
  await expect(flipPart).toBeDisabled();
});
