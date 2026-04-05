import { expect, test, type Locator, type Page } from "@playwright/test";

function editorModifier(): "Meta" | "Control" {
  return process.platform === "darwin" ? "Meta" : "Control";
}

async function gotoHarness(
  page: Page,
  fixture: "base" | "drag-wiring" = "base",
) {
  const fixtureQuery = fixture === "base" ? "" : "&fixture=drag-wiring";
  await page.goto(`/?e2e=schematic${fixtureQuery}`);
  await expect(page.getByText("Schematic E2E")).toBeVisible();
}

async function readScreenPoint(page: Page, testId: string) {
  const text = await page.getByTestId(testId).textContent();
  const [x, y] = text!.split(",").map(Number);
  return { x, y };
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

async function dragSymbolBy(
  page: Page,
  symbolTestId: string,
  delta: { x: number; y: number },
) {
  const start = await readScreenPoint(page, symbolTestId);
  const canvas = page.getByTestId("schematic-canvas");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("no canvas bounds");

  await canvas.dispatchEvent("mousemove", {
    clientX: canvasBox.x + start.x,
    clientY: canvasBox.y + start.y,
    button: 0,
    buttons: 0,
  });
  await canvas.dispatchEvent("mousedown", {
    clientX: canvasBox.x + start.x,
    clientY: canvasBox.y + start.y,
    button: 0,
    buttons: 1,
  });
  await page.waitForTimeout(50);

  await canvas.dispatchEvent("mousemove", {
    clientX: canvasBox.x + start.x + 10,
    clientY: canvasBox.y + start.y,
    button: 0,
    buttons: 1,
  });
  await page.waitForTimeout(50);

  await canvas.dispatchEvent("mousemove", {
    clientX: canvasBox.x + start.x + delta.x,
    clientY: canvasBox.y + start.y + delta.y,
    button: 0,
    buttons: 1,
  });
  await page.waitForTimeout(50);

  await canvas.dispatchEvent("mouseup", {
    clientX: canvasBox.x + start.x + delta.x,
    clientY: canvasBox.y + start.y + delta.y,
    button: 0,
    buttons: 0,
  });
}

async function closePopoverIfOpen(page: Page) {
  const backdrop = page.getByTestId("floating-properties-backdrop");
  if (!(await backdrop.isVisible().catch(() => false))) {
    return;
  }

  await backdrop.click({ position: { x: 10, y: 10 }, force: true });
  await expect(page.getByTestId("e2e-popover")).toHaveText("none");
}

async function resetHarness(page: Page) {
  await closePopoverIfOpen(page);
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByTestId("e2e-session")).toHaveText("none");
}

async function findWireStartPoint(page: Page, pinId: string) {
  const canvas = page.getByTestId("schematic-canvas");
  const expectedSession = `wire:${pinId}:pending`;

  for (let x = 250; x <= 560; x += 10) {
    for (let y = 200; y <= 360; y += 10) {
      await closePopoverIfOpen(page);
      await page.keyboard.press("w");
      await canvas.click({ position: { x, y }, force: true });
      const session = await page.getByTestId("e2e-session").textContent();

      if (session === expectedSession) {
        await page.keyboard.press("Escape");
        return { x, y };
      }

      if (session && session.startsWith("wire:")) {
        await page.keyboard.press("Escape");
      }
    }
  }

  throw new Error(`unable to find hotspot for ${pinId}`);
}

async function findSymbolBodyPoint(page: Page, symbolId: string) {
  const canvas = page.getByTestId("schematic-canvas");

  for (let x = 320; x <= 680; x += 10) {
    for (let y = 200; y <= 420; y += 10) {
      await closePopoverIfOpen(page);
      await canvas.click({ position: { x, y }, force: true });
      const selected = await page.getByTestId("e2e-selected").textContent();

      if (selected === symbolId) {
        return { x, y };
      }

      if (selected && selected !== "none") {
        await closePopoverIfOpen(page);
        await canvas.click({ position: { x: 760, y: 560 }, force: true });
      }
    }
  }

  throw new Error(`unable to find body hotspot for ${symbolId}`);
}

