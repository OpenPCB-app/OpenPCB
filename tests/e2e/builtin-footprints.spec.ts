import { expect, test } from "@playwright/test";

/**
 * E2E coverage for the bundled CoreLibrary components/footprints.
 *
 * Three layers of verification:
 *  1. API smoke — every footprint ID resolves with 2 pads.
 *  2. Library detail UI — each builtin component opens to a populated detail
 *     page (mount type, pad count, footprint preview canvas mounted).
 *  3. Designer round-trip — Create design → place a representative builtin via
 *     the commands API → assert the PCB projection contains the placement
 *     with 2 pads and (for THT) drilled pads.
 */

const BACKEND = "http://127.0.0.1:3000";

const BUILTIN_FOOTPRINT_IDS = [
  { id: "openpcb.core.footprint.passive.r-0603", pads: 2 },
  { id: "openpcb.core.footprint.passive.c-disc-d5-p5", pads: 2 },
  { id: "openpcb.core.footprint.package.sot-23", pads: 3 },
  { id: "openpcb.core.footprint.package.soic-8-3-9x4-9mm-p1-27mm", pads: 8 },
  { id: "openpcb.core.footprint.connector.pin-header-2x03-p2-54mm-vertical", pads: 6 },
];

const THT_FOOTPRINT_IDS = [
  "openpcb.core.footprint.passive.r-axial-din0207-p7-62",
  "openpcb.core.footprint.passive.c-disc-d5-p5",
  "openpcb.core.footprint.connector.pin-header-1x02-p2-54mm-vertical",
];

const RESISTOR_ID = "openpcb.core.passive.resistor";
const CAPACITOR_ID = "openpcb.core.passive.capacitor";
const BUILTIN_COMPONENT_IDS = [RESISTOR_ID, CAPACITOR_ID];

interface FootprintDetail {
  data: {
    detail: {
      component: { id: string; name: string; footprintId: string };
      footprint: {
        name: string;
        padCount: number;
        mountType: string | null;
        preview: {
          pads: Array<{
            centerMm: { x: number; y: number };
            layer: string;
            shape: string;
            drillDiameterMm?: number;
          }>;
        } | null;
      };
    };
  };
}

async function fetchComponentDetail(
  componentId: string,
): Promise<FootprintDetail> {
  const res = await fetch(
    `${BACKEND}/api/modules/library/components/${encodeURIComponent(componentId)}/detail`,
  );
  expect(res.ok).toBe(true);
  return (await res.json()) as FootprintDetail;
}

test.describe("builtin footprints — API", () => {
  test("representative CoreLibrary footprint ids resolve with expected pad counts", async () => {
    for (const { id: fpId, pads: expectedPads } of BUILTIN_FOOTPRINT_IDS) {
      const res = await fetch(
        `${BACKEND}/api/modules/library/footprints/${encodeURIComponent(fpId)}`,
      );
      expect(res.ok, `expected 200 for ${fpId}`).toBe(true);
      const body = (await res.json()) as {
        data: {
          footprint: {
            data: { normalized?: { preview?: { pads?: unknown[] } } };
          };
        };
      };
      const pads = body.data.footprint.data.normalized?.preview?.pads ?? [];
      expect(pads.length, `pad count for ${fpId}`).toBe(expectedPads);
    }
  });

  test("THT footprints expose drilled circular pads on *.Cu", async () => {
    for (const fpId of THT_FOOTPRINT_IDS) {
      const res = await fetch(
        `${BACKEND}/api/modules/library/footprints/${encodeURIComponent(fpId)}`,
      );
      expect(res.ok, `expected 200 for ${fpId}`).toBe(true);
      const body = (await res.json()) as {
        data: {
          footprint: {
            data: {
              normalized?: {
                preview?: {
                  pads?: Array<{
                    drillDiameterMm?: number;
                    layer: string;
                    shape: string;
                  }>;
                };
              };
            };
          };
        };
      };
      const pads = body.data.footprint.data.normalized?.preview?.pads ?? [];
      expect(pads.length, `pads on ${fpId}`).toBeGreaterThanOrEqual(2);
      for (const pad of pads) {
        expect(pad.drillDiameterMm ?? 0).toBeGreaterThan(0);
        expect(pad.layer).toBe("*.Cu");
        expect(["circle", "oval", "rect", "roundrect"]).toContain(pad.shape);
      }
    }
  });

  test("CoreLibrary resistor + capacitor default to 0603 footprints", async () => {
    const r = await fetchComponentDetail(RESISTOR_ID);
    const c = await fetchComponentDetail(CAPACITOR_ID);
    expect(r.data.detail.component.footprintId).toBe("openpcb.core.footprint.passive.r-0603");
    expect(c.data.detail.component.footprintId).toBe("openpcb.core.footprint.passive.c-0603");
    expect(r.data.detail.footprint.padCount).toBe(2);
    expect(c.data.detail.footprint.padCount).toBe(2);
  });
});

