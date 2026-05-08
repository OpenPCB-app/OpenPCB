import { expect, test } from "@playwright/test";

/**
 * E2E coverage for the 17 built-in footprints (SMD chip + THT axial + ceramic
 * disc) seeded by `src/modules/library/backend/builtins/footprint-seeds.ts`.
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
  "builtin:fp:r-0402-1005m",
  "builtin:fp:r-0603-1608m",
  "builtin:fp:r-0805-2012m",
  "builtin:fp:r-1206-3216m",
  "builtin:fp:r-1210-3225m",
  "builtin:fp:r-2512-6332m",
  "builtin:fp:r-axial-din0207-p7.62",
  "builtin:fp:r-axial-din0207-p10.16",
  "builtin:fp:r-axial-din0309-p12.70",
  "builtin:fp:c-0402-1005m",
  "builtin:fp:c-0603-1608m",
  "builtin:fp:c-0805-2012m",
  "builtin:fp:c-1206-3216m",
  "builtin:fp:c-1210-3225m",
  "builtin:fp:c-disc-d3-p2.5",
  "builtin:fp:c-disc-d5-p5",
  "builtin:fp:c-disc-d7.5-p5",
];

const BUILTIN_COMPONENT_IDS = ["builtin:resistor", "builtin:capacitor"];

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
  test("every builtin footprint id resolves with 2 pads", async () => {
    for (const fpId of BUILTIN_FOOTPRINT_IDS) {
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
      expect(pads.length, `pad count for ${fpId}`).toBe(2);
    }
  });

  test("THT footprints expose drilled circular pads on *.Cu", async () => {
    const thtIds = BUILTIN_FOOTPRINT_IDS.filter(
      (id) => id.includes("axial") || id.includes("disc"),
    );
    expect(thtIds.length).toBe(6);
    for (const fpId of thtIds) {
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
      expect(pads.length, `pads on ${fpId}`).toBe(2);
      for (const pad of pads) {
        expect(pad.drillDiameterMm ?? 0).toBeGreaterThan(0);
        expect(pad.layer).toBe("*.Cu");
        expect(pad.shape).toBe("circle");
      }
    }
  });

  test("Generic builtin:resistor + :capacitor are repointed to 0603 footprints", async () => {
    const r = await fetchComponentDetail("builtin:resistor");
    const c = await fetchComponentDetail("builtin:capacitor");
    expect(r.data.detail.component.footprintId).toBe("builtin:fp:r-0603-1608m");
    expect(c.data.detail.component.footprintId).toBe("builtin:fp:c-0603-1608m");
    expect(r.data.detail.footprint.padCount).toBe(2);
    expect(c.data.detail.footprint.padCount).toBe(2);
  });
});

test.describe("builtin footprints — Library UI", () => {
  test("Library palette renders exactly the 2 builtin component cards (Resistor + Capacitor)", async ({
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
    // Confirm the legacy sized rows are gone.
    const legacyResistor0805 = page.locator(
      `[data-testid="library-component-card-builtin:resistor:0805"]`,
    );
    await expect(legacyResistor0805).toHaveCount(0);
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
      .locator(`[data-testid="library-component-card-builtin:resistor"]`)
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
        '[data-testid="component-footprint-variant-builtin:fp:r-0603-1608m"]',
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
      .locator(`[data-testid="library-component-card-builtin:capacitor"]`)
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
      { id: "builtin:resistor", x: 10_000_000, y: 10_000_000 },
      { id: "builtin:capacitor", x: 30_000_000, y: 10_000_000 },
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
