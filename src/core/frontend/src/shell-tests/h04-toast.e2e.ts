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

test("Designer handled errors use the root notice host and persist until dismissed", async ({
  page,
}) => {
  await page.route(/\/src\/AppRouter\.tsx(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export { DesignerToastFixture as AppRouter } from '/@fs${repoRoot}/src/modules/designer/frontend/hooks/designer-toast.fixture.tsx';`,
    }),
  );
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/registry")
        ? { modules: [] }
        : { ok: true },
    }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Trigger handled error", exact: true })
    .click();
  const notices = page.getByRole("region", { name: "Notifications" });
  await expect(notices).toHaveCount(1);
  await expect(notices.getByRole("alert")).toHaveText(
    "Placement fixture failed",
  );
  await page.clock.install();
  await page.clock.fastForward(60000);
  await expect(notices.getByRole("alert")).toHaveText(
    "Placement fixture failed",
  );
  await page
    .getByRole("button", {
      name: "Trigger explicit-duration error",
      exact: true,
    })
    .click();
  await page.clock.fastForward(60000);
  await expect(notices.getByRole("alert")).toHaveCount(2);
  await expect(page.getByLabel("Adapter toast count")).toHaveText("2");
  await page
    .getByRole("button", { name: "Remove last adapter toast", exact: true })
    .click();
  await expect(notices.getByRole("alert")).toHaveCount(1);
  await notices
    .getByRole("button", { name: "Dismiss notification", exact: true })
    .click();
  await expect(notices.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Adapter toast count")).toHaveText("0");
  await page
    .getByRole("button", { name: "Trigger transient notice", exact: true })
    .click();
  await expect(notices.getByRole("status")).toHaveText("Transient fixture");
  await page.clock.fastForward(101);
  await expect(notices.getByRole("status")).toHaveCount(0);
});

test("notice timers stay paused until both hover and focus leave", async ({
  page,
}) => {
  await page.route(/\/src\/AppRouter\.tsx(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export { DesignerToastFixture as AppRouter } from '/@fs${repoRoot}/src/modules/designer/frontend/hooks/designer-toast.fixture.tsx';`,
    }),
  );
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/registry")
        ? { modules: [] }
        : { ok: true },
    }),
  );
  await page.goto("/");
  const clockTime = new Date("2026-10-05T12:00:00Z");
  await page.clock.install({ time: clockTime });
  await page.clock.pauseAt(clockTime);
  const trigger = page.getByRole("button", {
    name: "Trigger long transient notice",
    exact: true,
  });
  await trigger.click();
  const notice = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("status");
  await expect(notice).toHaveText("Long transient fixture");
  await page.clock.fastForward(400);
  await notice.hover();
  await notice.getByRole("button", { name: "Dismiss notification" }).focus();
  await page.mouse.move(300, 150);
  await page.clock.fastForward(5000);
  await expect(notice).toBeVisible();
  await notice.hover();
  await trigger.focus();
  await page.clock.fastForward(5000);
  await expect(notice).toBeVisible();
  await page.mouse.move(300, 150);
  await page.clock.fastForward(599);
  await expect(notice).toBeVisible();
  await page.clock.fastForward(1);
  await expect(notice).toHaveCount(0);
});

test("unmounting a hovered and focused viewport releases remaining expiry", async ({
  page,
}) => {
  await page.route(/\/src\/App\.tsx(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export { ToastUnmountFixture as App } from '/src/shell-tests/toast-unmount.fixture.tsx';`,
    }),
  );
  await page.goto("/");
  const clockTime = new Date("2026-10-05T12:00:00Z");
  await page.clock.install({ time: clockTime });
  await page.clock.pauseAt(clockTime);
  await page
    .getByRole("button", { name: "Trigger notice", exact: true })
    .click();
  const notice = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("status");
  await page.clock.fastForward(400);
  await notice.hover();
  await notice.getByRole("button", { name: "Dismiss notification" }).focus();
  await page.clock.fastForward(5000);
  await expect(page.getByLabel("Stored notice count")).toHaveText("1");
  await page
    .getByRole("button", { name: "Toggle notifications" })
    .evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.getByRole("region", { name: "Notifications" })).toHaveCount(
    0,
  );
  await page.clock.fastForward(599);
  await expect(page.getByLabel("Stored notice count")).toHaveText("1");
  await page.clock.fastForward(1);
  await expect(page.getByLabel("Stored notice count")).toHaveText("0");
});
