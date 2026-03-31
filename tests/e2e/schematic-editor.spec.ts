import { expect, test, type Locator, type Page } from "@playwright/test";

async function gotoHarness(page: Page) {
  await page.goto("/?e2e=schematic");
  await expect(page.getByText("Schematic E2E")).toBeVisible();
  await expect(page.getByTestId("e2e-symbols")).toHaveText("2");
  await expect(page.getByTestId("e2e-wires")).toHaveText("0");
}

async function dragPaletteItemToCanvas(
  page: Page,
  label: string,
  position: { x: number; y: number },
  dropTarget: Locator = page.getByTestId("schematic-canvas-surface"),
) {
  const source = page.getByRole("button", { name: label });
  const surfaceBox = await page.getByTestId("schematic-canvas-surface").boundingBox();
  if (!surfaceBox) {
    throw new Error("missing canvas surface bounds");
  }

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent("dragstart", { dataTransfer });
  await dropTarget.dispatchEvent("dragover", {
    dataTransfer,
    clientX: surfaceBox.x + position.x,
    clientY: surfaceBox.y + position.y,
  });
  await dropTarget.dispatchEvent("drop", {
    dataTransfer,
    clientX: surfaceBox.x + position.x,
    clientY: surfaceBox.y + position.y,
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

    const canvas = page.getByTestId("schematic-canvas");
    await canvas.click({ position: { x: 300, y: 150 } });
    await expect(page.getByTestId("e2e-session")).toHaveText("wire:pin-2:pending");

    await canvas.click({ position: { x: 350, y: 250 } });

    await expect(page.getByTestId("e2e-wires")).toHaveText("1");
    await expect(page.getByTestId("e2e-session")).toHaveText("none");
  });

  test("invalid drop outside the canvas does not commit placement", async ({ page }) => {
    await gotoHarness(page);

    await dragPaletteItemToCanvas(
      page,
      "Capacitor",
      { x: 420, y: 260 },
      page.getByTestId("e2e-session"),
    );

    await expect(page.getByTestId("e2e-symbols")).toHaveText("2");
    await expect(page.getByTestId("e2e-session")).toHaveText("none");
  });

  test("empty-canvas wire finish does not commit and keeps session active", async ({ page }) => {
    await gotoHarness(page);

    const canvas = page.getByTestId("schematic-canvas");
    await canvas.click({ position: { x: 300, y: 150 } });
    await canvas.click({ position: { x: 520, y: 360 } });

    await expect(page.getByTestId("e2e-wires")).toHaveText("0");
    await expect(page.getByTestId("e2e-session")).toHaveText("wire:pin-2:pending");
  });

  test("Escape cancels an active placement session", async ({ page }) => {
    await gotoHarness(page);

    await page.getByRole("button", { name: "Resistor" }).click();
    await expect(page.getByTestId("e2e-session")).toHaveText("placement:resistor");

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("e2e-symbols")).toHaveText("2");
    await expect(page.getByTestId("e2e-session")).toHaveText("none");
  });

  test("symbol selection shows and dismisses the properties popover", async ({ page }) => {
    await gotoHarness(page);

    const canvas = page.getByTestId("schematic-canvas");
    await canvas.click({ position: { x: 250, y: 150 } });

    const popover = page.getByRole("dialog", { name: "Symbol properties" });
    await expect(popover).toBeVisible();
    await expect(page.getByTestId("e2e-popover")).toHaveText("symbol-1");

    await page.getByTestId("floating-properties-backdrop").click();
    await expect(popover).toBeHidden();
    await expect(page.getByTestId("e2e-selected")).toHaveText("symbol-1");
  });
});
