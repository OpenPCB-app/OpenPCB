import { expect, test, type Locator, type Page } from "@playwright/test";

async function gotoHarness(page: Page) {
  await page.goto("/?e2e=symbol-editor");
  await expect(page.getByText("Symbol Editor E2E")).toBeVisible();
  await expect(page.getByTestId("e2e-graphics-count")).toHaveText("0");
  await expect(page.getByTestId("e2e-pins-count")).toHaveText("0");
}

async function gotoHarnessWithGraphics(page: Page) {
  await page.goto("/?e2e=symbol-editor&fixture=with-graphics");
  await expect(page.getByText("Symbol Editor E2E")).toBeVisible();
  await expect(page.getByTestId("e2e-graphics-count")).toHaveText("1");
  await expect(page.getByTestId("e2e-pins-count")).toHaveText("2");
}

/**
 * Draw on canvas using real mouse events.
 * IMPORTANT: Must use page.mouse API, NOT dispatchEvent.
 * dispatchEvent does not work with React Three Fiber's pointer event system.
 * Using page.mouse ensures proper event handling in R3F canvas.
 */
async function drawOnCanvas(
  page: Page,
  canvas: Locator,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas not visible");

  await page.mouse.move(box.x + start.x, box.y + start.y);
  await page.mouse.down();
  await page.waitForTimeout(50);

  await page.mouse.move(box.x + end.x, box.y + end.y);
  await page.waitForTimeout(50);

  await page.mouse.up();
  await page.waitForTimeout(50);
}

async function dragPinToCanvas(
  page: Page,
  pinLabel: string,
  position: { x: number; y: number },
) {
  const source = page.getByText(pinLabel, { exact: false }).first();
  const canvas = page.getByTestId("symbol-editor-canvas");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("Canvas not visible");

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent("dragstart", { dataTransfer });
  await canvas.dispatchEvent("dragover", {
    dataTransfer,
    clientX: canvasBox.x + position.x,
    clientY: canvasBox.y + position.y,
  });
  await canvas.dispatchEvent("drop", {
    dataTransfer,
    clientX: canvasBox.x + position.x,
    clientY: canvasBox.y + position.y,
  });
  await source.dispatchEvent("dragend", { dataTransfer });
  await page.waitForTimeout(50);
}

