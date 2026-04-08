import { expect, test, type Locator, type Page } from "@playwright/test";

async function dragPaletteItemToCanvas(
  page: Page,
  label: string,
  position: { x: number; y: number },
  dropTarget: Locator,
) {
  const source = page.getByRole("button", { name: label });
  const canvasBox = await dropTarget.boundingBox();
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

async function readScreenPoint(page: Page, testId: string) {
  const text = await page.getByTestId(testId).textContent();
  const [x, y] = text!.split(",").map(Number);
  return { x, y };
}

function pcbHarnessPoint(x: number, y: number) {
  return {
    x: 200 + x * 4,
    y: 100 + y * 4,
  };
}

async function gotoSchematicHarness(page: Page) {
  await page.goto("/?e2e=schematic");
  await expect(page.getByText("Schematic E2E")).toBeVisible();
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
}

async function gotoPcbHarness(page: Page) {
  await page.goto("/?e2e=pcb");
  await expect(page.getByText("PCB E2E")).toBeVisible();
  await expect(page.getByTestId("pcb-canvas")).toBeVisible();
}

test.describe("canvas unification design-screen characterization", () => {
  test("@happy real design screen loads schematic and pcb canvases", async ({
    page,
  }) => {
    await page.goto("/#design");
    await expect(page.getByText("Drag To Canvas")).toBeVisible();
    await expect(page.getByTestId("schematic-canvas")).toBeVisible();

    await page.getByRole("button", { name: "PCB", exact: true }).click();
    await expect(page.getByTestId("pcb-canvas")).toBeVisible();

    await page.getByRole("button", { name: "Schem" }).click();
    await expect(page.getByTestId("schematic-canvas")).toBeVisible();
  });

  test("@happy schematic harness supports pan zoom, placement, and selection", async ({
    page,
  }) => {
    await gotoSchematicHarness(page);

    const beforePin2 = await page.getByTestId("e2e-pin2").textContent();
    const canvas = page.getByTestId("schematic-canvas");
    await canvas.dispatchEvent("wheel", {
      deltaY: -160,
      deltaMode: 0,
      clientX: 400,
      clientY: 300,
    });
    await expect(page.getByTestId("e2e-pin2")).toHaveText(beforePin2!);

    const beforeSymbol = await page
      .getByTestId("e2e-first-symbol")
      .textContent();
    await canvas.dispatchEvent("wheel", {
      deltaY: 160,
      deltaMode: 0,
      shiftKey: true,
      clientX: 400,
      clientY: 300,
    });
    await expect(page.getByTestId("e2e-first-symbol")).toHaveText(
      beforeSymbol!,
    );

    await dragPaletteItemToCanvas(page, "Resistor", { x: 420, y: 260 }, canvas);
    await expect(page.getByTestId("e2e-symbols")).toHaveText("3");
    await expect(page.getByTestId("e2e-selected")).not.toHaveText("none");
    await expect(
      page.getByRole("dialog", { name: "Symbol properties" }),
    ).toBeVisible();
  });

  test("@edge schematic harness preserves escape cancel semantics", async ({
    page,
  }) => {
    await gotoSchematicHarness(page);

    await page.getByRole("button", { name: "Resistor" }).click();
    await expect(page.getByTestId("e2e-session")).toHaveText(/placement:.+/);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("e2e-session")).toHaveText("none");

    const pin2 = await readScreenPoint(page, "e2e-pin2");
    const canvas = page.getByTestId("schematic-canvas");
    await canvas.click({ position: pin2 });
    await canvas.click({ position: { x: pin2.x + 220, y: pin2.y + 210 } });
    await expect(page.getByTestId("e2e-session")).toHaveText(
      "wire:pin-2:pending",
    );

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("e2e-session")).toHaveText("none");
    await expect(page.getByTestId("e2e-wires")).toHaveText("0");
  });

  test("@happy pcb harness supports routing and selection workflows", async ({
    page,
  }) => {
    await gotoPcbHarness(page);

    const canvas = page.getByTestId("pcb-canvas");

    await page.getByRole("button", { name: "Route Traces" }).click();
    await expect(page.getByTestId("e2e-tool")).toHaveText("route");

    await canvas.click({ position: pcbHarnessPoint(20, 50), force: true });
    await expect(page.getByTestId("e2e-routing")).toHaveText("net-1:F.Cu:0");

    await page.keyboard.press("w");
    await expect(page.getByTestId("e2e-width")).toHaveText("0.3");
    await page.keyboard.press("f");
    await expect(page.getByTestId("e2e-elbow")).toHaveText("vertical_first");
    await canvas.hover({ position: pcbHarnessPoint(40, 50), force: true });
    await page.keyboard.press("v");
    await expect(page.getByTestId("e2e-layer")).toHaveText("B.Cu");
    await expect(page.getByTestId("e2e-routing")).toHaveText("net-1:B.Cu:2");

    await canvas.click({ position: pcbHarnessPoint(60, 50), force: true });
    await expect(page.getByTestId("e2e-traces")).toHaveText("4");
    await expect(page.getByTestId("e2e-vias")).toHaveText("1");
    await expect(page.getByTestId("e2e-routing")).toHaveText("none");

    await page.getByRole("button", { name: "Select" }).click();
    await canvas.click({ position: pcbHarnessPoint(30, 50), force: true });
    await expect(page.getByTestId("e2e-selected")).not.toHaveText("none");
  });

  test("@edge pcb harness keeps idle route state cancellable", async ({
    page,
  }) => {
    await gotoPcbHarness(page);

    await page.getByRole("button", { name: "Route Traces" }).click();
    await expect(page.getByTestId("e2e-tool")).toHaveText("route");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("e2e-tool")).toHaveText("select");
    await expect(page.getByTestId("e2e-routing")).toHaveText("none");
  });
});
