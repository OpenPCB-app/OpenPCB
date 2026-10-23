import { afterEach, describe, expect, test } from "bun:test";
import type { DesignerCommand, DesignerDispatchResult, DesignerPlacedPart } from "../../../sdks/designer";
import { loadSchematicProjection } from "../../../modules/designer/backend/projection-read";
import { replaceSchematicProjection } from "../../../modules/designer/backend/projection-world";
import { resetCaptureRuntimeForTesting } from "../../../modules/designer/backend/capture";
import { syncNetIdentity } from "../../../modules/designer/backend/net-identity/sync";
import { getSharedDb, resetSharedSqliteForTesting } from "../db/sqlite-client";
import { openReceiptStore } from "./designer-operation-receipts-harness";
import { bootDesignerRuntime, dispatchOk, envelope, postCommand, TEST_SESSION } from "./helpers/designer-runtime";
import { ercPart, ercPin, ercProjection } from "./helpers/erc-fixtures";

const previousPath = process.env.OPENPCB_DB_PATH;
const previousCapture = process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
afterEach(() => {
  resetCaptureRuntimeForTesting();
  resetSharedSqliteForTesting();
  if (previousPath === undefined) delete process.env.OPENPCB_DB_PATH;
  else process.env.OPENPCB_DB_PATH = previousPath;
  if (previousCapture === undefined) delete process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
  else process.env.OPENPCB_FEATURE_DATASET_CAPTURE = previousCapture;
});

function seed(designId: string, withIntent = true): void {
  const pins = ["no_connect", "power_source", "future_intent_v7", undefined].map((intent, index) => ({
    ...ercPin(`part:key-${index}`, "input", index * 1_000_000),
    originPinKey: `key-${index}`,
    ...(withIntent && intent ? { electricalIntent: intent } : {}),
    worldPositionNm: { x: 1_000_000, y: 2_000_000 - index * 1_000_000 },
  }));
  const part: DesignerPlacedPart = {
    ...ercPart(pins), reference: "U3", value: "Placed value",
    positionNm: { x: 1_000_000, y: 2_000_000 }, rotationDeg: 90, mirrored: true,
    propertiesJson: { manufacturer: "Stored maker", futureProperty: { level: 7 } },
  };
  Object.assign(part.symbol, { futureSymbol: { keep: true } });
  Object.assign(part.footprint, { futureFootprint: { keep: true } });
  const timestamp = new Date().toISOString();
  getSharedDb().transaction((tx) => {
    replaceSchematicProjection(tx, designId, ercProjection({
      designId, revision: 0,
      parts: [part, { ...ercPart([]), id: "other", reference: "U9" }],
      wires: [{
        id: "wire", sourcePinId: pins[0]!.id, targetPinId: pins[1]!.id,
        pointsNm: [pins[0]!.worldPositionNm, pins[1]!.worldPositionNm],
      }],
    }), timestamp);
    syncNetIdentity(tx, designId, 0, timestamp);
  });
}

function read(designId: string) {
  return loadSchematicProjection(getSharedDb(), designId)!;
}

function expectParts(designId: string, expected: DesignerPlacedPart[]): void {
  const byId = (a: DesignerPlacedPart, b: DesignerPlacedPart) => a.id.localeCompare(b.id);
  expect([...read(designId).parts].sort(byId)).toEqual([...expected].sort(byId));
}

function expectCopy(source: DesignerPlacedPart, copy: DesignerPlacedPart): void {
  expect(copy.id).not.toBe(source.id);
  expect(copy.id).toMatch(/^[a-f0-9-]{36}$/);
  expect(copy.reference).toBe("U10");
  expect(copy).toMatchObject({
    componentId: source.componentId, value: source.value,
    symbol: source.symbol, footprint: source.footprint,
    propertiesJson: source.propertiesJson, rotationDeg: 90, mirrored: true,
    positionNm: { x: 10_000_000, y: 20_000_000 },
  });
  expect(copy.pins).toHaveLength(source.pins.length);
  copy.pins.forEach((pin, index) => {
    expect(pin).toEqual({
      ...source.pins[index]!, id: `${copy.id}:key-${index}`,
      worldPositionNm: { x: 10_000_000, y: 20_000_000 - index * 1_000_000 },
    });
  });
}