test.describe("schematic parity contract", () => {
  test("locks placement commit/cancel and wire start/waypoint/commit/cancel flows", async ({
    page,
  }) => {
    await gotoHarness(page);
    const pin2 = await findWireStartPoint(page, "pin-2");
    const pin3 = await findWireStartPoint(page, "pin-3");
    await resetHarness(page);

    await expect(page.getByTestId("e2e-symbols")).toHaveText("2");
    await dragPaletteItemToCanvas(page, "Resistor", { x: 420, y: 260 });
    await expect(page.getByTestId("e2e-symbols")).toHaveText("3");
    await expect(page.getByTestId("e2e-session")).toHaveText("none");

    await page.getByRole("button", { name: "Resistor" }).click();
    await expect(page.getByTestId("e2e-session")).toHaveText(/placement:.+/);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("e2e-symbols")).toHaveText("3");
    await expect(page.getByTestId("e2e-session")).toHaveText("none");
    await closePopoverIfOpen(page);

    const canvas = page.getByTestId("schematic-canvas");

    await page.keyboard.press("w");
    await canvas.click({ position: pin2, force: true });
    await expect(page.getByTestId("e2e-session")).toHaveText(
      "wire:pin-2:pending",
    );

    await canvas.click({ position: { x: pin2.x + 220, y: pin2.y + 210 }, force: true });
    await expect(page.getByTestId("e2e-wires")).toHaveText("0");
    await expect(page.getByTestId("e2e-session")).toHaveText(
      "wire:pin-2:pending",
    );

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("e2e-wires")).toHaveText("0");
    await expect(page.getByTestId("e2e-session")).toHaveText("none");

    await canvas.click({ position: pin2, force: true });
    await canvas.click({ position: pin3, force: true });
    await expect(page.getByTestId("e2e-wires")).toHaveText("1");
    await expect(page.getByTestId("e2e-session")).toHaveText("none");
  });

  test("locks selection add/clear and delete keyboard semantics", async ({
    page,
  }) => {
    await gotoHarness(page, "drag-wiring");
    const symbol1 = await findSymbolBodyPoint(page, "symbol-1");
    const symbol2 = await findSymbolBodyPoint(page, "symbol-2");
    await resetHarness(page);

    const canvas = page.getByTestId("schematic-canvas");

    await canvas.click({ position: symbol1, force: true });
    await expect(page.getByTestId("e2e-selected")).toHaveText("symbol-1");

    await closePopoverIfOpen(page);
    await canvas.click({ position: symbol2, modifiers: ["Shift"], force: true });
    await expect(page.getByTestId("e2e-selected")).toHaveText(
      "symbol-1,symbol-2",
    );

    await closePopoverIfOpen(page);
    await canvas.click({ position: { x: 760, y: 560 }, force: true });
    await expect(page.getByTestId("e2e-selected")).toHaveText("none");

    await canvas.click({ position: symbol1, force: true });
    await page.keyboard.press("Delete");
    await expect(page.getByTestId("e2e-symbols")).toHaveText("2");
    await expect(page.getByTestId("e2e-wires")).toHaveText("1");
    await expect(page.getByTestId("e2e-selected")).toHaveText("none");
    await expect(page.getByTestId("e2e-session")).toHaveText("none");
  });

  test("edge parity guard: invalid drop and empty-area wire finish preserve existing behavior", async ({
    page,
  }) => {
    await gotoHarness(page);
    const pin2 = await findWireStartPoint(page, "pin-2");
    await resetHarness(page);

    await dragPaletteItemToCanvas(
      page,
      "Resistor",
      { x: 420, y: 260 },
      page.getByTestId("e2e-session"),
    );
    await expect(page.getByTestId("e2e-symbols")).toHaveText("2");
    await expect(page.getByTestId("e2e-session")).toHaveText("none");

    const canvas = page.getByTestId("schematic-canvas");
    await page.keyboard.press("w");
    await canvas.click({ position: pin2 });
    await canvas.click({ position: { x: pin2.x + 220, y: pin2.y + 210 } });

    await expect(page.getByTestId("e2e-wires")).toHaveText("0");
    await expect(page.getByTestId("e2e-session")).toHaveText(
      "wire:pin-2:pending",
    );
  });
});
