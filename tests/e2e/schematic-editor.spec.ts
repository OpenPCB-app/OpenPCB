import { expect, test, type Locator, type Page } from "@playwright/test";

async function gotoHarness(page: Page) {
  await page.goto("/?e2e=schematic");
  await expect(page.getByText("Schematic E2E")).toBeVisible();
  await expect(page.getByTestId("e2e-symbols")).toHaveText("2");
  await expect(page.getByTestId("e2e-wires")).toHaveText("0");
}

async function gotoDragWiringHarness(
  page: Page,
  theme: "light" | "dark" | "system" = "system",
) {
  await page.goto(`/?e2e=schematic&fixture=drag-wiring`);
  if (theme !== "system") {
    await page.evaluate((t) => localStorage.setItem("theme", t), theme);
    await page.reload();
  }
  await expect(page.getByText("Schematic E2E")).toBeVisible();
  await expect(page.getByTestId("e2e-symbols")).toHaveText("3");
  await expect(page.getByTestId("e2e-wires")).toHaveText("2");
}

async function dragPaletteItemToCanvas(
  page: Page,
  label: string,
  position: { x: number; y: number },
  dropTarget: Locator = page.getByTestId("schematic-canvas"),
) {
  const source = page.getByRole("button", { name: label });
  const canvasBox = await page.getByTestId("schematic-canvas").boundingBox();
  if (!canvasBox) {
    throw new Error("missing canvas bounds");
  }

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent("dragstart", { dataTransfer });
  await dropTarget.dispatchEvent("dragover", {
    dataTransfer,
    clientX: canvasBox.x + position.x,
    clientY: canvasBox.y + position.y,
  });
  await dropTarget.dispatchEvent("drop", {
    dataTransfer,
    clientX: canvasBox.x + position.x,
    clientY: canvasBox.y + position.y,
  });
  await source.dispatchEvent("dragend", { dataTransfer });
}

test.describe("schematic editor flows", () => {
  test("drag placement commits one snapped symbol", async ({ page }) => {
    await gotoHarness(page);

    await dragPaletteItemToCanvas(page, "Resistor", { x: 420, y: 260 });

    await expect(page.getByTestId("e2e-symbols")).toHaveText("3");
    await expect(page.getByTestId("e2e-session")).toHaveText("none");
    await expect(page.getByTestId("e2e-selected")).not.toHaveText("none");
  });

  test("connector wiring commits one orthogonal wire", async ({ page }) => {
    await gotoHarness(page);

    const pin2Text = await page.getByTestId("e2e-pin2").textContent();
    const [pin2x, pin2y] = pin2Text!.split(",").map(Number);
    const pin3Text = await page.getByTestId("e2e-pin3").textContent();
    const [pin3x, pin3y] = pin3Text!.split(",").map(Number);

    const canvas = page.getByTestId("schematic-canvas");
    await canvas.click({ position: { x: pin2x, y: pin2y } });
    await expect(page.getByTestId("e2e-session")).toHaveText(
      "wire:pin-2:pending",
    );

    await canvas.click({ position: { x: pin3x, y: pin3y } });

    await expect(page.getByTestId("e2e-wires")).toHaveText("1");
    await expect(page.getByTestId("e2e-session")).toHaveText("none");
  });

  test("invalid drop outside the canvas does not commit placement", async ({
    page,
  }) => {
    await gotoHarness(page);

    await dragPaletteItemToCanvas(
      page,
      "Resistor",
      { x: 420, y: 260 },
      page.getByTestId("e2e-session"),
    );

    await expect(page.getByTestId("e2e-symbols")).toHaveText("2");
    await expect(page.getByTestId("e2e-session")).toHaveText("none");
  });

  test("empty-canvas wire finish does not commit and keeps session active", async ({
    page,
  }) => {
    await gotoHarness(page);

    const pin2Text = await page.getByTestId("e2e-pin2").textContent();
    const [pin2x, pin2y] = pin2Text!.split(",").map(Number);

    const canvas = page.getByTestId("schematic-canvas");
    await canvas.click({ position: { x: pin2x, y: pin2y } });
    await canvas.click({ position: { x: pin2x + 220, y: pin2y + 210 } });

    await expect(page.getByTestId("e2e-wires")).toHaveText("0");
    await expect(page.getByTestId("e2e-session")).toHaveText(
      "wire:pin-2:pending",
    );
  });

  test("Escape cancels an active placement session", async ({ page }) => {
    await gotoHarness(page);

    await page.getByRole("button", { name: "Resistor" }).click();
    await expect(page.getByTestId("e2e-session")).toHaveText(/placement:.+/);

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("e2e-symbols")).toHaveText("2");
    await expect(page.getByTestId("e2e-session")).toHaveText("none");
  });

  test("symbol selection shows and dismisses the properties popover", async ({
    page,
  }) => {
    await gotoHarness(page);

    const sym1Text = await page.getByTestId("e2e-symbol1").textContent();
    const [sym1x, sym1y] = sym1Text!.split(",").map(Number);

    const canvas = page.getByTestId("schematic-canvas");
    await canvas.click({ position: { x: sym1x, y: sym1y } });

    const popover = page.getByRole("dialog", { name: "Symbol properties" });
    await expect(popover).toBeVisible();
    await expect(page.getByTestId("e2e-popover")).toHaveText("symbol-1");

    await page
      .getByTestId("floating-properties-backdrop")
      .click({ position: { x: 10, y: 10 }, force: true });
    await expect(popover).toBeHidden();
    await expect(page.getByTestId("e2e-selected")).toHaveText("symbol-1");
  });
});

