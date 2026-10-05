import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

async function boot(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route(
    /^https?:\/\/(?!127\.0\.0\.1(?::\d+)?\/|localhost(?::\d+)?\/)/,
    (route) => route.abort(),
  );
  await page.route(/\/src\/cloud\/config\.ts(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "export function readCloudConfig(){return {enabled:false}}",
    }),
  );
  await page.route(/\/src\/AppRouter\.tsx(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export {CapabilityFixture as AppRouter} from '/@fs${repoRoot}/src/modules/designer/frontend/capability-quarantine.fixture.tsx';`,
    }),
  );
  await page.route("**/api/**", (route) => {
    const url = route.request().url();
    requests.push(url);
    return route.fulfill({
      json: url.endsWith("/inspect")
        ? {
            data: {
              report: {
                projectName: "Inspected fixture",
                copperLayerCount: 2,
                schematicSheetCount: 1,
                netCount: 0,
                boardOutlineMm: null,
                components: [],
                counts: {},
                netClasses: [],
                warnings: [],
              },
            },
          }
        : { modules: [] },
    });
  });
  await page.goto("/");
  return requests;
}

test("blocked manufacturing performs no DRC/export request; project inspect stays available with commit disabled", async ({
  page,
}) => {
  const requests = await boot(page);
  const exportDialog = page.getByRole("dialog", {
    name: "Manufacturing exports unavailable",
  });
  await expect(exportDialog).toBeVisible();
  await expect(
    exportDialog.getByRole("button", { name: "Download ZIP" }),
  ).toBeDisabled();
  await expect(exportDialog).toContainText(
    "DRC acknowledgement does not override",
  );
  expect(requests.filter((url) => /exports|\/drc/.test(url))).toEqual([]);
  await exportDialog
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Inspect KiCad project" }).click();
  const wizard = page.getByRole("dialog", { name: "Import KiCad project" });
  await expect(wizard).toContainText("inspection does not create a design");
  await wizard.locator('input[type="file"]').setInputFiles({
    name: "fixture.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("mocked inspection fixture"),
  });
  await expect(
    wizard.getByRole("button", { name: "Import design" }),
  ).toBeDisabled();
  expect(
    requests.filter((url) => /\/imports\/kicad-project$/.test(url)),
  ).toEqual([]);
  expect(
    requests.filter((url) => url.endsWith("/imports/kicad-project/inspect")),
  ).toHaveLength(1);
});