describe("native snapshot duplicate", () => {
  for (const transport of ["SDK", "HTTP"] as const) {
    test(`${transport}: snapshot, known/future intent, new identities, one undo/redo and reopen`, async () => {
      const { sdk, server } = await bootDesignerRuntime(`duplicate-${transport}`);
      const design = await sdk.createDesign();
      seed(design.id);
      const before = read(design.id);
      const body = envelope(design.id, 0, {
        type: "duplicate_part", partId: "part", positionNm: { x: 10_000_000, y: 20_000_000 },
      });
      let result: DesignerDispatchResult;
      if (transport === "SDK") result = await sdk.dispatchCommand(design.id, body);
      else {
        const response = await postCommand(server, design.id, body);
        expect(response.status).toBe(200);
        result = ((await response.json()) as { data: { result: DesignerDispatchResult } }).data.result;
      }
      expect(result.ok).toBe(true);
      if (!result.ok || !result.createdEntityId) throw new Error(JSON.stringify(result));
      const after = read(design.id);
      expect(after.parts).toHaveLength(before.parts.length + 1);
      const copy = after.parts.find((part) => part.id === result.createdEntityId)!;
      expectCopy(before.parts[0]!, copy);
      expect(after.parts.find((part) => part.id === "part")).toEqual(before.parts[0]);
      expect(after.wires).toEqual(before.wires);
      expect(after.revision).toBe(1);
      expect(await sdk.dispatchCommand(design.id, body)).toMatchObject({
        ok: true, createdEntityId: copy.id, idempotent: true,
      });
      expect(read(design.id).parts).toHaveLength(after.parts.length);
      expect((await sdk.undo(design.id, TEST_SESSION)).ok).toBe(true);
      expectParts(design.id, before.parts);
      expect((await sdk.redo(design.id, TEST_SESSION)).ok).toBe(true);
      expect(read(design.id).parts.find((part) => part.id === copy.id)).toEqual(copy);
      const reopened = await openReceiptStore(process.env.OPENPCB_DB_PATH!);
      expect(read(design.id).parts.find((part) => part.id === copy.id)).toEqual(copy);
      expect((await reopened.undo(design.id, TEST_SESSION)).ok).toBe(true);
      expectParts(design.id, before.parts);
      expect((await reopened.redo(design.id, TEST_SESSION)).ok).toBe(true);
      expect(read(design.id).parts.find((part) => part.id === copy.id)).toEqual(copy);
    });
  }

  test("a normal part keeps absent intent absent", async () => {
    const { sdk } = await bootDesignerRuntime("duplicate-normal");
    const design = await sdk.createDesign();
    seed(design.id, false);
    const result = await dispatchOk(sdk, design.id, {
      type: "duplicate_part", partId: "part", positionNm: { x: 0, y: 0 },
    });
    const copied = read(design.id).parts.find((part) => part.id === result.createdEntityId)!;
    expect(copied.pins.every((pin) => pin.electricalIntent === undefined)).toBe(true);
  });

  test("missing/cross-design source and invalid positions refuse atomically and replay the refusal", async () => {
    const { sdk, server } = await bootDesignerRuntime("duplicate-invalid");
    const design = await sdk.createDesign();
    const other = await sdk.createDesign();
    seed(design.id);
    const before = read(design.id);
    for (const target of [design.id, other.id]) {
      const body = envelope(target, 0, { type: "duplicate_part", partId: target === design.id ? "missing" : "part", positionNm: { x: 0, y: 0 } });
      expect(await sdk.dispatchCommand(target, body)).toMatchObject({ ok: false, code: "ENTITY_NOT_FOUND", entityKind: "part" });
      expect((await postCommand(server, target, body)).status).toBe(200);
    }
    for (const positionNm of [null, {}, { x: 0 }, { x: "0", y: 0 }, { x: NaN, y: 0 }, { x: Infinity, y: 0 }, { x: 0.5, y: 0 }, { x: Number.MAX_SAFE_INTEGER + 1, y: 0 }]) {
      const body = envelope(design.id, 0, { type: "duplicate_part", partId: "part", positionNm } as unknown as DesignerCommand);
      const expected = { ok: false, code: "INVALID_PART_POSITION", partId: "part" };
      expect(await sdk.dispatchCommand(design.id, body)).toMatchObject(expected);
      expect(await sdk.dispatchCommand(design.id, body)).toMatchObject(expected);
      const response = await postCommand(server, design.id, { ...body, commandId: crypto.randomUUID() });
      expect(response.status).toBe(400);
      expect(read(design.id)).toEqual(before);
    }
    const overflow = envelope(design.id, 0, {
      type: "duplicate_part", partId: "part", positionNm: { x: 0, y: Number.MIN_SAFE_INTEGER },
    });
    const rejected = await postCommand(server, design.id, overflow);
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toMatchObject({ data: { result: {
      ok: false, code: "INVALID_PART_POSITION", detail: "positionNm places a pin outside safe integer nanometers",
    } } });
    expect(read(design.id)).toEqual(before);
  });

  test("batch sees fresh refs and rolls back earlier duplicates after failure", async () => {
    const { sdk, server } = await bootDesignerRuntime("duplicate-batch");
    const design = await sdk.createDesign();
    seed(design.id);
    const before = read(design.id);
    const duplicate = { type: "duplicate_part", partId: "part", positionNm: { x: 5_000_000, y: 7_000_000 } } as const;
    const failed = await sdk.dispatchCommand(design.id, envelope(design.id, 0, {
      type: "batch_commands", commands: [duplicate, { ...duplicate, partId: "missing" }],
    }));
    expect(failed).toMatchObject({ ok: false, code: "ENTITY_NOT_FOUND" });
    expect(read(design.id)).toEqual(before);
    const invalid = await sdk.dispatchCommand(design.id, envelope(design.id, 0, {
      type: "batch_commands", commands: [duplicate, { ...duplicate, positionNm: { x: 0.5, y: 0 } }],
    }));
    expect(invalid).toMatchObject({ ok: false, code: "INVALID_PART_POSITION" });
    expect(read(design.id)).toEqual(before);
    const response = await postCommand(server, design.id, envelope(design.id, 0, {
      type: "batch_commands", commands: [
        { type: "set_pin_electrical_intent", pinId: "part:key-0", intent: "power_source" },
        duplicate, duplicate,
      ],
    }));
    expect(response.status).toBe(200);
    const after = read(design.id);
    expect(after.revision).toBe(1);
    expect(after.parts.map((part) => part.reference)).toEqual(["U3", "U9", "U10", "U11"]);
    expect(new Set(after.parts.flatMap((part) => part.pins.map((pin) => pin.id))).size).toBe(12);
    expect(after.parts.filter((part) => part.id !== "other")
      .every((part) => part.pins[0]?.electricalIntent === "power_source")).toBe(true);
    expect((await sdk.undo(design.id, TEST_SESSION)).ok).toBe(true);
    expectParts(design.id, before.parts);
  });
});
