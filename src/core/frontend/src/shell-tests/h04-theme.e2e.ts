import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

test.beforeEach(async ({ page }) => {
  await page.route(
    /^https?:\/\/(?!127\.0\.0\.1(?::\d+)?\/|localhost(?::\d+)?\/)/,
    (route) => route.abort(),
  );
  await page.route(/\/src\/cloud\/config\.ts(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export function readCloudConfig() { return { enabled: false, supabaseUrl: '', supabaseAnonKey: '', apiUrl: '', webUrl: '' }; }`,
    }),
  );
});

test("resolved theme reaches both demand-rendered canvases without a pointer event", async ({
  page,
}) => {
  await page.route(/\/src\/AppRouter\.tsx(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export { CanvasThemeFixture as AppRouter } from '/src/shell-tests/canvas-theme.fixture.tsx';`,
    }),
  );
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/registry")
        ? { modules: [] }
        : { ok: true },
    }),
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const frames = () => page.evaluate(() => window.__h04CanvasFrames);
  await expect.poll(async () => (await frames())?.schematic?.mode).toBe("dark");
  await expect.poll(async () => (await frames())?.pcb?.mode).toBe("dark");
  for (const mode of ["light", "dark"] as const) {
    const before = await frames();
    await page.emulateMedia({ colorScheme: mode });
    for (const kind of ["schematic", "pcb"] as const) {
      await expect.poll(async () => (await frames())?.[kind]?.mode).toBe(mode);
      await expect
        .poll(async () => (await frames())?.[kind]?.count ?? 0)
        .toBeGreaterThan(before?.[kind]?.count ?? 0);
    }
    const changed = await frames();
    for (const kind of ["schematic", "pcb"] as const) {
      const camera = before?.[kind]?.camera;
      expect(camera).toBeDefined();
      expect(Number.isFinite(camera?.zoom)).toBe(true);
      expect(Number.isFinite(camera?.x)).toBe(true);
      expect(Number.isFinite(camera?.y)).toBe(true);
      expect(changed?.[kind]?.camera).toEqual(camera);
    }
    expect(changed?.schematic?.color).not.toBe(before?.schematic?.color);
    await expect(
      page.locator('[data-testid="theme-schematic"] canvas'),
    ).toHaveCount(1);
    await expect(page.locator('[data-testid="theme-pcb"] canvas')).toHaveCount(
      1,
    );
  }
});
