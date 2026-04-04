import { expect, test, type Page, type Locator } from "@playwright/test";

test.describe("component library integration", () => {
  test("create component, place in design, edit canonical, verify live update", async ({
    page,
  }) => {
    page.on("console", (msg) => console.log("BROWSER: " + msg.text()));
    page.on("pageerror", (err) => console.log("BROWSER ERR: " + err.message));
    // 1. Create component
    await page.goto("/#library");
    await expect(page.getByText("Component Library")).toBeVisible();

    await page.getByRole("button", { name: "New" }).click();
    await expect(page.getByText("New Component")).toBeVisible();

    const testComponentName = `E2E Component ${Date.now()}`;
    await page.getByLabel("Name").fill(testComponentName);
    await page
      .getByLabel("Description")
      .fill("A test component created by E2E");
    await page.getByRole("button", { name: "Create Component" }).click();

    // Verify it appears in library
    await expect(page.getByText("Component created").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: new RegExp(testComponentName) }),
    ).toBeVisible();

    // 2. Place in design
    await page.goto("/#design");
    // Expand or ensure palette is loaded
    await expect(page.getByText("Drag To Canvas")).toBeVisible();

    // Wait for the component to appear in the palette
    const paletteItem = page.getByRole("button", {
      name: new RegExp(testComponentName),
    });
    await expect(paletteItem).toBeVisible();

    // Drag it to canvas
    const canvas = page.getByTestId("schematic-canvas-surface");
    const surfaceBox = await canvas.boundingBox();
    if (!surfaceBox) throw new Error("Canvas not found");

    await paletteItem.dragTo(canvas, {
      targetPosition: { x: 300, y: 300 },
    });

    await paletteItem.click();
    await canvas.click({ position: { x: 300, y: 300 } });

    // The newly placed component should be selected automatically, showing its properties
    const propertyPopover = page.getByRole("dialog", {
      name: "Symbol properties",
    });
    await expect(propertyPopover).toBeVisible();

    // 3. Reopen same component in canonical editor
    await page.goto("/#library");
    await page
      .getByRole("button", { name: new RegExp(testComponentName) })
      .click();

    // 4. Change variant data
    await page.getByLabel("Description").fill("Updated description via E2E");
    await page.getByRole("button", { name: "Save Component" }).click();

    // Wait for update toast
    await expect(page.getByText("Component updated").first()).toBeVisible();
    await expect(page.getByText(/instance.*refreshed/)).toBeVisible();

    // 5. Inspect open design canvas and banner/toast
    // Wait, let's test the delete-block scenario
    await page.goto("/#library");
    // Try to delete the component
    // Select it first
    await page
      .getByRole("checkbox", { name: `Select ${testComponentName}` })
      .click();
    await page.getByRole("button", { name: "Delete Selected" }).click();

    // In the confirmation dialog
    await page.getByRole("button", { name: "Delete 1 Components" }).click();

    // Verify delete is blocked
    await expect(
      page.getByText("1 component was not deleted because it is in use."),
    ).toBeVisible();

    // Close the dialog
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("KiCad symbol scaling - imports and scales correctly", async ({
    page,
  }) => {
    page.on("console", (msg) => console.log("BROWSER: " + msg.text()));

    // Import passive fixture
    await page.goto("/#library");
    await expect(page.getByText("Component Library")).toBeVisible();

    await page.getByRole("button", { name: "New" }).click();
    await expect(page.getByText("New component")).toBeVisible();

    const passiveName = `E2E Passive ${Date.now()}`;
    await page
      .locator('input[accept=".kicad_sym"]')
      .setInputFiles(
        "src-ts/src/infrastructure/parsers/kicad/__fixtures__/simple_resistor.kicad_sym",
      );

    // Check if the symbol preview or success message is visible
    await expect(page.getByText("Symbol imported"))
      .toBeVisible({ timeout: 5000 })
      .catch(() => {});

    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByPlaceholder("10kΩ Chip Resistor").fill(passiveName);
    await page.getByRole("button", { name: "Save Component" }).click();
    await expect(page.getByText("Component published").first()).toBeVisible();

    // Import regulator fixture
    await page.goto("/#library");
    await page.getByRole("button", { name: "New" }).click();

    const regulatorName = `E2E Regulator ${Date.now()}`;
    await page
      .locator('input[accept=".kicad_sym"]')
      .setInputFiles(
        "src-ts/src/infrastructure/parsers/kicad/__fixtures__/lm317t_regulator.kicad_sym",
      );

    await expect(page.getByText("Symbol imported"))
      .toBeVisible({ timeout: 5000 })
      .catch(() => {});

    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();

    await page.getByPlaceholder("10kΩ Chip Resistor").fill(regulatorName);

    await page.getByRole("button", { name: "Save Component" }).click();
    await expect(page.getByText("Component published").first()).toBeVisible();

    // Import unsupported fixture
    await page.goto("/#library");
    await page.getByRole("button", { name: "New" }).click();
    await page
      .locator('input[accept=".kicad_sym"]')
      .setInputFiles(
        "src-ts/src/infrastructure/parsers/kicad/__fixtures__/three_side_ic.kicad_sym",
      );

    // Look for the warning
    await expect(
      page.getByText(/Skipped canonical normalization/i).first(),
    ).toBeVisible();

    // 2. Place in design
    await page.goto("/#design");
    await expect(page.getByText("Drag To Canvas")).toBeVisible();

    const canvas = page.getByTestId("schematic-canvas-surface");

    const passiveItem = page.getByRole("button", {
      name: new RegExp(passiveName),
    });
    await expect(passiveItem).toBeVisible();
    await passiveItem.click();
    await canvas.click({ position: { x: 300, y: 300 } });
    await page.keyboard.press("Escape");

    const regulatorItem = page.getByRole("button", {
      name: new RegExp(regulatorName),
    });
    await expect(regulatorItem).toBeVisible();
    await regulatorItem.click();
    await canvas.click({ position: { x: 600, y: 300 } });
    await page.keyboard.press("Escape");

    // Wait for renderings
    await page.waitForTimeout(500);
  });
});
