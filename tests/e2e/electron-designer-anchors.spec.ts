import { expect, test } from "@playwright/test";
import type {
  DesignerCommand,
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

test.describe("Native Designer electrical anchors and drops", () => {
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
  test.beforeEach(async ({}, info) => {
    profile = await createNativeProfile();
    session = await launchNativeProfile(profile, info, "designer-anchors");
    const result = await post("designer/designs", {
      name: "Native H09 anchors",
    });
    designId = result.data.design.id;
    componentId = (await importSymbol()).data.componentId;
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
    const canvas = session.page
      .getByLabel("Schematic canvas", { exact: true })
      .locator("canvas");
    await expect
      .poll(() =>
        canvas.evaluate((node) => {
          const actual = node.getBoundingClientRect();
          const expected = node
            .closest('[aria-label="Schematic canvas"]')!
            .getBoundingClientRect();
          return (
            Math.abs(actual.width - expected.width) < 1 &&
            Math.abs(actual.height - expected.height) < 1
          );
        }),
      )
      .toBe(true);
    await rendered();
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

  async function post<T = { data: { design: { id: string } } }>(
    route: string,
    body: unknown,
  ): Promise<T> {
    const response = await fetch(`${session.backend}/api/modules/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.ok, await response.clone().text()).toBe(true);
    return response.json() as Promise<T>;
  }
  async function importSymbol() {
    return post<{ data: { componentId: string } }>("library/imports/drawn", {
      drawnSymbol: {
        source: {
          name: "H09 drawn symbol",
          unitCount: 1,
          referenceText: "U?",
          valueText: "H09",
          pins: [-2.54, 2.54].map((x, index) => ({
            id: `pin-${index + 1}`,
            name: `P${index + 1}`,
            number: String(index + 1),
            electricalType: "passive",
            positionMm: { x, y: 0 },
            lengthMm: 1,
            rotationDeg: index ? 180 : 0,
            unit: 1,
            hidden: false,
          })),
          graphics: [
            {
              unit: 1,
              graphic: {
                kind: "rect",
                x: -1,
                y: -0.8,
                width: 2,
                height: 1.6,
                fill: "none",
                strokeWidthMm: 0.12,
              },
            },
          ],
          warnings: [],
        },
        referencePrefix: "U",
      },
      footprintMode: "none",
      component: {
        name: "Native H09 fixture",
        description: "Isolated symbol-only fixture",
      },
    });
  }
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
    await session.page.evaluate(async (command) => {
      const result = await window.__openpcbCapture!.dispatch!(command);
      if (!result.ok) throw new Error("Fixture command rejected");
    }, command);
  }
  async function rendered() {
    await session.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }
  async function screen(point: { x: number; y: number }) {
    const projected = await session.page.evaluate(
      (point) => window.__openpcbCapture!.schematic!.project(point),
      point,
    );
    expect(projected.onScreen, JSON.stringify({ point, projected })).toBe(true);
    const box = await session.page
      .getByLabel("Schematic canvas", { exact: true })
      .boundingBox();
    if (!box) throw new Error("Schematic canvas unavailable");
    return { x: box.x + projected.x, y: box.y + projected.y };
  }
  async function clickPoint(point: { x: number; y: number }) {
    const position = await screen(point);
    await session.page.mouse.click(position.x, position.y);
  }

  test("renderer workers can read locally verified resident font blobs", async () => {
    const result = await session.page.evaluate(async () => {
      const data = URL.createObjectURL(new Blob(["resident-font-probe"]));
      const script = URL.createObjectURL(
        new Blob(
          [
            `
        self.addEventListener('securitypolicyviolation', event => self.postMessage({ blocked: event.blockedURI, directive: event.effectiveDirective }));
        self.onmessage = event => {
          const request = new XMLHttpRequest();
          request.open('GET', event.data);
          request.onload = () => self.postMessage({ text: request.responseText });
          request.onerror = () => self.postMessage({ error: 'blob XHR failed' });
          request.send();
        };
      `,
          ],
          { type: "text/javascript" },
        ),
      );
      const worker = new Worker(script);
      try {
        return await new Promise<unknown>((resolve) => {
          const timer = setTimeout(
            () => resolve({ error: "worker deadline exceeded" }),
            3000,
          );
          worker.onmessage = (event) => {
            clearTimeout(timer);
            resolve(event.data);
          };
          worker.postMessage(data);
        });
      } finally {
        worker.terminate();
        URL.revokeObjectURL(data);
        URL.revokeObjectURL(script);
      }
    });
    await session.info.attach("resident-font-worker-probe.json", {
      body: JSON.stringify(result),
      contentType: "application/json",
    });
    expect(result).toEqual({ text: "resident-font-probe" });
  });

  test("rotated off-grid pins remain exact at two zoom levels and through Undo/reopen", async () => {
    const origin = { x: -6_370_000, y: 3_105_000 };
    await dispatch({ type: "place_part", componentId, positionNm: origin });
    await dispatch({
      type: "place_part",
      componentId,
      positionNm: { x: 6_885_000, y: -2_315_000 },
      rotationDeg: 270,
    });
    await session.page
      .getByRole("button", { name: "Fit schematic", exact: true })
      .click();
    await rendered();
    await clickPoint(origin);
    await session.page.keyboard.press("r");
    await expect
      .poll(
        async () =>
          (await projection()).parts.find(
            (part) => part.positionNm.x === origin.x,
          )?.rotationDeg,
      )
      .toBe(90);
    const parts = (await projection()).parts;
    const rotated = parts.find((part) => part.positionNm.x === origin.x)!;
    const other = parts.find((part) => part.id !== rotated.id)!;
    expect(rotated.positionNm).toEqual(origin);
    for (let i = 0; i < 2; i++) {
      const pin = rotated.pins[i]!;
      await session.page
        .getByRole("button", { name: "Place GND port", exact: true })
        .click();
      // A nearby cursor must choose the exact off-grid electrical anchor.
      await clickPoint({
        x: pin.worldPositionNm.x + 50_000,
        y: pin.worldPositionNm.y,
      });
      await expect
        .poll(async () => (await projection()).primitives.length)
        .toBe(i + 1);
      expect(
        (await projection()).primitives.some(
          (p) =>
            p.positionNm.x === pin.worldPositionNm.x &&
            p.positionNm.y === pin.worldPositionNm.y,
        ),
      ).toBe(true);
      if (i === 0) {
        const scale = async () =>
          session.page.evaluate(() => {
            const view = window.__openpcbCapture!.schematic!;
            return (
              view.project({ x: 1_000_000, y: 0 }).x -
              view.project({ x: 0, y: 0 }).x
            );
          });
        const previousScale = await scale();
        const old = await screen(origin);
        await session.page.mouse.move(old.x, old.y);
        await session.page.mouse.wheel(0, 250);
        await expect.poll(scale).toBeLessThan(previousScale);
      }
    }
    const source = rotated.pins[0]!;
    const target = other.pins[0]!;
    await clickPoint(source.worldPositionNm);
    await clickPoint(target.worldPositionNm);
    await expect.poll(async () => (await projection()).wires.length).toBe(1);
    const wire = (await projection()).wires[0]!;
    expect(wire.sourcePinId).toBe(source.id);
    expect(wire.targetPinId).toBe(target.id);
    expect(wire.pointsNm[0]).toEqual(source.worldPositionNm);
    expect(wire.pointsNm.at(-1)).toEqual(target.worldPositionNm);
    for (let i = 1; i < wire.pointsNm.length; i++) {
      const a = wire.pointsNm[i - 1]!;
      const b = wire.pointsNm[i]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
    await session.page
      .getByRole("button", { name: "Undo", exact: true })
      .click();
    await expect.poll(async () => (await projection()).wires.length).toBe(0);
    await session.page
      .getByRole("button", { name: "Redo", exact: true })
      .click();
    await expect.poll(async () => (await projection()).wires.length).toBe(1);
    expect((await projection()).wires[0]!.pointsNm).toEqual(wire.pointsNm);
    const before = await projection();
    await session.page.reload();
    await session.page
      .getByRole("button", { name: "Open", exact: true })
      .click();
    expect((await projection()).parts).toEqual(before.parts);
    expect((await projection()).wires).toEqual(before.wires);
    await expect
      .poll(() =>
        session.page.evaluate(
          () => window.__openpcbCapture?.sync?.().mountedRevision,
        ),
      )
      .toBe(before.revision);
    const canvas = session.page
      .getByLabel("Schematic canvas", { exact: true })
      .locator("canvas");
    await expect
      .poll(() =>
        canvas.evaluate((node) => {
          const actual = node.getBoundingClientRect();
          const expected = node
            .closest('[aria-label="Schematic canvas"]')!
            .getBoundingClientRect();
          return (
            Math.abs(actual.width - expected.width) < 1 &&
            Math.abs(actual.height - expected.height) < 1
          );
        }),
      )
      .toBe(true);
    await session.page
      .getByRole("button", { name: "Fit schematic", exact: true })
      .click();
    await rendered();
    await nativeScreenshot(session, "exact-rotated-anchors");
  });

  test("library MIME drop commits the same grid coordinate as explicit command placement", async () => {
    await session.page
      .getByRole("button", { name: "Zoom out", exact: true })
      .click({ clickCount: 4 });
    await rendered();
    const position = await screen({ x: 8_170_000, y: 4_210_000 });
    const placement = session.page.waitForResponse(
      (response) =>
        response.url().includes(`/components/${componentId}/placement`) &&
        response.ok(),
    );
    async function drag(type: string) {
      await session.page.evaluate(
        ({ type, position, componentId }) => {
          const target = document.querySelector(
            '[aria-label="Schematic canvas"] canvas',
          )!;
          const dataTransfer = new DataTransfer();
          dataTransfer.setData(
            "application/x-openpcb-component-id",
            componentId,
          );
          target.dispatchEvent(
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              clientX: position.x,
              clientY: position.y,
              dataTransfer,
            }),
          );
        },
        { type, position, componentId },
      );
    }
    await drag("dragenter");
    await placement;
    await rendered();
    await drag("dragover");
    await rendered();
    await drag("drop");
    await expect.poll(async () => (await projection()).parts.length).toBe(1);
    const placed = (await projection()).parts[0]!;
    expect(placed.positionNm).toEqual({ x: 7_620_000, y: 3_810_000 });
    await dispatch({
      type: "place_part",
      componentId,
      positionNm: placed.positionNm,
    });
    expect(
      (await projection()).parts.every(
        (part) =>
          part.positionNm.x === placed.positionNm.x &&
          part.positionNm.y === placed.positionNm.y,
      ),
    ).toBe(true);
    await nativeScreenshot(session, "mime-drop-coordinate");
  });

  test("drag snaps an off-grid origin; Undo restores it and Duplicate snaps only the copy", async () => {
    const origin = { x: -1_330_000, y: 705_000 };
    await dispatch({ type: "place_part", componentId, positionNm: origin });
    await session.page
      .getByRole("button", { name: "Zoom out", exact: true })
      .click({ clickCount: 4 });
    await rendered();
    const part = (await projection()).parts[0]!;
    const start = await screen(origin);
    const target = await screen({ x: 1_670_000, y: -2_330_000 });
    await session.page.mouse.move(start.x, start.y);
    await session.page.mouse.down();
    await session.page.mouse.move(target.x, target.y, { steps: 12 });
    await session.page.mouse.up();
    await expect
      .poll(async () => (await projection()).parts[0]!.positionNm)
      .toEqual({ x: 1_270_000, y: -2_540_000 });
    await session.page
      .getByRole("button", { name: "Undo", exact: true })
      .click();
    await expect
      .poll(async () => (await projection()).parts[0]!.positionNm)
      .toEqual(origin);
    await session.page
      .getByRole("button", { name: new RegExp(`^${part.reference} `) })
      .click({ button: "right" });
    await session.page
      .getByRole("menuitem", { name: "Duplicate", exact: true })
      .click();
    await expect.poll(async () => (await projection()).parts.length).toBe(2);
    const after = (await projection()).parts;
    expect(after.find((p) => p.id === part.id)!.positionNm).toEqual(origin);
    expect(after.find((p) => p.id !== part.id)!.positionNm).toEqual({
      x: 1_270_000,
      y: 3_810_000,
    });
    await nativeScreenshot(session, "drag-undo-duplicate");
  });
});
