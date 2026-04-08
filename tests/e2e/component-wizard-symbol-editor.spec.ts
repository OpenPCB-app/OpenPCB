import { expect, test, type Locator, type Page } from "@playwright/test";

function getWizardTitle(page: Page): Locator {
  return page.getByRole("heading", { name: /New [Cc]omponent/ });
}

function getWizardStepLabel(page: Page): Locator {
  return page.getByText("Step 1 of 4: Symbol", { exact: true });
}

function getSymbolEditorCanvas(page: Page): Locator {
  return page.getByTestId("symbol-editor-canvas");
}

function getNewButton(page: Page): Locator {
  return page.getByRole("button", { name: "New" });
}

function getBackButton(page: Page): Locator {
  return page.getByRole("button", { name: "Back" });
}

function getNextButton(page: Page): Locator {
  return page.getByRole("button", { name: "Next" });
}

function getSaveComponentButton(page: Page): Locator {
  return page.getByRole("button", { name: "Save Component" });
}

function getPinTypesHeading(page: Page): Locator {
  return page.getByText("Pin Types", { exact: true });
}

function getPinPropertiesHeading(page: Page): Locator {
  return page.getByText("Pin Properties", { exact: true });
}

function getSymbolInfoHeading(page: Page): Locator {
  return page.getByText("Symbol Info", { exact: true });
}

function getPinPropertiesEmptyState(page: Page): Locator {
  return page.getByText("Select a pin to edit its properties", {
    exact: true,
  });
}

async function gotoLibrary(page: Page) {
  await page.goto("/#library");
  await expect(page.getByText("Component Library", { exact: true })).toBeVisible();
}

async function openNewComponentWizard(page: Page) {
  await gotoLibrary(page);
  await getNewButton(page).click();
  await expect(getWizardTitle(page)).toBeVisible();
}

async function gotoWizardSymbolStep(page: Page) {
  await openNewComponentWizard(page);
  await expect(getWizardStepLabel(page)).toBeVisible();
  await expect(getSymbolEditorCanvas(page)).toBeVisible();
  await expect(getPinTypesHeading(page)).toBeVisible();
  await expect(getPinPropertiesHeading(page)).toBeVisible();
  await expect(getSymbolInfoHeading(page)).toBeVisible();
  await expect(getPinPropertiesEmptyState(page)).toBeVisible();
  await expect(getNextButton(page)).toBeVisible();
}

async function gotoWizardSpecsStep(page: Page) {
  await gotoWizardSymbolStep(page);

  await getNextButton(page).click();
  await getNextButton(page).click();
  await getNextButton(page).click();

  await expect(getBackButton(page)).toBeVisible();
  await expect(getSaveComponentButton(page)).toBeVisible();
}

test.describe("component wizard symbol editor entry", () => {
  test("opens the real library wizard at the Symbol step", async ({ page }) => {
    await gotoWizardSymbolStep(page);
  });
});

test.describe("component wizard symbol editor pin placement parity", () => {
  test.fixme(
    "wizard: click-add pin places exactly one pin and opens properties",
    async ({ page }) => {
      await gotoWizardSymbolStep(page);
      await expect(getPinTypesHeading(page)).toBeVisible();
      await expect(getPinPropertiesHeading(page)).toBeVisible();
      await expect(getPinPropertiesEmptyState(page)).toBeVisible();
    },
  );

  test.fixme(
    "wizard: drag-drop pin places exactly one pin at drop point",
    async ({ page }) => {
      await gotoWizardSymbolStep(page);
      await expect(getPinTypesHeading(page)).toBeVisible();
      await expect(getSymbolEditorCanvas(page)).toBeVisible();
      await expect(getPinPropertiesEmptyState(page)).toBeVisible();
    },
  );
});

test.describe("component wizard symbol editor drawing tools", () => {
  test.fixme("wizard: drawing tools work in the real symbol step", async ({
    page,
  }) => {
    await gotoWizardSymbolStep(page);
    await expect(getSymbolEditorCanvas(page)).toBeVisible();
    await expect(getNextButton(page)).toBeVisible();
  });
});

test.describe("component wizard symbol editor selection edit and delete", () => {
  test.fixme("wizard: selection edit and delete stay in sync", async ({
    page,
  }) => {
    await gotoWizardSymbolStep(page);
    await expect(getPinPropertiesHeading(page)).toBeVisible();
    await expect(getPinPropertiesEmptyState(page)).toBeVisible();
  });
});

test.describe("component wizard symbol editor persistence", () => {
  test.fixme(
    "wizard: state survives Next Back and publishes correctly",
    async ({ page }) => {
      await gotoWizardSpecsStep(page);
      await getBackButton(page).click();
      await expect(getWizardStepLabel(page)).toBeVisible();
      await expect(getSymbolInfoHeading(page)).toBeVisible();
    },
  );
});
