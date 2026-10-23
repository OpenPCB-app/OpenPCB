import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import type {
  DesignerCommand,
  DesignerDispatchResult,
  DesignerPin,
  DesignerPinElectricalIntent,
  DesignerPlacedPart,
  DesignerSchematicProjection,
  ErcReport,
} from "../../src/sdks";
import { expectCanvasGeometry } from "./support/offline-canvas";

const API = "http://127.0.0.1:3000/api/modules";

async function projection(
  request: APIRequestContext,
  designId: string,
): Promise<DesignerSchematicProjection> {
  const response = await request.get(
    `${API}/designer/designs/${designId}/projection/schematic`,
  );
  expect(response.ok()).toBe(true);
  const body = await response.json() as {
    data: { projection: DesignerSchematicProjection };
  };
  return body.data.projection;
}

async function dispatch(
  request: APIRequestContext,
  designId: string,
  command: DesignerCommand,
): Promise<void> {
  const current = await projection(request, designId);
  const response = await request.post(`${API}/designer/designs/${designId}/commands`, {
    data: {
      commandId: crypto.randomUUID(), sessionId: "e2e-pin-intent-seed",
      aggregateId: designId, baseRevision: current.revision,
      issuedAt: Date.now(), command,
    },
  });
  expect(response.ok()).toBe(true);
  expect((await response.json() as { data: { result: DesignerDispatchResult } })
    .data.result.ok).toBe(true);
}

async function importProbe(request: APIRequestContext): Promise<string> {
  const pins = ["input", "power_in", "no_connect"].map((electricalType, index) => ({
    id: `pin-${index + 1}`, name: ["SIGNAL", "VIN", "NC"][index],
    number: `${index + 1}`, electricalType, unit: 1, hidden: false,
    positionMm: { x: (index - 1) * 3, y: 0 }, lengthMm: 1, rotationDeg: 0,
  }));
  const response = await request.post(`${API}/library/imports/drawn`, {
    data: {
      drawnSymbol: {
        source: {
          name: "ElectricalIntentProbe", unitCount: 1, referenceText: "U?",
          valueText: "Intent probe", pins, warnings: [],
          graphics: [{
            unit: 1,
            graphic: {
              kind: "rect", x: -1.5, y: -1, width: 3, height: 2,
              fill: "none", strokeWidthMm: 0.12,
            },
          }],
        },
        referencePrefix: "U",
      },
      footprintMode: "none",
      component: { name: "Electrical intent probe", description: "Pin intent integration fixture" },
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json() as { data: { componentId: string } }).data.componentId;
}

async function seed(request: APIRequestContext) {
  const componentId = await importProbe(request);
  const name = `Pin intent ${crypto.randomUUID()}`;
  const response = await request.post(`${API}/designer/designs`, { data: { name } });
  expect(response.status()).toBe(201);
  const designId = (await response.json() as { data: { design: { id: string } } })
    .data.design.id;
  await dispatch(request, designId, {
    type: "place_part", componentId, positionNm: { x: 0, y: 0 },
  });
  const placed = (await projection(request, designId)).parts[0]!;
  const power = placed.pins.find((pin) => pin.name === "VIN")!;
  await dispatch(request, designId, {
    type: "upsert_label", text: "VIN_EXT", positionNm: power.worldPositionNm,
  });
  return { designId, name, placed };
}

async function openAndSelect(page: Page, name: string, reference: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Designs" })).toBeVisible();
  await page.getByText(name, { exact: true }).first().dblclick();
  await expect(page.getByRole("searchbox", { name: "Filter outline" })).toBeVisible();
  await page.getByRole("button").filter({
    has: page.locator(`span[title="${reference}"]`),
  }).click();
  await expect(page.getByRole("combobox", { name: "Pin 1 SIGNAL electrical intent" }))
    .toBeVisible();
}

function intentControl(page: Page, pin: DesignerPin): Locator {
  return page.getByRole("combobox", {
    name: `Pin ${pin.number} ${pin.name} electrical intent`, exact: true,
  });
}

async function changeIntent(
  page: Page,
  pin: DesignerPin,
  intent: DesignerPinElectricalIntent | null,
): Promise<DesignerDispatchResult> {
  const acknowledgement = page.waitForResponse((response) => {
    if (!response.url().endsWith("/commands") || response.request().method() !== "POST") return false;
    const envelope = response.request().postDataJSON() as { command: DesignerCommand };
    return envelope.command.type === "set_pin_electrical_intent"
      && envelope.command.pinId === pin.id && envelope.command.intent === intent;
  });
  await intentControl(page, pin).selectOption(intent ?? "");
  const response = await acknowledgement;
  expect(response.ok()).toBe(true);
  return (await response.json() as { data: { result: DesignerDispatchResult } }).data.result;
}

async function expectIntent(
  page: Page,
  request: APIRequestContext,
  designId: string,
  pin: DesignerPin,
  intent: DesignerPinElectricalIntent | undefined,
): Promise<void> {
  await expect.poll(async () => {
    const current = await projection(request, designId);
    return current.parts.flatMap((part) => part.pins)
      .find((currentPin) => currentPin.id === pin.id)?.electricalIntent;
  }).toBe(intent);
  await expect(intentControl(page, pin)).toHaveValue(intent ?? "");
  await expect(intentControl(page, pin)).toBeEnabled();
}

async function codesForPin(
  request: APIRequestContext,
  designId: string,
  pinId: string,
): Promise<string[]> {
  const response = await request.get(`${API}/designer/designs/${designId}/erc`);
  expect(response.ok()).toBe(true);
  const report = (await response.json() as { data: { report: ErcReport } }).data.report;
  return report.violations.filter((violation) => violation.anchors.some(
    (anchor) => anchor.kind === "pin" && anchor.pinId === pinId,
  )).map((violation) => violation.code).sort();
}

async function duplicateAndUndo(
  page: Page,
  request: APIRequestContext,
  designId: string,
  original: DesignerPlacedPart,
): Promise<void> {
  const before = await projection(request, designId);
  await page.getByRole("button").filter({
    has: page.locator(`span[title="${original.reference}"]`),
  }).click({ button: "right" });
  const acknowledgement = page.waitForResponse((response) => {
    if (!response.url().endsWith("/commands") || response.request().method() !== "POST") return false;
    return (response.request().postDataJSON() as { command: DesignerCommand })
      .command.type === "duplicate_part";
  });
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  expect((await (await acknowledgement).json() as {
    data: { result: DesignerDispatchResult };
  }).data.result.ok).toBe(true);
  await expect.poll(async () => (await projection(request, designId)).parts.length).toBe(2);
  const after = await projection(request, designId);
  expect(after.revision).toBe(before.revision + 1);
  const copied = after.parts.find((part) => part.id !== original.id)!;
  expect(copied.id).not.toBe(original.id);
  expect(copied.pins).toHaveLength(original.pins.length);
  for (const pin of original.pins) {
    const copy = copied.pins.find((candidate) => candidate.originPinKey === pin.originPinKey)!;
    expect(copy.id).not.toBe(pin.id);
    expect(copy.electricalIntent).toBe(pin.electricalIntent);
  }
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await projection(request, designId)).parts.length).toBe(1);
  const undone = await projection(request, designId);
  expect(undone.revision).toBe(after.revision + 1);
  expect(undone.parts[0]).toEqual(original);
}

