import { expect, test, type Locator, type Page } from "@playwright/test";

async function gotoHarness(page: Page) {
  await page.goto("/?e2e=pcb");
  await expect(page.getByText("PCB E2E")).toBeVisible();
  await expect(page.getByTestId("e2e-traces")).toHaveText("0");
  await expect(page.getByTestId("e2e-vias")).toHaveText("0");
}

function boardPoint(x: number, y: number) {
  return {
    x: 200 + x * 4,
    y: 100 + y * 4,
  };
}

async function clickCanvas(canvas: Locator, point: { x: number; y: number }) {
  await canvas.click({ position: point, force: true });
}

test.describe("pcb editor flows", () => {
  test("routes with keyboard-controlled width/elbow and inserts a via", async ({
    page,
  }) => {
    await gotoHarness(page);

    await page.getByRole("button", { name: "Route Traces" }).click();
    await expect(page.getByTestId("e2e-tool")).toHaveText("route");

    const canvas = page.getByTestId("pcb-canvas");
    await clickCanvas(canvas, boardPoint(20, 50));
    await expect(page.getByTestId("e2e-routing")).toHaveText("net-1:F.Cu:0");

    await canvas.hover({ position: boardPoint(40, 50), force: true });
    await expect(page.getByTestId("e2e-width")).toHaveText("0.25");
    await page.keyboard.press("w");
    await expect(page.getByTestId("e2e-width")).toHaveText("0.3");
    await expect(page.getByTestId("e2e-elbow")).toHaveText("horizontal_first");
    await page.keyboard.press("f");
    await expect(page.getByTestId("e2e-elbow")).toHaveText("vertical_first");
    await page.keyboard.press("v");

    await expect(page.getByTestId("e2e-vias")).toHaveText("0");
    await expect(page.getByTestId("e2e-layer")).toHaveText("B.Cu");
    await expect(page.getByTestId("e2e-routing")).toHaveText("net-1:B.Cu:2");

    await clickCanvas(canvas, boardPoint(60, 50));

    await expect(page.getByTestId("e2e-traces")).toHaveText("4");
    await expect(page.getByTestId("e2e-vias")).toHaveText("1");
    await expect(page.getByTestId("e2e-ratsnest")).toHaveText("0");
    await expect(page.getByTestId("e2e-routing")).toHaveText("none");
  });

  test("selects a routed via, deletes it, then undo/redo restores browser state", async ({
    page,
  }) => {
    await gotoHarness(page);

    await page.getByRole("button", { name: "Route Traces" }).click();
    const canvas = page.getByTestId("pcb-canvas");
    await clickCanvas(canvas, boardPoint(20, 50));
    await canvas.hover({ position: boardPoint(40, 50), force: true });
    await page.keyboard.press("v");
    await clickCanvas(canvas, boardPoint(60, 50));
    await expect(page.getByTestId("e2e-traces")).toHaveText("4");

    await page.getByRole("button", { name: "Select" }).click();
    await clickCanvas(canvas, boardPoint(40, 50));
    await expect(page.getByTestId("e2e-selected")).toHaveText(/^[^n].*/);

    await page.keyboard.press("Delete");
    await expect(page.getByTestId("e2e-traces")).toHaveText("4");
    await expect(page.getByTestId("e2e-vias")).toHaveText("0");
    await expect(page.getByTestId("e2e-ratsnest")).toHaveText("0");

    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+z" : "Control+z",
    );
    await expect(page.getByTestId("e2e-traces")).toHaveText("4");
    await expect(page.getByTestId("e2e-vias")).toHaveText("1");
    await expect(page.getByTestId("e2e-ratsnest")).toHaveText("0");

    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z",
    );
    await expect(page.getByTestId("e2e-traces")).toHaveText("4");
    await expect(page.getByTestId("e2e-vias")).toHaveText("0");
    await expect(page.getByTestId("e2e-ratsnest")).toHaveText("0");
  });
});
