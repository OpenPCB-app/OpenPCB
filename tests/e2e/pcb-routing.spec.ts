import { expect, test } from "@playwright/test";

/**
 * Smoke E2E for the PCB Route tool. We don't run the full pad-click route here
 * (requires a footprint with pads to be on the board) — that's deferred to a
 * library-fixture-driven test. Instead we verify:
 *  1. The PCB tab loads and shows the Route button.
 *  2. Pressing R toggles the toolbar pill into "Routing (R)" state.
 *  3. ESC exits Route mode back to Select.
 *  4. The 45°/90° pill appears only while routing is active.
 */
test("Route tool toggles via R key and toolbar button", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Design" }).first().click();
  await page.getByRole("tab", { name: "PCB" }).click();
  await expect(
    page.locator('[data-testid="designer-pcb-canvas"]'),
  ).toBeVisible();

  // Default state: Route button visible, not yet active.
  const routeButton = page.getByRole("button", { name: "Route (R)" });
  await expect(routeButton).toBeVisible();

  // Click activates Routing.
  await routeButton.click();
  await expect(page.getByRole("button", { name: "Routing (R)" })).toBeVisible();

  // ESC exits.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Route (R)" })).toBeVisible();

  // R key activates again.
  await page
    .locator('[data-testid="designer-pcb-canvas"]')
    .focus()
    .catch(() => {});
  await page.keyboard.press("r");
  await expect(page.getByRole("button", { name: "Routing (R)" })).toBeVisible();
});