test("native pin intent persists through inspector, ERC, history and reopen", async ({
  page, request,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const scene = await seed(request);
  const { designId, placed } = scene;
  const signal = placed.pins.find((pin) => pin.name === "SIGNAL")!;
  const power = placed.pins.find((pin) => pin.name === "VIN")!;
  const libraryNc = placed.pins.find((pin) => pin.name === "NC")!;
  const baseline = await projection(request, designId);
  await openAndSelect(page, scene.name, placed.reference);
  await expect(intentControl(page, libraryNc).locator('option[value="power_source"]'))
    .toBeDisabled();
  expect(await codesForPin(request, designId, signal.id)).toEqual(["UNCONNECTED_INPUT_PIN"]);
  expect(await codesForPin(request, designId, power.id)).toEqual(["UNDRIVEN_POWER_PIN"]);

  expect((await changeIntent(page, signal, "no_connect")).ok).toBe(true);
  await expectIntent(page, request, designId, signal, "no_connect");
  expect(await codesForPin(request, designId, signal.id)).toEqual([]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectIntent(page, request, designId, signal, undefined);
  expect(await codesForPin(request, designId, signal.id)).toEqual(["UNCONNECTED_INPUT_PIN"]);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expectIntent(page, request, designId, signal, "no_connect");
  await openAndSelect(page, scene.name, placed.reference);
  await expectIntent(page, request, designId, signal, "no_connect");

  expect((await changeIntent(page, signal, null)).ok).toBe(true);
  await expectIntent(page, request, designId, signal, undefined);
  expect(await codesForPin(request, designId, signal.id)).toEqual(["UNCONNECTED_INPUT_PIN"]);
  expect((await changeIntent(page, power, "power_source")).ok).toBe(true);
  await expectIntent(page, request, designId, power, "power_source");
  expect(await codesForPin(request, designId, power.id)).toEqual([]);

  expect((await changeIntent(page, power, "no_connect")).ok).toBe(true);
  await expectIntent(page, request, designId, power, "no_connect");
  expect(await codesForPin(request, designId, power.id))
    .toContain("NO_CONNECT_INTENT_VIOLATION");
  expect((await changeIntent(page, power, null)).ok).toBe(true);
  await expectIntent(page, request, designId, power, undefined);
  expect(await codesForPin(request, designId, power.id)).toEqual(["UNDRIVEN_POWER_PIN"]);

  expect((await changeIntent(page, power, "power_source")).ok).toBe(true);
  await expectIntent(page, request, designId, power, "power_source");
  expect((await changeIntent(page, signal, "no_connect")).ok).toBe(true);
  await expectIntent(page, request, designId, signal, "no_connect");
  await openAndSelect(page, scene.name, placed.reference);
  await expectIntent(page, request, designId, signal, "no_connect");
  await expectIntent(page, request, designId, power, "power_source");
  expect(await codesForPin(request, designId, signal.id)).toEqual([]);
  expect(await codesForPin(request, designId, power.id)).toEqual([]);
  const reopened = await projection(request, designId);
  expect(reopened.nets).toEqual(baseline.nets);
  expect(reopened.primitives).toEqual([]);
  expect(reopened.parts[0]?.pins.map(({ electricalIntent: _intent, ...pin }) => pin))
    .toEqual(placed.pins);
  await duplicateAndUndo(page, request, designId, reopened.parts[0]!);
  await page.getByRole("button", { name: "Fit schematic", exact: true }).click();
  await expectCanvasGeometry(page, page.locator("canvas").first(), "Pin intent fixture");
  const screenshot = info.outputPath("pin-intent-markers.png");
  await page.locator("canvas").first().screenshot({ path: screenshot });
  await info.attach("Pin intent schematic canvas", {
    path: screenshot, contentType: "image/png",
  });
});
