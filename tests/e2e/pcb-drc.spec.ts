import { expect, test, type Page } from "@playwright/test";

/**
 * E2E for the asynchronous batch DRC run surface (execution contract 09 §7):
 * the DRC dock's "Run DRC" button drives `POST /drc/runs` + the SSE stream,
 * the finished report lists the keepout violation the board really has, and
 * editing the board afterwards raises the stale banner.
 *
 * Harness copied from pcb-zones.spec.ts / pcb-live-parity.spec.ts.
 */

async function newPcbDesign(
  page: Page,
): Promise<{ canvas: ReturnType<Page["locator"]>; designId: string }> {
  await page.goto("/");
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes("/api/modules/designer/designs") &&
        res.request().method() === "POST",
    ),
    page.getByRole("button", { name: "New Design" }).first().click(),
  ]);
  const body = (await response.json()) as { data: { design: { id: string } } };
  const designId = body.data.design.id;

  await page.getByRole("tab", { name: "PCB" }).click();
  const canvas = page.locator('[data-testid="designer-pcb-canvas"]');
  await expect(canvas).toBeVisible();
  await canvas.click({ position: { x: 40, y: 40 } });
  return { canvas, designId };
}

async function pcbProjection(page: Page, designId: string) {
  const res = await page.request.get(
    `/api/modules/designer/designs/${designId}/projection/pcb`,
  );
  const body = (await res.json()) as { data: { projection: any } };
  return body.data.projection;
}

/**
 * A `tracks`-forbidden keepout over the middle band. A route whose head end
 * lands inside it leaves walkaround no room to detour, so the straight ghost
 * is DRC-checked as drawn — the one geometry proven to force a conflict
 * headlessly (see pcb-live-parity.spec.ts).
 */
async function drawKeepoutTrap(
  page: Page,
  canvas: ReturnType<Page["locator"]>,
  offsetY = 0,
) {
  const options = page.locator('[data-testid="area-tool-options"]');
  await expect(async () => {
    await canvas.focus().catch(() => {});
    await page.keyboard.press("k");
    await expect(options).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await canvas.click({ position: { x: 300, y: 220 + offsetY } });
  await canvas.click({ position: { x: 420, y: 220 + offsetY } });
  await canvas.click({ position: { x: 420, y: 300 + offsetY } });
  await canvas.click({ position: { x: 300, y: 300 + offsetY } });
  await page.keyboard.press("Enter");
  await expect(options).toBeHidden();
  await page.keyboard.press("Escape");
}

test.describe("pcb batch DRC run", () => {
  test("runs DRC from the dock, lists the keepout violation, then goes stale", async ({
    page,
  }) => {
    const { canvas, designId } = await newPcbDesign(page);

    await drawKeepoutTrap(page, canvas);
    await expect
      .poll(async () => (await pcbProjection(page, designId)).keepouts.length)
      .toBe(1);

    // Route INTO the trap. The live gate refuses the commit, so take the
    // DRC override — the point of this test is a persisted violation to run
    // batch DRC against, not the gate itself.
    const routeButton = page.getByRole("button", { name: "Route (R)" });
    await expect(async () => {
      await routeButton.click();
      await expect(page.getByRole("button", { name: "45°" })).toBeVisible({
        timeout: 1_000,
      });
    }).toPass({ timeout: 10_000 });
    const status = page.getByRole("region", { name: "Route status" });
    await canvas.click({ position: { x: 250, y: 260 } });
    await canvas.hover({ position: { x: 360, y: 260 } });
    await expect(status).toContainText(/\d+ conflicts?/);

    await page.keyboard.press("Enter");
    await expect(
      page.getByText(/Commit blocked: \d+ DRC conflict/),
    ).toBeVisible();
    await page.getByRole("button", { name: "allow violations" }).click();
    await expect(page.getByText(/DRC override ON/)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await pcbProjection(page, designId)).traces.length)
      .toBe(1);
    await page.keyboard.press("Escape");

    // Open the DRC dock from the toolbar and run the batch check.
    // `exact`: the status-bar chip is named "<n> DRC" and would also match.
    await page.getByRole("button", { name: "DRC", exact: true }).click();
    const runButton = page.getByRole("button", { name: "Run DRC" });
    await expect(runButton).toBeVisible();

    // Pin the ASYNC path: the button must go through `POST /drc/runs` (202
    // accepted), not the old synchronous `POST /drc/run`. Waiting on the
    // response rather than on the transient progress bar / Cancel button
    // avoids racing a small board that finishes before the assertion lands.
    const started = page.waitForResponse(
      (res) => res.url().includes("/drc/runs") && res.status() === 202,
    );
    await runButton.click();
    await started;

    // The finished report lists the keepout group (drc-labels.ts:
    // KEEPOUT_VIOLATION → "Object inside keepout").
    await expect(page.getByText("Object inside keepout")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Run DRC" })).toBeEnabled();

    // Changing the board after the run raises the stale banner. A second
    // keepout in the band below is the change — the same proven gesture as the
    // first, and it needs no route commit.
    await drawKeepoutTrap(page, canvas, 120);
    await expect
      .poll(async () => (await pcbProjection(page, designId)).keepouts.length)
      .toBe(2);

    // Drawing selects the new keepout, which flips the right dock to
    // Properties; the banner lives in the DRC dock tab.
    // Two "DRC" tabs exist: the full-page design tab (exact "DRC") and the
    // dock tab, whose name carries its issue badge ("DRC 2").
    await page.getByRole("tab", { name: /^DRC \d+$/ }).click();
    await expect(
      page.getByText(/The board changed since this DRC ran/),
    ).toBeVisible();
  });
});
