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
});
