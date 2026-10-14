import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type {
  DesignerCommand,
  DesignerPcbProjection,
  PcbPlacedPart,
} from "../../src/sdks";
import {
  closeNativeSession,
  createNativeProfile,
  launchNativeProfile,
  nativeScreenshot,
  preserveNativeDatabase,
  type NativeProfile,
  type NativeSession,
} from "./electron-native-helpers";

type Mm = { x: number; y: number };

const FIXTURES = path.resolve(
  process.cwd(),
  "node_modules/@openpcb/kicad-parsers/tests/__fixtures__",
);
const PITCHES_MM = [0.05, 0.25, 1.27] as const;
const toNm = (mm: number) => Math.round(mm * 1_000_000);

// H09: PCB footprint transform/drag matrix. Pointer drags must land on the
// selected pitch in integer nm; explicit command coordinates and Undo must be
// exact, on both sides of the board, at two measured zoom levels.
test.describe("Native PCB footprint grid matrix", () => {
  // Each case runs a dozen real drags; the project default (180 s) is too tight.
  test.describe.configure({ retries: 0, timeout: 420_000 });
  test.skip(
    !process.env.OPENPCB_E2E_NO_WEBSERVER ||
      process.env.OPENPCB_CAPTURE !== "1",
    "Requires isolated native development profile and capture bridge",
  );
  let profile: NativeProfile;
  let session: NativeSession;
  let designId: string;
  test.beforeEach(async ({}, info) => {
    profile = await createNativeProfile();
    session = await launchNativeProfile(profile, info, "designer-grid-matrix");
    designId = (
      await post<{ data: { design: { id: string } } }>("designer/designs", {
        name: "Native H09 PCB grid matrix",
      })
    ).data.design.id;
    const componentId = await importFootprintComponent();
    await session.page.reload();
    await session.page
      .getByRole("button", { name: "Open", exact: true })
      .click();
    await settled();
    await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 0, y: 0 },
    });
    await session.page.getByRole("tab", { name: "PCB", exact: true }).click();
    await expect.poll(async () => (await pcb()).placements.length).toBe(1);
    await readyCanvas();
    await settled();
  });
  test.afterEach(async ({}, info) => {
    try {
      if (session) {
        await session.app.evaluate(({ dialog }) => {
          dialog.showMessageBoxSync = () => 1;
        });
        await closeNativeSession(session);
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
  async function importFootprintComponent(): Promise<string> {
    const symbolLibrary = {
      fileName: "simple_capacitor.kicad_sym",
      content: await readFile(
        path.join(FIXTURES, "simple_capacitor.kicad_sym"),
        "utf8",
      ),
    };
    const footprints = [
      {
        fileName: "C_0603_1608Metric.kicad_mod",
        content: await readFile(
          path.join(FIXTURES, "C_0603_1608Metric.kicad_mod"),
          "utf8",
        ),
      },
    ];
    const inspect = await post<{
      data: { symbols: { id: string }[]; footprints: { id: string }[] };
    }>("library/imports/kicad/inspect", { symbolLibrary, footprints });
    const committed = await post<{ data: { componentId: string } }>(
      "library/imports/kicad",
      {
        symbolLibrary,
        footprints,
        selection: {
          symbolId: inspect.data.symbols[0]!.id,
          footprintId: inspect.data.footprints[0]!.id,
        },
        component: { name: "Native H09 footprint", description: "" },
      },
    );
    return committed.data.componentId;
  }
  async function pcb(): Promise<DesignerPcbProjection> {
    const response = await fetch(
      `${session.backend}/api/modules/designer/designs/${designId}/projection/pcb`,
    );
    expect(response.ok).toBe(true);
    return (
      (await response.json()) as { data: { projection: DesignerPcbProjection } }
    ).data.projection;
  }
  async function part(): Promise<PcbPlacedPart> {
    return (await pcb()).placements[0]!;
  }
  async function dispatch(command: DesignerCommand) {
    await session.page.evaluate(async (command) => {
      const result = await window.__openpcbCapture!.dispatch!(command);
      if (!result.ok) throw new Error("Fixture command rejected");
    }, command);
    await settled();
  }
  async function settled() {
    await expect
      .poll(() =>
        session.page.evaluate(
          () => window.__openpcbCapture?.sync?.().pendingCommands,
        ),
      )
      .toBe(0);
  }
  async function rendered() {
    await session.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }
  async function readyCanvas() {
    const canvas = session.page
      .getByLabel("PCB canvas", { exact: true })
      .locator("canvas");
    await expect
      .poll(() =>
        canvas.evaluate((node) => {
          const area = node.closest('[aria-label="PCB canvas"]')!;
          const actual = node.getBoundingClientRect();
          const expected = area.getBoundingClientRect();
          return (
            Math.abs(actual.width - expected.width) < 1 &&
            Math.abs(actual.height - expected.height) < 1
          );
        }),
      )
      .toBe(true);
    await rendered();
  }
  async function screen(pointMm: Mm, mirrorX: boolean) {
    const projected = await session.page.evaluate(
      ({ pointNm, mirrorX }) =>
        window.__openpcbCapture!.pcb!.project(pointNm, mirrorX),
      { pointNm: { x: toNm(pointMm.x), y: toNm(pointMm.y) }, mirrorX },
    );
    expect(projected.onScreen, JSON.stringify({ pointMm, projected })).toBe(
      true,
    );
    const box = await session.page
      .getByLabel("PCB canvas", { exact: true })
      .boundingBox();
    if (!box) throw new Error("PCB canvas unavailable");
    return { x: box.x + projected.x, y: box.y + projected.y };
  }
  /** Measured CSS px per mm on the live camera. */
  async function pxPerMm(): Promise<number> {
    return session.page.evaluate(() => {
      const view = window.__openpcbCapture!.pcb!;
      return Math.abs(
        view.project({ x: 1_000_000, y: 0 }).x - view.project({ x: 0, y: 0 }).x,
      );
    });
  }
  /** Zoom level 0 = Fit board; level 1 = measurably zoomed in around the part. */
  async function zoomTo(level: 0 | 1, anchor: Mm, mirrorX: boolean) {
    await session.page
      .getByRole("button", { name: "Fit board", exact: true })
      .click();
    await rendered();
    if (level === 0) return pxPerMm();
    const fit = await pxPerMm();
    const at = await screen(anchor, mirrorX);
    await session.page.mouse.move(at.x, at.y);
    await session.page.mouse.wheel(0, -300);
    await expect.poll(pxPerMm).toBeGreaterThan(fit * 1.3);
    await rendered();
    return pxPerMm();
  }
  async function setPitch(mm: number) {
    await session.page
      .getByRole("combobox", { name: "PCB grid spacing", exact: true })
      .selectOption(String(mm));
    await expect(
      session.page.getByRole("button", { name: "Snap to grid", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  /** Grab the footprint at its origin and drop it near `target`; Alt suppresses guide snap. */
  async function drag(from: Mm, target: Mm, mirrorX: boolean) {
    const start = await screen(from, mirrorX);
    const end = await screen(target, mirrorX);
    await session.page.mouse.move(start.x, start.y);
    await session.page.mouse.down();
    await session.page.keyboard.down("Alt");
    await session.page.mouse.move(end.x, end.y, { steps: 12 });
    await session.page.mouse.up();
    await session.page.keyboard.up("Alt");
    await settled();
  }

  /**
   * One origin × two zooms × three pitches: each drag lands on its pitch within
   * half a pitch (+2 px pointer slack) of the target, and Undo restores the
   * exact explicit-command origin.
   */
  async function dragMatrix(origin: Mm, mirrorX: boolean) {
    const offsets: Mm[] = [
      { x: 3.337, y: -2.113 },
      { x: -2.719, y: 1.871 },
    ];
    for (const level of [0, 1] as const) {
      const scale = await zoomTo(level, origin, mirrorX);
      for (const [index, pitch] of PITCHES_MM.entries()) {
        await setPitch(pitch);
        const offset = offsets[index % offsets.length]!;
        const target = { x: origin.x + offset.x, y: origin.y + offset.y };
        await drag(origin, target, mirrorX);
        await expect
          .poll(async () => (await part()).positionMm)
          .not.toEqual(origin);
        const moved = await part();
        const pitchNm = toNm(pitch);
        const slackMm = pitch / 2 + 2 / scale;
        for (const axis of ["x", "y"] as const) {
          const nm = toNm(moved.positionMm[axis]);
          expect(nm / 1_000_000, `integer nm (${axis})`).toBe(
            moved.positionMm[axis],
          );
          expect(Math.abs(nm % pitchNm), `${pitch} mm pitch (${axis})`).toBe(
            0,
          );
          expect(
            Math.abs(moved.positionMm[axis] - target[axis]),
            `${axis} near target at ${scale.toFixed(2)} px/mm`,
          ).toBeLessThanOrEqual(slackMm);
        }
        await session.page
          .getByRole("button", { name: "Undo", exact: true })
          .click();
        await expect
          .poll(async () => (await part()).positionMm)
          .toEqual(origin);
        await settled();
      }
    }
  }

  test("top-side footprint drag snaps per pitch at negative and zero origins; Undo is exact", async () => {
    for (const origin of [
      { x: -7.654321, y: -3.210987 },
      { x: 0, y: 0 },
    ]) {
      const placement = await part();
      await dispatch({
        type: "pcb_move_placement",
        placementId: placement.id,
        positionMm: origin,
      });
      // Explicit command coordinates are persisted verbatim (integer nm), never snapped.
      expect((await part()).positionMm).toEqual(origin);
      await dragMatrix(origin, false);
    }
    await nativeScreenshot(session, "pcb-grid-matrix-top");
  });

  test("rotated, flipped bottom-side footprint snaps per pitch; Undo and reopen are exact", async () => {
    const origin = { x: -4.321987, y: -0.000001 };
    const placement = await part();
    await dispatch({
      type: "pcb_move_placement",
      placementId: placement.id,
      positionMm: origin,
    });
    await zoomTo(0, origin, false);
    // Select by clicking the footprint, then rotate (R) and flip (toolbar).
    const at = await screen(origin, false);
    await session.page.mouse.click(at.x, at.y);
    await session.page.keyboard.press("r");
    await expect.poll(async () => (await part()).rotationDeg).toBe(90);
    await session.page
      .getByRole("button", { name: "Flip part", exact: true })
      .click();
    await expect.poll(async () => (await part()).mirrored).toBe(true);
    const flipped = await part();
    expect(flipped.layer).toBe("B.Cu");
    expect(flipped.rotationDeg).toBe(90);
    // Neither transform may move the origin.
    expect(flipped.positionMm).toEqual(origin);
    await settled();

    await session.page
      .getByRole("button", { name: "Switch to bottom view", exact: true })
      .click();
    await rendered();
    await dragMatrix(origin, true);

    const before = await pcb();
    await session.page.reload();
    await session.page
      .getByRole("button", { name: "Open", exact: true })
      .click();
    await session.page.getByRole("tab", { name: "PCB", exact: true }).click();
    await readyCanvas();
    const after = await pcb();
    expect(after.placements).toEqual(before.placements);
    expect(after.revision).toBe(before.revision);
    expect(after.placements[0]!.positionMm).toEqual(origin);
    await nativeScreenshot(session, "pcb-grid-matrix-bottom-reopen");
  });
});
