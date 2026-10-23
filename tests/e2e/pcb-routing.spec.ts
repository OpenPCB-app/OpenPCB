import { expect, test } from "@playwright/test";

/**
 * Smoke E2E for the PCB Route tool. We don't run the full pad-click route here
 * (requires a footprint with pads to be on the board) — that's deferred to a
 * library-fixture-driven test. Instead we verify:
 *  1. The PCB tab loads and shows the Route button.
 *  2. Pressing R exposes route-only controls.
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
  await expect(page.getByRole("button", { name: "45°" })).toBeVisible();

  // Scoped shortcuts belong to the canvas, not the docked toolbar button.
  await page.locator('[aria-label="PCB canvas"]').focus();
  await expect(page.locator('[aria-label="PCB canvas"]')).toBeFocused();
  // ESC exits.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "45°" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Route (R)" })).toBeVisible();

  // R key activates again.
  await page.locator('[aria-label="PCB canvas"]').focus();
  await expect(page.locator('[aria-label="PCB canvas"]')).toBeFocused();
  await page.keyboard.press("r");
  await expect(page.getByRole("button", { name: "45°" })).toBeVisible();

  // Idle route HUD prompt is visible.
  await expect(page.getByText("Route — click a pad to start")).toBeVisible();

  // Auto-finish (pcb.routeAutoFinish, ON in dev builds): Tab without an
  // active session is inert — route mode stays active, nothing crashes.
  // The full Tab → proposal → Enter scenario needs a pad-bearing fixture
  // board (deferred with the other library-fixture-driven route E2Es).
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "45°" })).toBeVisible();
  await expect(page.getByText("Route — click a pad to start")).toBeVisible();
});

test("Tune tool toggles via U key (pcb.lengthTuning)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Design" }).first().click();
  await page.getByRole("tab", { name: "PCB" }).click();
  await expect(
    page.locator('[data-testid="designer-pcb-canvas"]'),
  ).toBeVisible();

  // Tune is hotkey-only: the docked toolbar deliberately carries Route / Board /
  // Add / Export / DRC / View, and Measure, Tune and Bundle stay on their keys.
  // Dev builds have pcb.lengthTuning ON, so U enters the tool.
  // Focus the shortcut owner; the inner renderer's test-id element itself
  // is not focusable.
  await page.locator('[aria-label="PCB canvas"]').focus();
  await expect(page.locator('[aria-label="PCB canvas"]')).toBeFocused();
  await page.keyboard.press("u");
  await expect(
    page.getByText("Tune — click a routed trace to add serpentine length", {
      exact: false,
    }),
  ).toBeVisible();

  // Escape exits back to select (idle session).
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status", { name: "Tune tool" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Route (R)" })).toBeVisible();

  // U key re-enters; the full tune-a-trace flow needs a routed fixture board
  // (deferred with the other library-fixture-driven E2Es).
  await expect(page.locator('[aria-label="PCB canvas"]')).toBeFocused();
  await page.keyboard.press("u");
  await expect(
    page.getByText("Tune — click a routed trace to add serpentine length", {
      exact: false,
    }),
  ).toBeVisible();
});

test("rapid empty-space click does not leave a marquee consuming Escape", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Design" }).first().click();
  await page.getByRole("tab", { name: "PCB" }).click();
  const canvas = page.locator('[data-testid="designer-pcb-canvas"] canvas');
  await expect(canvas).toBeVisible();
  await page.locator('[aria-label="PCB canvas"]').focus();

  // The cursor's layer chip proves the R3F hit plane is handling events.
  await page.keyboard.press("r");
  await expect(page.getByText("Route — click a pad to start")).toBeVisible();
  await expect(async () => {
    await canvas.hover({ position: { x: 40, y: 40 } });
    await expect(page.getByText("Top", { exact: true })).toBeVisible({
      timeout: 250,
    });
  }).toPass({ timeout: 5_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "45°" })).toBeHidden();

  // Both native events run before React can publish the pointer-down session.
  // This exercises the real R3F hit plane without a timing-dependent click.
  await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const pointer = {
      bubbles: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      clientX: rect.left + 40,
      clientY: rect.top + 40,
    };
    element.dispatchEvent(
      new PointerEvent("pointerdown", { ...pointer, buttons: 1 }),
    );
    element.dispatchEvent(
      new PointerEvent("pointerup", { ...pointer, buttons: 0 }),
    );
  });

  await expect(page.locator('[aria-label="PCB canvas"]')).toBeFocused();
  await page.keyboard.press("u");
  const tuneHud = page.getByRole("status", { name: "Tune tool" });
  await expect(tuneHud).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tuneHud).toBeHidden();
});

// The Bundle tool (pcb.bundleRouting) currently has NO activation surface: the
// neutral-EDA toolbar dropped its button and no key is bound to it (B selects
// Bottom Copper, Shift+B toggles the ratsnest). `bundleToolReducer`,
// `BundleHud` and the commit path are all still wired, so this test is kept
// verbatim and skipped rather than deleted — un-skip it as soon as an entry
// point is restored.
test.skip("Bundle tool toggles via toolbar button (pcb.bundleRouting)", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Design" }).first().click();
  await page.getByRole("tab", { name: "PCB" }).click();
  await expect(
    page.locator('[data-testid="designer-pcb-canvas"]'),
  ).toBeVisible();

  const bundleButton = page.getByRole("button", { name: "Bundle" });
  await expect(bundleButton).toBeVisible();

  await expect(async () => {
    await bundleButton.click();
    await expect(bundleButton).toHaveAttribute("aria-pressed", "true", {
      timeout: 1_000,
    });
  }).toPass();
  await expect(
    page.getByText("Bundle — click 2+ pads to collect", { exact: false }),
  ).toBeVisible();

  // Escape exits back to select; the pad-collection flow needs a
  // pad-bearing fixture board (deferred with the other fixture E2Es).
  await page.keyboard.press("Escape");
  await expect(bundleButton).toHaveAttribute("aria-pressed", "false");
});