test.describe("symbol-editor drawing tools", () => {
  test("canvas renders grid on initial load", async ({ page }) => {
    await gotoHarness(page);

    const canvas = page.getByTestId("symbol-editor-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId("e2e-active-tool")).toHaveText("select");
  });

  test("draw rectangle via tool button + mouse drag", async ({ page }) => {
    await gotoHarness(page);

    await page.getByRole("button", { name: /Rectangle/ }).click();
    await expect(page.getByTestId("e2e-active-tool")).toHaveText("rect");

    const canvas = page.getByTestId("symbol-editor-canvas");
    await drawOnCanvas(page, canvas, { x: 200, y: 200 }, { x: 400, y: 350 });

    await expect(page.getByTestId("e2e-graphics-count")).toHaveText("1");
    await expect(page.getByTestId("e2e-last-graphic-type")).toHaveText("rect");
    await expect(canvas).toBeVisible();
  });

  test("draw line via tool button + mouse drag", async ({ page }) => {
    await gotoHarness(page);

    await page.getByRole("button", { name: /Line/ }).click();
    await expect(page.getByTestId("e2e-active-tool")).toHaveText("line");

    const canvas = page.getByTestId("symbol-editor-canvas");
    await drawOnCanvas(page, canvas, { x: 100, y: 100 }, { x: 500, y: 400 });

    await expect(page.getByTestId("e2e-graphics-count")).toHaveText("1");
    await expect(page.getByTestId("e2e-last-graphic-type")).toHaveText("line");
    await expect(canvas).toBeVisible();
  });

  test("draw circle via tool button + mouse drag", async ({ page }) => {
    await gotoHarness(page);

    await page.getByRole("button", { name: /Circle/ }).click();
    await expect(page.getByTestId("e2e-active-tool")).toHaveText("circle");

    const canvas = page.getByTestId("symbol-editor-canvas");
    await drawOnCanvas(page, canvas, { x: 400, y: 300 }, { x: 500, y: 300 });

    await expect(page.getByTestId("e2e-graphics-count")).toHaveText("1");
    await expect(page.getByTestId("e2e-last-graphic-type")).toHaveText(
      "circle",
    );
    await expect(canvas).toBeVisible();
  });

  test("draw multiple primitives sequentially", async ({ page }) => {
    await gotoHarness(page);

    const canvas = page.getByTestId("symbol-editor-canvas");

    await page.getByRole("button", { name: /Rectangle/ }).click();
    await drawOnCanvas(page, canvas, { x: 100, y: 100 }, { x: 200, y: 200 });
    await expect(page.getByTestId("e2e-graphics-count")).toHaveText("1");

    await page.getByRole("button", { name: /Line/ }).click();
    await drawOnCanvas(page, canvas, { x: 300, y: 100 }, { x: 400, y: 200 });
    await expect(page.getByTestId("e2e-graphics-count")).toHaveText("2");

    await page.getByRole("button", { name: /Circle/ }).click();
    await drawOnCanvas(page, canvas, { x: 500, y: 150 }, { x: 600, y: 250 });
    await expect(page.getByTestId("e2e-graphics-count")).toHaveText("3");

    await expect(canvas).toBeVisible();
  });

  test("undo removes last drawn primitive", async ({ page }) => {
    await gotoHarness(page);

    await page.getByRole("button", { name: /Rectangle/ }).click();
    const canvas = page.getByTestId("symbol-editor-canvas");
    await drawOnCanvas(page, canvas, { x: 200, y: 200 }, { x: 400, y: 350 });

    await expect(page.getByTestId("e2e-graphics-count")).toHaveText("1");

    const undoKey = process.platform === "darwin" ? "Meta+z" : "Control+z";
    await page.keyboard.press(undoKey);

    await expect(page.getByTestId("e2e-graphics-count")).toHaveText("0");
    await expect(canvas).toBeVisible();
  });

  test("click pin from palette adds pin", async ({ page }) => {
    await gotoHarness(page);

    const inputPinButton = page.getByText("Input", { exact: true });
    await inputPinButton.click();

    await expect(page.getByTestId("e2e-pins-count")).toHaveText("1");
  });

  test("drag pin from palette onto canvas adds pin", async ({ page }) => {
    await gotoHarness(page);

    await dragPinToCanvas(page, "Output", { x: 300, y: 300 });

    await expect(page.getByTestId("e2e-pins-count")).toHaveText("1");
  });

  test("canvas survives rapid tool switching and drawing", async ({ page }) => {
    await gotoHarness(page);

    const canvas = page.getByTestId("symbol-editor-canvas");
    const graphicsCount = page.getByTestId("e2e-graphics-count");
    const activeTool = page.getByTestId("e2e-active-tool");
    const errors: string[] = [];

    page.on("pageerror", (err) => {
      errors.push(err.message);
    });

    for (let i = 0; i < 3; i++) {
      const baseCount = i * 3;
      const offsetX = i * 100;

      await page.getByRole("button", { name: /Rectangle/ }).click();
      await expect(activeTool).toHaveText("rect");
      await drawOnCanvas(
        page,
        canvas,
        { x: 200 + offsetX, y: 200 },
        { x: 350 + offsetX, y: 300 },
      );
      await expect(graphicsCount).toHaveText(String(baseCount + 1));

      await page.getByRole("button", { name: /Line/ }).click();
      await expect(activeTool).toHaveText("line");
      await drawOnCanvas(
        page,
        canvas,
        { x: 200 + offsetX, y: 320 },
        { x: 350 + offsetX, y: 420 },
      );
      await expect(graphicsCount).toHaveText(String(baseCount + 2));

      await page.getByRole("button", { name: /Circle/ }).click();
      await expect(activeTool).toHaveText("circle");
      await drawOnCanvas(
        page,
        canvas,
        { x: 200 + offsetX, y: 450 },
        { x: 280 + offsetX, y: 450 },
      );
      await expect(graphicsCount).toHaveText(String(baseCount + 3));
    }

    await expect(graphicsCount).toHaveText("9");
    expect(errors).toHaveLength(0);
  });

  test("keyboard shortcuts change active tool", async ({ page }) => {
    await gotoHarness(page);

    await expect(page.getByTestId("e2e-active-tool")).toHaveText("select");

    await page.keyboard.press("l");
    await expect(page.getByTestId("e2e-active-tool")).toHaveText("line");

    await page.keyboard.press("r");
    await expect(page.getByTestId("e2e-active-tool")).toHaveText("rect");

    await page.keyboard.press("c");
    await expect(page.getByTestId("e2e-active-tool")).toHaveText("circle");

    await page.keyboard.press("v");
    await expect(page.getByTestId("e2e-active-tool")).toHaveText("select");
  });

  test("Escape returns to select tool", async ({ page }) => {
    await gotoHarness(page);

    await page.getByRole("button", { name: /Rectangle/ }).click();
    await expect(page.getByTestId("e2e-active-tool")).toHaveText("rect");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("e2e-active-tool")).toHaveText("select");
  });
});

