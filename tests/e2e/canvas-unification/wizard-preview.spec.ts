import { expect, test, type Page } from "@playwright/test";

async function openLibrary(page: Page) {
  await page.goto("/#library");
  await expect(page.getByText("Component Library")).toBeVisible();
}

async function openComponentDetail(page: Page, name: RegExp | string) {
  await page.getByRole("button", { name }).first().click();
  await expect(page.getByText("Schematic Symbol")).toBeVisible();
  await expect(page.getByText("PCB Footprint")).toBeVisible();
}

async function openSimpleBuiltinComponent(page: Page) {
  for (const candidate of [
    { label: /^GND\b/i, name: "GND" },
    { label: /^VCC\b/i, name: "VCC" },
  ]) {
    const button = page.getByRole("button", { name: candidate.label }).first();
    if ((await button.count()) > 0) {
      await button.click();
      await expect(page.getByText("Schematic Symbol")).toBeVisible();
      return candidate.name;
    }
  }

  throw new Error("Expected a simple built-in component like GND or VCC");
}

test.describe("wizard preview parity", () => {
  test("preview @happy library page loads with symbol and footprint previews visible", async ({
    page,
  }) => {
    await openLibrary(page);
    await openComponentDetail(page, /Resistor/i);

    await expect(page.getByTestId("symbol-preview")).toBeVisible();
    await expect(page.getByTestId("footprint-preview")).toBeVisible();
    await expect(
      page
        .locator("section")
        .filter({ hasText: "Schematic Symbol" })
        .locator("canvas")
        .first(),
    ).toBeVisible();
    await expect(
      page
        .locator("section")
        .filter({ hasText: "PCB Footprint" })
        .locator("canvas")
        .first(),
    ).toBeVisible();
  });

  test("preview @edge empty states display correctly", async ({ page }) => {
    await openLibrary(page);
    await openSimpleBuiltinComponent(page);

    await expect(page.getByTestId("symbol-preview")).toBeVisible();
    await expect(page.getByTestId("footprint-preview")).toContainText(
      "No footprint data available",
    );
  });

  test("preview @edge fallback layouts render for simple components", async ({
    page,
  }) => {
    await openLibrary(page);
    const builtInName = await openSimpleBuiltinComponent(page);

    await expect(page.getByTestId("symbol-preview")).toBeVisible();
    await expect(
      page.getByTestId("symbol-preview").locator("canvas"),
    ).toBeVisible();
    await expect(page.getByTestId("symbol-preview")).not.toContainText(
      "No symbol data available",
    );
    await expect(
      page.getByRole("heading", { name: builtInName, exact: true }),
    ).toBeVisible();
  });
});
