import { expect, test } from "@playwright/test";
import type {
  DesignerCommand,
  DesignerCommandEnvelope,
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
