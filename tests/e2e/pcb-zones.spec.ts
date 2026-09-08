import { expect, test, type Page } from "@playwright/test";

/**
 * E2E for the zone (Z) / keepout (K) authoring tools (Session 3b, contract
 * §12.3): draw + commit, the options bar, ring-validity rejection keeping the
 * sketch open, edge-select + delete, and the board-zone (copper fill) toggle
 * going through the undo stack. Each test creates its own design.
 */

const UNDO_KEY = process.platform === "darwin" ? "Meta+z" : "Control+z";

/**
 * Creates a design and opens its PCB tab. Returns the design's id captured
 * straight from the create response — the backend's `/active-design` pointer
 * is process-global, not per-browser-context, so it is unsafe to read under
 * parallel test workers (another test's page can overwrite it in between).
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
  // A freshly-created design can leave focus on the editable tab-title input;
  // the tools' hotkeys are ignored while an <input> is focused, so click the
  // canvas (empty space, no-op select-clear) to move focus off it first.
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

test.describe("pcb zones and keepouts", () => {
  test("draws a zone via the Add dropdown and it survives a reload", async ({
    page,
  }) => {
    const { canvas, designId } = await newPcbDesign(page);

    await page.getByRole("button", { name: "Add" }).click();
    await page.locator('button[title*="Draw copper zone"]').click();

    const options = page.locator('[data-testid="area-tool-options"]');
    await expect(options).toBeVisible();

    await canvas.click({ position: { x: 300, y: 220 } });
    await canvas.click({ position: { x: 420, y: 220 } });
    await canvas.click({ position: { x: 420, y: 300 } });
    await canvas.click({ position: { x: 300, y: 300 } });
    await page.keyboard.press("Enter");

    await expect(options).toBeHidden();
    await expect(page.getByRole("button", { name: "Add" })).toBeVisible();
    await expect(page.getByTitle("Zone", { exact: true })).toBeVisible();

    await expect
      .poll(async () => (await pcbProjection(page, designId)).zones.length)
      .toBe(1);

    // Reload lands back on Home (the open designer tab is not a URL route).
    // The tab set is persisted per browser context (zustand-persist), so
    // re-entering the Designer module restores this test's own tab without
    // touching any design another parallel test may have created.
    await page.reload();
    await page.getByRole("button", { name: "Designer" }).click();
    await page.getByRole("tab", { name: "PCB" }).click();
    await expect(canvas).toBeVisible();
    const projection = await pcbProjection(page, designId);
    expect(projection.zones.length).toBe(1);
  });

  test("draws a keepout via the K hotkey with all restrictions forbidden", async ({
    page,
  }) => {
    const { canvas, designId } = await newPcbDesign(page);

    await canvas.focus().catch(() => {});
    await page.keyboard.press("k");

    const options = page.locator('[data-testid="area-tool-options"]');
    await expect(options).toBeVisible();
    for (const label of [
      "Forbid Tracks",
      "Forbid Vias",
      "Forbid Pads",
      "Forbid Copper pour",
      "Forbid Footprints",
    ]) {
      await expect(page.getByLabel(label)).toBeChecked();
    }

    await canvas.click({ position: { x: 300, y: 220 } });
    await canvas.click({ position: { x: 420, y: 220 } });
    await canvas.click({ position: { x: 360, y: 300 } });
    await page.keyboard.press("Enter");

    await expect(options).toBeHidden();
    await expect(page.getByTitle("Keepout", { exact: true })).toBeVisible();

    const projection = await pcbProjection(page, designId);
    expect(projection.keepouts.length).toBe(1);
    expect(projection.keepouts[0].restrictions).toEqual({
      tracks: true,
      vias: true,
      pads: true,
      copperPour: true,
      footprints: true,
    });
  });

  test("an invalid (self-crossing) ring keeps the sketch open", async ({
    page,
  }) => {
    const { canvas } = await newPcbDesign(page);

    await canvas.focus().catch(() => {});
    await page.keyboard.press("z");
    const options = page.locator('[data-testid="area-tool-options"]');
    await expect(options).toBeVisible();

    // Bow-tie: crossing order.
    await canvas.click({ position: { x: 300, y: 220 } });
    await canvas.click({ position: { x: 420, y: 300 } });
    await canvas.click({ position: { x: 420, y: 220 } });
    await canvas.click({ position: { x: 300, y: 300 } });
    await page.keyboard.press("Enter");

    const error = page.locator('[data-testid="area-tool-error"]');
    await expect(error).toBeVisible();
    await expect(error).toContainText("crosses itself");
    await expect(options).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(options).toBeHidden();
  });

  test("selects a zone by its edge and deletes it", async ({ page }) => {
    const { canvas, designId } = await newPcbDesign(page);

    await canvas.focus().catch(() => {});
    await page.keyboard.press("z");
    await canvas.click({ position: { x: 300, y: 220 } });
    await canvas.click({ position: { x: 420, y: 220 } });
    await canvas.click({ position: { x: 420, y: 300 } });
    await canvas.click({ position: { x: 300, y: 300 } });
    await page.keyboard.press("Enter");
    await expect(page.getByTitle("Zone", { exact: true })).toBeVisible();

    // Clear selection, then re-select by clicking the top edge's midpoint.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Edit" }).first()).toBeVisible();

    // The edge hit-test tolerance is tight (0.2 mm); retry the click in case
    // the first attempt lands a pixel outside it.
    await expect(async () => {
      await canvas.click({ position: { x: 360, y: 220 } });
      await expect(page.getByTitle("Zone", { exact: true })).toBeVisible({
        timeout: 1_000,
      });
    }).toPass({ timeout: 10_000 });

    await page.keyboard.press("Delete");
    await expect(page.getByRole("button", { name: "Edit" }).first()).toBeVisible();

    await expect
      .poll(async () => (await pcbProjection(page, designId)).zones.length)
      .toBe(0);
  });

  test("a route through a tracks keepout is flagged and blocked at commit", async ({
    page,
  }) => {
    const { canvas, designId } = await newPcbDesign(page);

    // Keepout over the middle band (every restriction forbidden by default).
    await canvas.focus().catch(() => {});
    await page.keyboard.press("k");
    const options = page.locator('[data-testid="area-tool-options"]');
    await expect(options).toBeVisible();
    await canvas.click({ position: { x: 300, y: 220 } });
    await canvas.click({ position: { x: 420, y: 220 } });
    await canvas.click({ position: { x: 420, y: 300 } });
    await canvas.click({ position: { x: 300, y: 300 } });
    await page.keyboard.press("Enter");
    await expect(options).toBeHidden();
    await expect
      .poll(async () => (await pcbProjection(page, designId)).keepouts.length)
      .toBe(1);

    // Route INTO the keepout. The head end sits inside the obstacle, so
    // walkaround declines to detour and the straight ghost is DRC-checked.
    await page.keyboard.press("Escape");
    const routeButton = page.getByRole("button", { name: "Route (R)" });
    await routeButton.click();
    await expect(page.getByRole("button", { name: "45°" })).toBeVisible();
    const status = page.getByRole("region", { name: "Route status" });
    await canvas.click({ position: { x: 250, y: 260 } });
    await canvas.hover({ position: { x: 360, y: 260 } });
    await expect(status).toContainText(/\d+ conflicts?/);

    // Finishing inside the keepout is refused; nothing is persisted.
    await page.keyboard.press("Enter");
    await expect(
      page.getByText(/Commit blocked: \d+ DRC conflict/),
    ).toBeVisible();
    await expect
      .poll(async () => (await pcbProjection(page, designId)).traces.length)
      .toBe(0);

    // Routing clear of the keepout is clean and commits. One Esc cancels the
    // blocked session; the Route tool itself stays active.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "45°" })).toBeVisible();
    await canvas.click({ position: { x: 250, y: 380 } });
    await canvas.hover({ position: { x: 470, y: 380 } });
    await expect(status).toContainText("clear");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Commit blocked/)).toBeHidden();
    await expect
      .poll(async () => (await pcbProjection(page, designId)).traces.length)
      .toBe(1);
  });

  test("the board-zone (copper fill) toggle is undoable", async ({
    page,
  }) => {
    const { canvas, designId } = await newPcbDesign(page);

    const toggle = page.locator('[data-testid="copper-fill-toggle-F.Cu"]');
    await expect(toggle).toBeVisible();
    await toggle.click();

    await expect(
      page.getByRole("button", { name: /Remove redundant pour traces/ }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const p = await pcbProjection(page, designId);
        return p.zones.find((z: { id: string }) => z.id === "board:F.Cu")
          ?.enabled;
      })
      .toBe(true);

    // Second click disables the board zone (does not remove it).
    await toggle.click();
    await expect
      .poll(async () => {
        const p = await pcbProjection(page, designId);
        return p.zones.find((z: { id: string }) => z.id === "board:F.Cu")
          ?.enabled;
      })
      .toBe(false);

    await canvas.focus().catch(() => {});
    await page.keyboard.press(UNDO_KEY);
    await expect
      .poll(async () => {
        const p = await pcbProjection(page, designId);
        return p.zones.find((z: { id: string }) => z.id === "board:F.Cu")
          ?.enabled;
      })
      .toBe(true);
  });
  /**
   * Zone cutouts (docs/pcb-hardening/04-copper-pour-contract.md §11). The pour
   * itself is computed client-side inside the R3F canvas and is not exposed on
   * any route, so the assertion is on the persisted region — the one input the
   * fill kernel clips with (`clipHolesMm`), pinned by the kernel's own tests.
   */
  test("Shift+Z cuts a hole in the selected zone", async ({ page }) => {
    const { canvas, designId } = await newPcbDesign(page);

    await canvas.focus().catch(() => {});
    await page.keyboard.press("z");
    const options = page.locator('[data-testid="area-tool-options"]');
    await expect(options).toBeVisible();
    await canvas.click({ position: { x: 280, y: 200 } });
    await canvas.click({ position: { x: 440, y: 200 } });
    await canvas.click({ position: { x: 440, y: 320 } });
    await canvas.click({ position: { x: 280, y: 320 } });
    await page.keyboard.press("Enter");

    // The new zone is selected on commit, so the cutout mode has its subject.
    await expect(page.getByTitle("Zone", { exact: true })).toBeVisible();
    await expect
      .poll(async () => (await pcbProjection(page, designId)).zones.length)
      .toBe(1);

    await page.keyboard.press("Shift+Z");
    await expect(options).toBeVisible();
    await expect(page.getByLabel("Cutout")).toBeChecked();

    await canvas.click({ position: { x: 330, y: 240 } });
    await canvas.click({ position: { x: 390, y: 240 } });
    await canvas.click({ position: { x: 390, y: 280 } });
    await canvas.click({ position: { x: 330, y: 280 } });
    await page.keyboard.press("Enter");

    await expect(options).toBeHidden();
    await expect
      .poll(async () => {
        const p = await pcbProjection(page, designId);
        return p.zones[0]?.region?.holesMm?.length ?? 0;
      })
      .toBe(1);
    await expect(page.getByTestId("zone-cutout-count")).toHaveText("1");
  });

  test("Shift+Z with nothing selected refuses with a notice", async ({
    page,
  }) => {
    const { canvas } = await newPcbDesign(page);
    await canvas.focus().catch(() => {});
    await page.keyboard.press("Shift+Z");
    const notice = page.locator('[data-testid="pcb-tool-notice"]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Select one unlocked polygon zone");
    await expect(
      page.locator('[data-testid="area-tool-options"]'),
    ).toBeHidden();
  });
});
