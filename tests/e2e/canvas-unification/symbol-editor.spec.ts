import { expect, test, type Locator, type Page } from "@playwright/test";

async function gotoHarness(page: Page) {
  await page.goto("/?e2e=symbol-editor");
  await expect(page.getByText("Symbol Editor E2E")).toBeVisible();
  await expect(page.getByTestId("symbol-editor-canvas")).toBeVisible();
}

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
  await page.mouse.move(box.x + end.x, box.y + end.y);
  await page.mouse.up();
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
}

test("@happy symbol editor loads and drawing tools work", async ({ page }) => {
  await gotoHarness(page);

  await page.getByRole("button", { name: /Rectangle/ }).click();
  await expect(page.getByTestId("e2e-active-tool")).toHaveText("rect");
  await drawOnCanvas(
    page,
    page.getByTestId("symbol-editor-canvas"),
    { x: 180, y: 180 },
    { x: 360, y: 320 },
  );

  await expect(page.getByTestId("e2e-graphics-count")).toHaveText("1");
  await expect(page.getByTestId("e2e-last-graphic-type")).toHaveText("rect");
});

test("@happy symbol editor supports pin placement", async ({ page }) => {
  await gotoHarness(page);

  await dragPinToCanvas(page, "Input", { x: 320, y: 280 });
  await expect(page.getByTestId("e2e-pins-count")).toHaveText("1");
});

test("@happy symbol editor supports direct graphic select, delete, and undo", async ({
  page,
}) => {
  await gotoHarness(page);

  const canvas = page.getByTestId("symbol-editor-canvas");
  await page.getByRole("button", { name: /Rectangle/ }).click();
  await drawOnCanvas(page, canvas, { x: 180, y: 180 }, { x: 360, y: 320 });
  await expect(page.getByTestId("e2e-graphics-count")).toHaveText("1");
  await expect(page.getByTestId("e2e-selected-graphics")).toHaveText("0");

  await page.getByRole("button", { name: /Select/ }).click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas not visible");
  await page.mouse.click(box.x + 260, box.y + 250);
  await expect(page.getByTestId("e2e-selected-graphics")).toHaveText("1");

  await page.keyboard.press("Delete");
  await expect(page.getByTestId("e2e-graphics-count")).toHaveText("0");
  await expect(page.getByTestId("e2e-selected-graphics")).toHaveText("0");

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await expect(page.getByTestId("e2e-graphics-count")).toHaveText("1");
});

test("@edge wizard symbol step supports close flow", async ({ page }) => {
  await page.goto("/#library");
  await page.getByRole("button", { name: "New" }).click();
  await expect(
    page.getByText("Step 1 of 4: Symbol", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("symbol-editor-canvas")).toBeVisible();

  await page.getByRole("button").first().click();
  await expect(
    page.getByText("Step 1 of 4: Symbol", { exact: true }),
  ).not.toBeVisible();
});
