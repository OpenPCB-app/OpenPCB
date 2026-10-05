import { expect, test } from "@playwright/test";
import type { DesignerSchematicProjection } from "../../src/sdks";
import {
  closeNativeSession,
  createNativeProfile,
  launchNativeProfile,
  nativeScreenshot,
  preserveNativeDatabase,
  type NativeProfile,
  type NativeSession,
} from "./electron-native-helpers";

test.describe("Native schematic history shortcuts", () => {
  test.setTimeout(45_000);
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
    session = await launchNativeProfile(profile, info, "designer-keyboard");
    const response = await fetch(
      `${session.backend}/api/modules/designer/designs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Native H31 keyboard" }),
      },
    );
    expect(response.ok).toBe(true);
    designId = ((await response.json()) as { data: { design: { id: string } } })
      .data.design.id;
    await session.page.reload();
    await session.page
      .getByRole("button", { name: "Open", exact: true })
      .click();
    await expect
      .poll(() =>
        session.page.evaluate(
          () => window.__openpcbCapture?.sync?.().mountedRevision,
        ),
      )
      .toBe(0);
    await session.page.evaluate(async () => {
      await window.__openpcbCapture!.dispatch!({
        type: "place_gnd_port",
        positionNm: { x: 0, y: 0 },
      });
    });
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
  async function focusCanvas() {
    await session.page.getByLabel("Schematic canvas", { exact: true }).focus();
  }
  test("Cmd+Z and Redo restore geometry while text fields and active placement keep their own keys", async () => {
    const requests: string[] = [];
    session.page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        /\/history\/(undo|redo)$/.test(request.url())
      )
        requests.push(request.url());
    });
    await focusCanvas();
    await expect(
      session.page.getByRole("button", { name: "Undo", exact: true }),
    ).toBeEnabled();
    await session.page.keyboard.press("Meta+z");
    await expect
      .poll(async () => (await projection()).primitives.length)
      .toBe(0);
    await expect(
      session.page.getByRole("button", { name: "Redo", exact: true }),
    ).toBeEnabled();
    await session.page.keyboard.press("Meta+Shift+z");
    await expect
      .poll(async () => (await projection()).primitives.length)
      .toBe(1);
    await expect(
      session.page.getByRole("button", { name: "Undo", exact: true }),
    ).toBeEnabled();
    await session.page.keyboard.press("Meta+z");
    await expect
      .poll(async () => (await projection()).primitives.length)
      .toBe(0);
    await expect(
      session.page.getByRole("button", { name: "Redo", exact: true }),
    ).toBeEnabled();
    await session.page.keyboard.press("Control+y");
    await expect
      .poll(async () => (await projection()).primitives.length)
      .toBe(1);
    expect(requests).toHaveLength(4);

    const filter = session.page.getByRole("searchbox", {
      name: "Filter outline",
      exact: true,
    });
    await filter.fill("temporary query");
    await filter.press("Meta+z");
    expect((await projection()).revision).toBe(5);
    expect(requests).toHaveLength(4);
    await filter.fill("");
    await focusCanvas();
    await session.page.keyboard.press("g");
    await expect(
      session.page.getByRole("button", { name: "Undo", exact: true }),
    ).toBeEnabled();
    await session.page.keyboard.press("Meta+z");
    expect((await projection()).revision).toBe(5);
    expect(requests).toHaveLength(4);
    await session.page.keyboard.press("Escape");
    await expect(
      session.page.getByRole("button", { name: "Undo", exact: true }),
    ).toBeEnabled();
    await session.page.keyboard.press("Meta+z");
    await expect
      .poll(async () => (await projection()).primitives.length)
      .toBe(0);
    expect(requests).toHaveLength(5);
    await nativeScreenshot(session, "scoped-history-shortcuts");
  });
});
