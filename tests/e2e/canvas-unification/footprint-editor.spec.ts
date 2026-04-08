import { expect, test, type Page } from "@playwright/test";

async function gotoHarness(page: Page) {
  await page.goto("/?e2e=footprint-editor");
  await expect(page.getByText("Footprint Editor E2E")).toBeVisible();
  await expect(page.getByTestId("footprint-editor-canvas")).toBeVisible();
}

async function clickCanvasAtFraction(
  page: Page,
  xFraction: number,
  yFraction: number,
) {
  const box = await page.getByTestId("footprint-editor-canvas").boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.click(
    box!.x + box!.width * xFraction,
    box!.y + box!.height * yFraction,
  );
}

async function selectPadOnCanvas(page: Page) {
  for (const [xFraction, yFraction] of [
    [0.55, 0.45],
    [0.56, 0.45],
    [0.55, 0.44],
    [0.54, 0.45],
    [0.6, 0.45],
  ]) {
    await page.getByRole("button", { name: "Reset" }).click();
    await page.waitForTimeout(100);
    await clickCanvasAtFraction(page, xFraction, yFraction);

    if ((await page.getByTestId("e2e-selected-pads").textContent()) === "1") {
      return;
    }
  }

  throw new Error("Unable to select a pad on the footprint canvas");
}

test("@happy footprint editor loads and shows pads", async ({ page }) => {
  await gotoHarness(page);
  await expect(page.getByTestId("e2e-pads-count")).toHaveText("2");
});

test("@happy footprint editor keyboard shortcuts update selection and history", async ({
  page,
}) => {
  await gotoHarness(page);

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+a" : "Control+a",
  );
  await expect(page.getByTestId("e2e-selected-pads")).toHaveText("2");

  await page.keyboard.press("Delete");
  await expect(page.getByTestId("e2e-pads-count")).toHaveText("0");

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await expect(page.getByTestId("e2e-pads-count")).toHaveText("2");

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z",
  );
  await expect(page.getByTestId("e2e-pads-count")).toHaveText("0");
});

test("@happy footprint editor click selection drives delete and clears on empty canvas", async ({
  page,
}) => {
  await gotoHarness(page);

  await selectPadOnCanvas(page);
  await expect(page.getByTestId("e2e-selected-pads")).toHaveText("1");

  await page.keyboard.press("Delete");
  await expect(page.getByTestId("e2e-pads-count")).toHaveText("1");

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await expect(page.getByTestId("e2e-pads-count")).toHaveText("2");

  await clickCanvasAtFraction(page, 0.2, 0.2);
  await expect(page.getByTestId("e2e-selected-pads")).toHaveText("0");
});

test("@edge wizard footprint step loads real editor surface", async ({
  page,
}) => {
  await page.goto("/#library");
  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(
    page.getByText("Step 2 of 4: Footprint", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("footprint-editor-canvas")).toBeVisible();
});
