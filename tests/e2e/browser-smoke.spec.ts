import { expect, test } from "@playwright/test";

test("boots browser app, loads modules, and opens designer", async ({ page, request }) => {
  const registryResponse = await request.get("/api/modules/registry");
  expect(registryResponse.ok()).toBeTruthy();

  const registry = (await registryResponse.json()) as {
    modules?: Array<{ id: string; status: string }>;
  };
  expect(registry.modules).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "library", status: "loaded" }),
      expect.objectContaining({ id: "designer", status: "loaded" }),
    ]),
  );

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Designs" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Designer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Library" })).toBeVisible();

  await page.getByRole("button", { name: "Designer" }).click();
  await expect(page.getByRole("tab", { name: "Schem" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "PCB" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No design open" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New design" })).toBeVisible();
});

test("creates a design from home and renders schematic shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Designs" })).toBeVisible();

  await page.getByRole("button", { name: "New Design" }).first().click();

  await expect(page.getByRole("tab", { name: "Schem" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Untitled Design|No design/ })).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
});