/**
 * BUG INVESTIGATION RESULTS (Task 2):
 *
 * FINDING: NO PRODUCTION BUG EXISTS.
 *
 * The original tests used dispatchEvent() which does NOT work with
 * React Three Fiber's pointer event system. R3F requires real pointer events
 * from page.mouse or actual user interaction.
 *
 * FIX: Changed drawOnCanvas() to use page.mouse API instead of dispatchEvent.
 * All drawing tests now pass.
 *
 * The suspected stale closure bug was never tested because the test setup was broken.
 */

test.describe("symbol-editor with fixtures", () => {
  test("with-graphics fixture loads correctly", async ({ page }) => {
    await gotoHarnessWithGraphics(page);

    const canvas = page.getByTestId("symbol-editor-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId("e2e-graphics-count")).toHaveText("1");
    await expect(page.getByTestId("e2e-pins-count")).toHaveText("2");
  });

  test("Reset button restores initial state", async ({ page }) => {
    await gotoHarness(page);

    await page.getByRole("button", { name: /Rectangle/ }).click();
    const canvas = page.getByTestId("symbol-editor-canvas");
    await drawOnCanvas(page, canvas, { x: 200, y: 200 }, { x: 400, y: 350 });

    await expect(page.getByTestId("e2e-graphics-count")).toHaveText("1");

    await page.getByRole("button", { name: "Reset", exact: true }).click();

    await expect(page.getByTestId("e2e-graphics-count")).toHaveText("0");
    await expect(page.getByTestId("e2e-active-tool")).toHaveText("select");
  });
});

test.describe("symbol-editor mid-gesture tool switch", () => {
  test("mid-gesture tool switch should not commit partial drawing", async ({
    page,
  }) => {
    await gotoHarness(page);

    await page.getByRole("button", { name: /Line/ }).click();
    await expect(page.getByTestId("e2e-active-tool")).toHaveText("line");

    const canvas = page.getByTestId("symbol-editor-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Canvas not visible");

    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.waitForTimeout(50);

    await page.mouse.move(box.x + 200, box.y + 200);
    await page.waitForTimeout(50);

    await page.keyboard.press("v");
    await expect(page.getByTestId("e2e-active-tool")).toHaveText("select");

    await page.mouse.up();
    await page.waitForTimeout(50);

    const graphicsCount = await page
      .getByTestId("e2e-graphics-count")
      .textContent();
    expect(graphicsCount).toBe("0");
  });

  test("draw line via keyboard shortcut 'l' then drag", async ({ page }) => {
    await gotoHarness(page);

    await page.keyboard.press("l");
    await expect(page.getByTestId("e2e-active-tool")).toHaveText("line");

    const canvas = page.getByTestId("symbol-editor-canvas");
    await drawOnCanvas(page, canvas, { x: 100, y: 100 }, { x: 300, y: 300 });

    await expect(page.getByTestId("e2e-graphics-count")).toHaveText("1");
  });
});

/**
 * Component Wizard Pin Drag-Drop Bug Tests
 *
 * Bug: MIME type mismatch between PinPalette (sets "application/x-openpcb-pin-type")
 * and SymbolEditorCanvasR3F (checks for "application/x-openpcb-pin")
 *
 * Tests verify:
 * 1. Drag-drop should FAIL (pre-fix verification)
 * 2. Click-to-add should WORK (bypasses drag-drop)
 */
test.describe("component-wizard pin interactions", () => {
  async function gotoWizardSymbolStep(page: Page) {
    await page.goto("/#library");
    await expect(page.getByText("Component Library")).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole("button", { name: "New" }).click();
    await expect(page.getByText("New Component")).toBeVisible({
      timeout: 10000,
    });
    await page.waitForTimeout(500);
    await expect(page.getByTestId("symbol-editor-canvas")).toBeVisible({
      timeout: 10000,
    });
  }

  test("wizard: click-to-add pin should work", async ({ page }) => {
    await gotoWizardSymbolStep(page);

    const inputPinButton = page.getByText("Input", { exact: true });
    await inputPinButton.click();
    await page.waitForTimeout(200);

    const pinProps = page.getByText("Pin Properties");
    await expect(pinProps).toBeVisible();

    await page.screenshot({
      path: ".sisyphus/evidence/task-1-click-add-works.png",
    });
  });

  test("wizard: drag-drop pin should fail (MIME bug)", async ({ page }) => {
    await gotoWizardSymbolStep(page);

    await dragPinToCanvas(page, "Output", { x: 300, y: 300 });
    await page.waitForTimeout(200);

    const placeholder = page.getByText("Select a pin to edit its properties");
    const isPlaceholderVisible = await placeholder.isVisible();

    expect(isPlaceholderVisible).toBe(true);

    await page.screenshot({
      path: ".sisyphus/evidence/task-1-pin-drag-fail.png",
    });
  });
});