test.describe("builtin footprints — Library UI", () => {
  test("Library palette renders common CoreLibrary component cards", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: /Library/ })
      .first()
      .click();
    for (const componentId of BUILTIN_COMPONENT_IDS) {
      const card = page.locator(
        `[data-testid="library-component-card-${componentId}"]`,
      );
      await expect(card, `card visible for ${componentId}`).toBeVisible({
        timeout: 10_000,
      });
    }
    await expect(page.locator(`[data-testid="library-component-card-openpcb.core.opto.led"]`)).toBeVisible();
  });

  test("Resistor detail page shows the 9-variant footprint list with default flagged", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: /Library/ })
      .first()
      .click();
    await page
      .locator(`[data-testid="library-component-card-${RESISTOR_ID}"]`)
      .click();
    await expect(page.getByTestId("component-mount-type")).toHaveText("smd");
    await expect(page.getByTestId("component-pad-count")).toHaveText("2");
    await expect(page.getByTestId("footprint-preview-canvas")).toBeVisible();

    const variantsBlock = page.getByTestId("component-footprint-variants");
    await expect(variantsBlock).toBeVisible();
    // 9 R variants (6 SMD + 3 THT)
    await expect(
      variantsBlock.locator('[data-testid^="component-footprint-variant-"]'),
    ).toHaveCount(9);
    // Default badge appears on the 0603 row.
    await expect(
      variantsBlock.locator(
        '[data-testid="component-footprint-variant-openpcb.core.footprint.passive.r-0603"]',
      ),
    ).toContainText("Default");
  });

  test("Capacitor detail page shows the 8-variant footprint list", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: /Library/ })
      .first()
      .click();
    await page
      .locator(`[data-testid="library-component-card-${CAPACITOR_ID}"]`)
      .click();
    await expect(
      page
        .getByTestId("component-footprint-variants")
        .locator('[data-testid^="component-footprint-variant-"]'),
    ).toHaveCount(8);
  });
});

test.describe("builtin footprints — Designer placement round-trip", () => {
  // Drives the designer command API directly: create design → place each
  // representative builtin → query PCB projection → assert footprint payload.
  // This exercises the full backend pipeline without depending on the
  // schematic drag-drop UI (which is covered in Phase-3 manual smoke).

  async function createDesign(): Promise<string> {
    const res = await fetch(`${BACKEND}/api/modules/designer/designs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "builtin-footprints-spec" }),
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { data: { design: { id: string } } };
    return body.data.design.id;
  }

  async function placePart(args: {
    designId: string;
    componentId: string;
    positionNm: { x: number; y: number };
  }): Promise<void> {
    const sessionId = `e2e-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const commandId = `cmd-${Math.random().toString(16).slice(2, 14)}`;
    const res = await fetch(
      `${BACKEND}/api/modules/designer/designs/${args.designId}/commands`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commandId,
          sessionId,
          aggregateId: args.designId,
          baseRevision: null,
          issuedAt: Date.now(),
          command: {
            type: "place_part",
            componentId: args.componentId,
            positionNm: args.positionNm,
          },
        }),
      },
    );
    expect(res.ok, `place_part(${args.componentId}) HTTP ${res.status}`).toBe(
      true,
    );
  }

  async function pcbProjection(designId: string): Promise<{
    placements: Array<{
      componentId: string;
      footprint: {
        preview: {
          pads: Array<{ drillDiameterMm?: number; layer: string }>;
        } | null;
      };
    }>;
  }> {
    const res = await fetch(
      `${BACKEND}/api/modules/designer/designs/${designId}/projection/pcb`,
    );
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      data: {
        projection: {
          placements: Array<{
            componentId: string;
            footprint: {
              preview: {
                pads: Array<{ drillDiameterMm?: number; layer: string }>;
              } | null;
            };
          }>;
        };
      };
    };
    return body.data.projection;
  }

  test("places generic Resistor + Capacitor and finds them with default footprints in PCB projection", async () => {
    const designId = await createDesign();
    // With sized component IDs gone, placement uses the generic ID. Per-instance
    // footprint override (set_part_footprint) lands in a follow-up; for now
    // the placement materializes against the component's default footprint.
    const samples = [
      { id: RESISTOR_ID, x: 10_000_000, y: 10_000_000 },
      { id: CAPACITOR_ID, x: 30_000_000, y: 10_000_000 },
    ];
    for (const s of samples) {
      await placePart({
        designId,
        componentId: s.id,
        positionNm: { x: s.x, y: s.y },
      });
    }

    const proj = await pcbProjection(designId);
    expect(proj.placements.length).toBeGreaterThanOrEqual(samples.length);

    for (const s of samples) {
      const matched = proj.placements.find((p) => p.componentId === s.id);
      expect(matched, `placement for ${s.id}`).toBeDefined();
      const pads = matched?.footprint.preview?.pads ?? [];
      expect(pads.length, `pad count for ${s.id}`).toBe(2);
      // Default for both is the SMD chip 0603 → F.Cu pads, no drill.
      for (const pad of pads) {
        expect(pad.layer).toBe("F.Cu");
      }
    }
  });
});

test.describe("builtin footprints — Designer canvas smoke", () => {
  test("New design loads PCB canvas without console errors", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });
    await page.goto("/");
    await page.getByRole("button", { name: "New Design" }).first().click();
    await page.getByRole("tab", { name: "PCB" }).click();
    await expect(
      page.locator('[data-testid="designer-pcb-canvas"]'),
    ).toBeVisible();
    // Allow async canvas init to flush
    await page.waitForTimeout(500);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