test.describe("drag rewiring", () => {
  test("single-symbol drag keeps attached wire connected", async ({ page }) => {
    await gotoDragWiringHarness(page);

    const sym1Text = await page.getByTestId("e2e-symbol1").textContent();
    const [sym1x, sym1y] = sym1Text!.split(",").map(Number);
    const canvas = page.getByTestId("schematic-canvas");
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error("no bounds");

    // Drag symbol-1 down by 100 screen pixels (= ~1270000 nm at zoom 1/12700)
    await canvas.dispatchEvent("mousemove", {
      clientX: canvasBox.x + sym1x,
      clientY: canvasBox.y + sym1y,
      button: 0,
      buttons: 0,
    });
    await canvas.dispatchEvent("mousedown", {
      clientX: canvasBox.x + sym1x,
      clientY: canvasBox.y + sym1y,
      button: 0,
      buttons: 1,
    });
    await page.waitForTimeout(50);

    // Break threshold
    await canvas.dispatchEvent("mousemove", {
      clientX: canvasBox.x + sym1x,
      clientY: canvasBox.y + sym1y + 10,
      button: 0,
      buttons: 1,
    });
    await page.waitForTimeout(50);

    // Drag destination
    await canvas.dispatchEvent("mousemove", {
      clientX: canvasBox.x + sym1x,
      clientY: canvasBox.y + sym1y + 100,
      button: 0,
      buttons: 1,
    });
    await page.waitForTimeout(50);

    await canvas.dispatchEvent("mouseup", {
      clientX: canvasBox.x + sym1x,
      clientY: canvasBox.y + sym1y + 100,
      button: 0,
      buttons: 0,
    });

    // After drag, wire-1 should have moved its first point (source endpoint)
    // Original: wire-1:1270000,0|1905000,0|1905000,1270000
    // After moving symbol-1 down: wire-1:1270000,1270000|1905000,0|1905000,1270000
    const expectedPoints =
      "wire-1:1270000,1270000|1905000,0|1905000,1270000;wire-2:1905000,0|2857500,0|3810000,0";

    await expect(page.getByTestId("e2e-wire-points")).toHaveText(
      expectedPoints,
    );
    await expect(page.getByTestId("e2e-session")).toHaveText("none");
  });

  test("connected pins render green outline", async ({ page }) => {
    await gotoDragWiringHarness(page, "light");

    // Verify connected pins are detected from wire endpoints
    const connectedPins = await page
      .getByTestId("e2e-connected-pins")
      .textContent();
    expect(connectedPins).toBe('["pin-2","pin-3","pin-4","pin-5"]');

    // Take screenshot in light theme
    await expect(page.getByTestId("schematic-canvas")).toHaveScreenshot(
      "connected-pins-light.png",
    );

    // Switch to dark theme
    await gotoDragWiringHarness(page, "dark");
    await expect(page.getByTestId("schematic-canvas")).toHaveScreenshot(
      "connected-pins-dark.png",
    );
  });
});
