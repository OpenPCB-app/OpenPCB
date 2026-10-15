import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import type { DesignerCommand } from "../../src/sdks";
import {
  closeNativeSession,
  createNativeProfile,
  launchNativeProfile,
  nativeDeniedRequests,
  nativeScreenshot,
  preserveNativeDatabase,
  type NativeProfile,
  type NativeSession,
} from "./electron-native-helpers";
import {
  expectCanvasGeometry,
  installedCanvasPackage,
  isTroikaFontResolver,
  repinPending,
} from "./support/offline-canvas";

/*
 * OPENPCB-53 (H05) native cold-offline: a fresh profile whose session denies
 * every non-loopback request opens the schematic, PCB, 3D and Library preview
 * canvases. The denied URL list is recorded per surface. Main-process traffic
 * is not instrumented (see the identity attachment's observationScope).
 */

const canvasPackage = installedCanvasPackage();

test.describe("Native cold-offline EDA text", () => {
  test.describe.configure({ retries: 0 });
  test.skip(
    !process.env.OPENPCB_E2E_NO_WEBSERVER ||
      process.env.OPENPCB_CAPTURE !== "1",
    "Requires isolated native development profile and capture bridge",
  );
  let profile: NativeProfile;
  let session: NativeSession;
  let designId: string;
  let componentId: string;
  let deniedBySurface: Record<string, string[]>;
  let toleratedDenied: ((url: string) => boolean) | undefined;

  test.beforeEach(async ({}, info) => {
    deniedBySurface = {};
    toleratedDenied = undefined;
    profile = await createNativeProfile();
    session = await launchNativeProfile(profile, info, "offline-eda-text");
    designId = (
      await post<{ data: { design: { id: string } } }>("designer/designs", {
        name: "Native H05 offline text",
      })
    ).data.design.id;
    componentId = await importCapacitor();
    await session.page.reload();
    await session.page
      .getByRole("button", { name: "Open", exact: true })
      .click();
    await expect
      .poll(() =>
        session.page.evaluate(() => window.__openpcbCapture?.selectedDesignId),
      )
      .toBe(designId);
  });

  test.afterEach(async ({}, info) => {
    try {
      await info.attach("denied-by-surface.json", {
        body: JSON.stringify({ canvasPackage, deniedBySurface }, null, 2),
        contentType: "application/json",
      });
      if (session) {
        // Only this disposable profile may discard on teardown, including after a failed assertion.
        await session.app.evaluate(({ dialog }) => {
          dialog.showMessageBoxSync = () => 1;
        });
        await closeNativeSession(session, { toleratedDenied });
      }
    } finally {
      if (profile) await preserveNativeDatabase(profile, info);
    }
  });

  async function post<T>(route: string, body: unknown): Promise<T> {
    const response = await fetch(`${session.backend}/api/modules/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.ok, await response.clone().text()).toBe(true);
    return response.json() as Promise<T>;
  }

  async function importCapacitor(): Promise<string> {
    const fixtures = path.resolve(
      "src/core/backend/tests/fixtures/assistant-parity",
    );
    const input = {
      symbolLibrary: {
        fileName: "C.kicad_sym",
        content: await readFile(
          path.join(fixtures, "capacitor.kicad_sym"),
          "utf8",
        ),
      },
      footprints: [
        {
          fileName: "C_0603_1608Metric.kicad_mod",
          content: await readFile(
            path.join(fixtures, "capacitor.kicad_mod"),
            "utf8",
          ),
        },
      ],
    };
    const inspected = await post<{
      data: { symbols: Array<{ id: string }>; footprints: Array<{ id: string }> };
    }>("library/imports/kicad/inspect", input);
    const imported = await post<{ data: { componentId: string } }>(
      "library/imports/kicad",
      {
        ...input,
        selection: {
          symbolId: inspected.data.symbols[0]!.id,
          footprintId: inspected.data.footprints[0]!.id,
        },
        component: {
          name: "Native H05 capacitor",
          description: "Offline text fixture",
        },
      },
    );
    return imported.data.componentId;
  }

  async function dispatch(command: DesignerCommand): Promise<void> {
    const result = await session.page.evaluate(async (command) => {
      const dispatch = window.__openpcbCapture?.dispatch;
      if (!dispatch) throw new Error("Designer dispatcher unavailable");
      return dispatch(command);
    }, command);
    expect(result.ok, JSON.stringify(result)).toBe(true);
  }

  async function readyCanvas(area: Locator): Promise<Locator> {
    const canvas = area.locator("canvas").first();
    // A newly mounted HTML canvas is visible at 300x150 before R3F measures its container.
    await expect
      .poll(async () => {
        const [actual, expected] = await Promise.all([
          canvas.boundingBox(),
          area.boundingBox(),
        ]);
        return (
          !!actual &&
          !!expected &&
          Math.abs(actual.width - expected.width) < 2 &&
          Math.abs(actual.height - expected.height) < 2
        );
      })
      .toBe(true);
    await session.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    return canvas;
  }

  /** Visits every canvas surface, recording newly denied URLs per surface. */
  async function visitCanvasSurfaces(
    check: (canvas: Locator, surface: string) => Promise<void>,
  ): Promise<void> {
    const { page } = session;
    deniedBySurface.startup = await nativeDeniedRequests(session);
    let seen = deniedBySurface.startup.length;
    const record = async (surface: string, canvas: Locator) => {
      await check(canvas, surface);
      await nativeScreenshot(session, surface);
      const denied = await nativeDeniedRequests(session);
      deniedBySurface[surface] = denied.slice(seen);
      seen = denied.length;
    };

    await dispatch({ type: "place_part", componentId, positionNm: { x: 0, y: 0 } });
    await dispatch({
      type: "upsert_label",
      text: "Ω_µ_VCC",
      positionNm: { x: 5_080_000, y: 0 },
    });
    await page.getByRole("button", { name: "Fit schematic" }).click();
    await record(
      "schematic",
      await readyCanvas(page.getByLabel("Schematic canvas", { exact: true })),
    );

    await page.getByRole("tab", { name: "PCB", exact: true }).click();
    const pcb = await readyCanvas(page.getByLabel("PCB canvas", { exact: true }));
    await page.getByRole("button", { name: "Fit board", exact: true }).click();
    await record("pcb", pcb);

    await page.getByTestId("designer-view-3d").click();
    await expect(page.getByTestId("designer-3d-board-geometry")).toBeAttached({
      timeout: 20_000,
    });
    await record("3d", await readyCanvas(page.getByTestId("designer-3d-canvas")));

    await page.getByRole("button", { name: /Library/ }).first().click();
    await page.getByTestId(`library-component-row-${componentId}`).dblclick();
    await record(
      "library-preview",
      await readyCanvas(page.getByTestId("footprint-preview-canvas")),
    );

    // Save/reopen: the persisted design reloads without new off-host traffic.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Designs" })).toBeVisible();
    deniedBySurface.reopen = (await nativeDeniedRequests(session)).slice(seen);
  }

  test("every canvas surface opens offline; only the pinned font resolver is denied", async () => {
    // Tightens to the strict guard (zero denied) in the next test once re-pinned.
    toleratedDenied = isTroikaFontResolver;
    await visitCanvasSurfaces(async () => {});
    const denied = Object.values(deniedBySurface).flat();
    test.info().annotations.push({
      type: "native-offline-denied",
      description: `r3f-eda-canvas ${canvasPackage.version}: ${denied.length} denied`,
    });
    expect(
      denied.filter((url) => !isTroikaFontResolver(url)),
      "Only the pinned canvas font resolver may attempt off-host requests",
    ).toEqual([]);
  });

  test.describe("after the r3f-eda-canvas re-pin", () => {
    test.fixme(!canvasPackage.offlineText, repinPending(canvasPackage));

    test("cold-offline canvases render geometry with zero denied URLs", async () => {
      await visitCanvasSurfaces((canvas, surface) =>
        expectCanvasGeometry(session.page, canvas, surface),
      );
      expect(deniedBySurface).toEqual({
        startup: [],
        schematic: [],
        pcb: [],
        "3d": [],
        "library-preview": [],
        reopen: [],
      });
    });
  });
});
