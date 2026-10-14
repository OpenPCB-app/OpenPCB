import { expect, test } from "@playwright/test";
import type {
  DesignerCommand,
  DesignerCommandEnvelope,
  DesignerPcbProjection,
  DesignerSchematicProjection,
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

test.describe("Native Designer command ordering", () => {
  test.describe.configure({ retries: 0 });
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
    session = await launchNativeProfile(profile, info, "designer");
    const response = await fetch(
      `${session.backend}/api/modules/designer/designs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Native H07 design" }),
      },
    );
    expect(response.ok).toBe(true);
    const body = (await response.json()) as {
      data: { design: { id: string } };
    };
    designId = body.data.design.id;
    await session.page.reload();
    await session.page
      .getByRole("button", { name: "Open", exact: true })
      .click();
    await expect
      .poll(() =>
        session.page.evaluate(() => window.__openpcbCapture?.selectedDesignId),
      )
      .toBe(designId);
    await expect
      .poll(() =>
        session.page.evaluate(
          () => window.__openpcbCapture?.sync?.().mountedRevision,
        ),
      )
      .toBe(0);
  });
  test.afterEach(async ({}, info) => {
    try {
      if (session) {
        // Only this disposable profile may discard on teardown, including after a failed assertion.
        await session.app.evaluate(({ dialog }) => {
          dialog.showMessageBoxSync = () => 1;
        });
        await closeNativeSession(session);
      }
    } finally {
      if (profile) await preserveNativeDatabase(profile, info);
    }
  });

  async function projection(): Promise<DesignerSchematicProjection> {
    const response = await fetch(
      `${session.backend}/api/modules/designer/designs/${designId}/projection/schematic`,
    );
    expect(response.ok).toBe(true);
    return (
      (await response.json()) as {
        data: { projection: DesignerSchematicProjection };
      }
    ).data.projection;
  }
  async function dispatch(command: DesignerCommand) {
    return session.page.evaluate(async (command) => {
      const dispatch = window.__openpcbCapture?.dispatch;
      if (!dispatch) throw new Error("Designer dispatcher unavailable");
      return dispatch(command);
    }, command);
  }

  async function readyCanvas(label: "Schematic canvas" | "PCB canvas") {
    const canvas = session.page
      .getByLabel(label, { exact: true })
      .locator("canvas");
    // A newly mounted HTML canvas is visible at 300x150 before R3F measures its container.
    await expect
      .poll(() =>
        canvas.evaluate((node, label) => {
          const area = node.closest(`[aria-label="${label}"]`)!;
          const actual = node.getBoundingClientRect();
          const expected = area.getBoundingClientRect();
          return (
            Math.abs(actual.width - expected.width) < 1 &&
            Math.abs(actual.height - expected.height) < 1
          );
        }, label),
      )
      .toBe(true);
    await session.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    return canvas;
  }

  test("rapid schematic actions use successive revisions and native Undo restores geometry", async () => {
    const commands: DesignerCommandEnvelope[] = [];
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    await session.page.route(
      `**/designs/${designId}/commands`,
      async (route) => {
        commands.push(
          route.request().postDataJSON() as DesignerCommandEnvelope,
        );
        if (commands.length === 1) await gate;
        await route.continue();
      },
    );
    const pending = session.page.evaluate(async () => {
      const dispatch = window.__openpcbCapture!.dispatch!;
      return Promise.all([
        dispatch({ type: "place_gnd_port", positionNm: { x: 0, y: 0 } }),
        dispatch({
          type: "place_gnd_port",
          positionNm: { x: 2540000, y: 1270000 },
        }),
      ]);
    });
    try {
      await expect(
        session.page.getByRole("status").filter({ hasText: "Saving design" }),
      ).toBeVisible();
      expect(commands).toHaveLength(1);
    } finally {
      release();
    }
    expect((await pending).every((result) => result.ok)).toBe(true);
    expect(commands.map((command) => command.baseRevision)).toEqual([0, 1]);
    expect((await projection()).primitives).toHaveLength(2);
    await session.page
      .getByRole("button", { name: "Undo", exact: true })
      .click();
    await expect
      .poll(async () => (await projection()).primitives.length)
      .toBe(1);
    await session.page
      .getByRole("button", { name: "Redo", exact: true })
      .click();
    await expect
      .poll(async () => (await projection()).primitives.length)
      .toBe(2);
    await nativeScreenshot(session, "schematic-revision-history");
    await session.info.attach("command-envelopes.json", {
      body: JSON.stringify(commands),
      contentType: "application/json",
    });
  });

  test("PCB commands share ordering and preserve exact hole coordinates", async () => {
    await session.page.getByRole("tab", { name: "PCB", exact: true }).click();
    const results = await Promise.all([
      dispatch({
        type: "pcb_add_free_hole",
        centerMm: { x: 12.7, y: -2.54 },
        drillMm: 1,
      }),
      dispatch({
        type: "pcb_add_free_hole",
        centerMm: { x: -1.27, y: 5.08 },
        drillMm: 1,
      }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const response = await fetch(
      `${session.backend}/api/modules/designer/designs/${designId}/projection/pcb`,
    );
    const body = (await response.json()) as {
      data: {
        projection: {
          revision: number;
          freeHoles: Array<{ centerMm: { x: number; y: number } }>;
        };
      };
    };
    expect(body.data.projection.revision).toBe(2);
    expect(body.data.projection.freeHoles.map((hole) => hole.centerMm)).toEqual(
      expect.arrayContaining([
        { x: 12.7, y: -2.54 },
        { x: -1.27, y: 5.08 },
      ]),
    );
    await nativeScreenshot(session, "pcb-ordered-holes");
  });

  test("schematic pointer placement uses the 1.27 mm grid independently of visibility", async () => {
    await expect(
      session.page.getByRole("button", { name: "Show grid", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const canvas = await readyCanvas("Schematic canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Schematic canvas unavailable");
    await session.page
      .getByRole("button", { name: "Place GND port", exact: true })
      .click();
    await canvas.click({
      position: { x: box.width / 2 + 83, y: box.height / 2 + 47 },
    });
    await expect
      .poll(async () => (await projection()).primitives.length)
      .toBe(1);
    const placed = (await projection()).primitives[0]!;
    expect(Math.abs(placed.positionNm.x % 1_270_000)).toBe(0);
    expect(Math.abs(placed.positionNm.y % 1_270_000)).toBe(0);
    await session.page
      .getByRole("button", { name: "Show grid", exact: true })
      .click();
    await expect(
      session.page.getByRole("button", { name: "Show grid", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      session.page.getByRole("button", { name: "Snap to grid", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await session.page
      .getByRole("button", { name: "Place GND port", exact: true })
      .click();
    await canvas.click({
      position: { x: box.width / 2 - 91, y: box.height / 2 - 53 },
    });
    await expect
      .poll(async () => (await projection()).primitives.length)
      .toBe(2);
    for (const primitive of (await projection()).primitives) {
      expect(Math.abs(primitive.positionNm.x % 1_270_000)).toBe(0);
      expect(Math.abs(primitive.positionNm.y % 1_270_000)).toBe(0);
    }
    await nativeScreenshot(session, "schematic-grid-hidden-snap-on");
    await session.page.keyboard.press("Shift+S");
    await expect(
      session.page.getByRole("button", { name: "Snap to grid", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await session.page
      .getByRole("button", { name: "Place GND port", exact: true })
      .click();
    await canvas.click({
      position: { x: box.width / 2 + 137, y: box.height / 2 - 61 },
    });
    await expect
      .poll(async () => (await projection()).primitives.length)
      .toBe(3);
    expect(
      (await projection()).primitives.some(
        (primitive) =>
          primitive.positionNm.x % 1_270_000 !== 0 ||
          primitive.positionNm.y % 1_270_000 !== 0,
      ),
    ).toBe(true);
  });

  test("PCB pointer placement follows selectable grid and survives reopen", async () => {
    await session.page.getByRole("tab", { name: "PCB", exact: true }).click();
    const canvas = await readyCanvas("PCB canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("PCB canvas unavailable");
    await session.page
      .getByRole("button", { name: "Fit board", exact: true })
      .click();
    await session.page
      .getByRole("combobox", { name: "PCB grid spacing", exact: true })
      .selectOption("0.5");
    await session.page
      .getByRole("button", { name: "Show grid", exact: true })
      .click();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await session.page.keyboard.press("h");
    await canvas.click({
      position: { x: box.width / 2 + 37, y: box.height / 2 + 23 },
    });
    const read = async (): Promise<DesignerPcbProjection> => {
      const response = await fetch(
        `${session.backend}/api/modules/designer/designs/${designId}/projection/pcb`,
      );
      return (
        (await response.json()) as {
          data: { projection: DesignerPcbProjection };
        }
      ).data.projection;
    };
    await expect.poll(async () => (await read()).freeHoles.length).toBe(1);
    const hole = (await read()).freeHoles[0]!;
    expect(Math.abs(hole.centerMm.x)).toBeLessThan(25);
    expect(Math.abs(hole.centerMm.y)).toBeLessThan(15);
    expect(Math.abs(Math.round(hole.centerMm.x * 1_000_000) % 500_000)).toBe(0);
    expect(Math.abs(Math.round(hole.centerMm.y * 1_000_000) % 500_000)).toBe(0);
    await session.page.keyboard.press("n");
    await expect(
      session.page.getByRole("combobox", {
        name: "PCB grid spacing",
        exact: true,
      }),
    ).toHaveValue("1");
    await session.page.keyboard.press("Shift+N");
    await expect(
      session.page.getByRole("combobox", {
        name: "PCB grid spacing",
        exact: true,
      }),
    ).toHaveValue("0.5");
    const before = await read();
    await session.page.reload();
    await session.page
      .getByRole("button", { name: "Open", exact: true })
      .click();
    await session.page.getByRole("tab", { name: "PCB", exact: true }).click();
    await expect(
      session.page.getByRole("combobox", {
        name: "PCB grid spacing",
        exact: true,
      }),
    ).toHaveValue("0.5");
    await expect(
      session.page.getByRole("button", { name: "Show grid", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    expect((await read()).freeHoles).toEqual(before.freeHoles);
    expect((await read()).revision).toBe(before.revision);
    await readyCanvas("PCB canvas");
    await nativeScreenshot(session, "pcb-grid-reopen");
  });

  test("real revision conflict retains the edit until reviewed reapply", async () => {
    const response = await fetch(
      `${session.backend}/api/modules/designer/designs/${designId}/commands`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          sessionId: "other-editor",
          aggregateId: designId,
          baseRevision: 0,
          issuedAt: Date.now(),
          command: { type: "place_gnd_port", positionNm: { x: 0, y: 0 } },
        }),
      },
    );
    expect(response.ok).toBe(true);
    await expect(
      dispatch({
        type: "place_gnd_port",
        positionNm: { x: 2540000, y: 1270000 },
      }),
    ).rejects.toThrow("retained for review");
    expect((await projection()).primitives).toHaveLength(1);
    await session.page
      .getByRole("button", { name: "Home", exact: true })
      .click();
    await session.page
      .getByRole("button", { name: "Open", exact: true })
      .click();
    await session.page
      .getByText("Review retained edits", { exact: true })
      .click();
    await session.page
      .getByRole("button", {
        name: "Apply this edit to refreshed design",
        exact: true,
      })
      .click();
    const confirm = session.page.getByRole("alertdialog", {
      name: "Apply retained edit?",
    });
    await expect(confirm).toBeVisible();
    expect((await projection()).primitives).toHaveLength(1);
    await confirm
      .getByRole("button", { name: "Apply edit", exact: true })
      .click();
    await expect
      .poll(async () => (await projection()).primitives.length)
      .toBe(2);
    await expect(
      session.page.getByText("Review retained edits", { exact: true }),
    ).not.toBeVisible();
    await nativeScreenshot(session, "reviewed-conflict-reapply");
  });

  test("delayed native Undo refuses an intervening external revision", async () => {
    await dispatch({ type: "place_gnd_port", positionNm: { x: 0, y: 0 } });
    let release!: () => void;
    let entered!: () => void;
    const arrived = new Promise<void>((done) => {
      entered = done;
    });
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const requests: Array<{ expectedRevision: number }> = [];
    await session.page.route(
      `**/designs/${designId}/history/undo`,
      async (route) => {
        requests.push(
          route.request().postDataJSON() as { expectedRevision: number },
        );
        entered();
        await gate;
        await route.continue();
      },
    );
    const undo = session.page.getByRole("button", {
      name: "Undo",
      exact: true,
    });
    await undo.click();
    try {
      await arrived;
      await expect(undo).toBeDisabled();
      const response = await fetch(
        `${session.backend}/api/modules/designer/designs/${designId}/commands`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            commandId: crypto.randomUUID(),
            sessionId: "external-editor",
            aggregateId: designId,
            baseRevision: 1,
            issuedAt: Date.now(),
            command: {
              type: "place_gnd_port",
              positionNm: { x: 2540000, y: 1270000 },
            },
          }),
        },
      );
      expect(response.ok).toBe(true);
    } finally {
      release();
    }
    await expect(
      session.page
        .getByText(/Design changed before history could be applied/)
        .last(),
    ).toBeVisible();
    expect(requests).toEqual([
      { sessionId: "designer-ui-session", expectedRevision: 1 },
    ]);
    expect((await projection()).primitives).toHaveLength(2);
    expect((await projection()).revision).toBe(2);
    await nativeScreenshot(session, "stale-undo-retained");
    await session.page
      .getByRole("button", {
        name: "Discard retained edits and reload",
        exact: true,
      })
      .click();
    await session.page
      .getByRole("alertdialog", { name: "Discard retained edits?" })
      .getByRole("button", { name: "Discard edits", exact: true })
      .click();
    await expect(
      session.page.getByText("Review retained edits", { exact: true }),
    ).not.toBeVisible();
  });
});
