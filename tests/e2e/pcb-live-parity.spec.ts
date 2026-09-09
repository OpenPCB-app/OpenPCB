import { expect, test, type Page } from "@playwright/test";

/**
 * E2E for the live-parity contract's route-tool surface (S8,
 * docs/pcb-hardening/07-live-parity-contract.md §8): the ghost's live conflict
 * count, the commit gate blocking on it, the DRC-override escape hatch, and a
 * free NPTH hole blocking the same way. Harness copied from pcb-zones.spec.ts.
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
 * The route tool's walkaround (pcb.routeWalkaround) auto-detours around a
 * plain clearance conflict — a bare via or a lone NPTH hole leaves it room to
 * route around, so only pcb-zones.spec.ts's proven "no room to detour"
 * geometry (a keepout the head end lands inside) reliably forces the ghost's
 * "N conflict(s)" status headlessly. Each scenario below wraps its real
 * obstacle (a committed trace / a free hole) in a `tracks`-forbidden keepout
 * of that same shape, so the reported conflict set is the keepout's
 * KEEPOUT_VIOLATION together with the wrapped obstacle's own code — see
 * DEVIATIONS.
 */
async function drawKeepoutTrap(page: Page, canvas: ReturnType<Page["locator"]>) {
  const options = page.locator('[data-testid="area-tool-options"]');
  await expect(async () => {
    await canvas.focus().catch(() => {});
    await page.keyboard.press("k");
    await expect(options).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await canvas.click({ position: { x: 300, y: 220 } });
  await canvas.click({ position: { x: 420, y: 220 } });
  await canvas.click({ position: { x: 420, y: 300 } });
  await canvas.click({ position: { x: 300, y: 300 } });
  await page.keyboard.press("Enter");
  await expect(options).toBeHidden();
  await page.keyboard.press("Escape");
}

test.describe("pcb live-parity gate", () => {
  // Both routes below start on empty canvas, so they are net-less — and
  // under the S8 extension rule (07 §4) a null-net route touching one NAMED
  // trace is an "extension" of it, not a conflict. So the committed trace
  // this test draws first contributes NOTHING to the blocked verdict; only
  // the keepout trap does. Named for what it actually proves: the live
  // gate's blocked → override → commit flow through the HUD, not a
  // trace-clearance conflict specifically. (Two independent attempts to
  // drive the Smart-Via hotkey through Playwright's synthetic pointer events
  // either dropped the via or hung the page, which is why this uses a
  // committed trace instead of a via at all — see DEVIATIONS.)
  test("a route blocked by the live gate is refused at commit and commits with the override", async ({
    page,
  }) => {
    const { canvas, designId } = await newPcbDesign(page);

    const routeButton = page.getByRole("button", { name: "Route (R)" });
    await canvas.focus().catch(() => {});
    await routeButton.click();
    await expect(page.getByRole("button", { name: "45°" })).toBeVisible();
    await canvas.click({ position: { x: 340, y: 260 } });
    await canvas.hover({ position: { x: 380, y: 260 } });
    await page.keyboard.press("Enter");
    await expect(routeButton).toBeVisible();
    await expect
      .poll(async () => (await pcbProjection(page, designId)).traces.length)
      .toBe(1);

    await drawKeepoutTrap(page, canvas);
    await expect
      .poll(async () => (await pcbProjection(page, designId)).keepouts.length)
      .toBe(1);

    // Route into the trap — the head end sits inside it, so walkaround
    // declines and the straight ghost is DRC-checked as drawn.
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
    const beforeCommit = await pcbProjection(page, designId);
    expect(beforeCommit.traces.length).toBe(1);

    // The override toggles legality to "report"; the same ghost now commits.
    await page.getByRole("button", { name: "allow violations" }).click();
    await expect(page.getByText(/DRC override ON/)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Commit blocked/)).toBeHidden();
    await expect
      .poll(async () => (await pcbProjection(page, designId)).traces.length)
      .toBe(2);
  });

  test("a route into a free NPTH hole is flagged and blocked at commit", async ({
    page,
  }) => {
    const { canvas, designId } = await newPcbDesign(page);

    // A free NPTH hole at the trap's centre.
    await canvas.focus().catch(() => {});
    await page.keyboard.press("h");
    await canvas.click({ position: { x: 360, y: 260 } });
    await expect
      .poll(async () => (await pcbProjection(page, designId)).freeHoles.length)
      .toBe(1);
    await page.keyboard.press("Escape");

    await drawKeepoutTrap(page, canvas);
    await expect
      .poll(async () => (await pcbProjection(page, designId)).keepouts.length)
      .toBe(1);

    const routeButton = page.getByRole("button", { name: "Route (R)" });
    await routeButton.click();
    await expect(page.getByRole("button", { name: "45°" })).toBeVisible();
    const status = page.getByRole("region", { name: "Route status" });
    await canvas.click({ position: { x: 250, y: 260 } });
    await canvas.hover({ position: { x: 360, y: 260 } });
    // COPPER_TO_HOLE is net-independent (unlike the keepout's own tier, it
    // fires regardless of the route's net) — a count of at least 2 proves the
    // hole's own code participates alongside the keepout, not just the trap.
    await expect(status).toContainText(/([2-9]|\d{2,}) conflicts?/);

    await page.keyboard.press("Enter");
    await expect(
      page.getByText(/Commit blocked: \d+ DRC conflict/),
    ).toBeVisible();
    await expect
      .poll(async () => (await pcbProjection(page, designId)).traces.length)
      .toBe(0);
  });
});
