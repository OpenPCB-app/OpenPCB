import { afterEach, describe, expect, test } from "bun:test";
import type { DesignerCommand } from "../../../sdks/designer";
import { eq } from "drizzle-orm";
import { insertPart } from "../../../modules/designer/backend/command-executor";
import { loadSchematicProjection } from "../../../modules/designer/backend/projection-read";
import { projectionFromWorld, projectionToWorld, replaceSchematicProjection } from "../../../modules/designer/backend/projection-world";
import { schematicPins } from "../../../modules/designer/backend/schema";
import { getSharedDb, resetSharedSqliteForTesting } from "../db/sqlite-client";
import { resetCaptureRuntimeForTesting } from "../../../modules/designer/backend/capture";
import { openReceiptStore } from "./designer-operation-receipts-harness";
import { bootDesignerRuntime, dispatchOk, envelope, importCapacitorComponent, postCommand, TEST_SESSION } from "./helpers/designer-runtime";
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

describe("pin electrical intent command lifecycle", () => {
  test("set, clear, move, refresh, delete, undo/redo and reopen preserve stable pin intent", async () => {
    const { sdk, server } = await bootDesignerRuntime("pin-intent-lifecycle");
    const componentId = await importCapacitorComponent(server);
    const design = await sdk.createDesign({ name: "Pin intent" });
    await dispatchOk(sdk, design.id, { type: "place_part", componentId, positionNm: { x: 0, y: 0 } });
    const first = (await sdk.getSchematicProjection(design.id))!.parts[0]!;
    const pinId = first.pins[0]!.id;
    const read = () => loadSchematicProjection(getSharedDb(), design.id)!.parts[0]!.pins[0]!;
    expect(read()).not.toHaveProperty("electricalIntent");
    await dispatchOk(sdk, design.id, { type: "set_pin_electrical_intent", pinId, intent: "no_connect" });
    expect(read().electricalIntent).toBe("no_connect");
    await dispatchOk(sdk, design.id, { type: "set_pin_electrical_intent", pinId, intent: null });
    expect(read()).not.toHaveProperty("electricalIntent");
    expect((await sdk.undo(design.id, TEST_SESSION)).ok).toBe(true);
    expect(read().electricalIntent).toBe("no_connect");
    expect((await sdk.redo(design.id, TEST_SESSION)).ok).toBe(true);
    expect(read()).not.toHaveProperty("electricalIntent");
    await dispatchOk(sdk, design.id, { type: "set_pin_electrical_intent", pinId, intent: "power_source" });
    for (const command of [
      { type: "move_part", partId: first.id, positionNm: { x: 3_000_000, y: 1_000_000 } },
      { type: "rotate_part", partId: first.id, rotationDeg: 90 },
      { type: "mirror_part", partId: first.id, mirrored: true },
      { type: "refresh_part_footprint", partIds: [first.id] },
    ] satisfies DesignerCommand[]) {
      await dispatchOk(sdk, design.id, command);
      expect(read().id).toBe(pinId);
      expect(read().electricalIntent).toBe("power_source");
      expect(read().electricalType).toBe(first.pins[0]!.electricalType);
    }
    await dispatchOk(sdk, design.id, { type: "delete_entity", entityKind: "part", entityId: first.id });
    expect(loadSchematicProjection(getSharedDb(), design.id)!.parts).toEqual([]);
    const reopened = await openReceiptStore(process.env.OPENPCB_DB_PATH!);
    expect((await reopened.undo(design.id, TEST_SESSION)).ok).toBe(true);
    expect(read().electricalIntent).toBe("power_source");
    expect((await reopened.redo(design.id, TEST_SESSION)).ok).toBe(true);
    expect(loadSchematicProjection(getSharedDb(), design.id)!.parts).toEqual([]);
  });

  test("unknown stored values survive DB, world, copy insert, unrelated edit and undo", async () => {
    const { sdk } = await bootDesignerRuntime("pin-intent-future");
    const design = await sdk.createDesign();
    const pin = { ...ercPin("part:key", "input"), originPinKey: "key", electricalIntent: "future_intent_v7" };
    const part = ercPart([pin]);
    const authored = ercProjection({ designId: design.id, revision: 0, parts: [part] });
    replaceSchematicProjection(getSharedDb(), design.id, authored, new Date().toISOString());
    const world = projectionFromWorld(design.id, 0, projectionToWorld(authored));
    replaceSchematicProjection(getSharedDb(), design.id, world, new Date().toISOString());
    const copy = { ...part, id: "copy", reference: "U2", pins: [{ ...pin, id: "copy:key" }] };
    insertPart(getSharedDb(), design.id, { ...copy, propertiesJson: "{}" }, new Date().toISOString());
    const read = () => loadSchematicProjection(getSharedDb(), design.id)!;
    expect(read().parts.flatMap((item) => item.pins).map((item) => item.electricalIntent)).toEqual(["future_intent_v7", "future_intent_v7"]);
    await dispatchOk(sdk, design.id, { type: "move_part", partId: "part", positionNm: { x: 8_000_000, y: 0 } });
    expect((await sdk.undo(design.id, TEST_SESSION)).ok).toBe(true);
    expect(read().parts.flatMap((item) => item.pins).every((item) => item.electricalIntent === "future_intent_v7")).toBe(true);
  });

  test("SDK rejects missing, primitive, cross-design pins, unknown intent and library NC source atomically", async () => {
    const { sdk } = await bootDesignerRuntime("pin-intent-reject");
    const design = await sdk.createDesign();
    const other = await sdk.createDesign();
    replaceSchematicProjection(getSharedDb(), design.id, ercProjection({ revision: 0, parts: [ercPart([ercPin("p", "no_connect")])] }), new Date().toISOString());
    const base = { type: "set_pin_electrical_intent", pinId: "p", intent: "power_source" };
    for (const [target, command, code] of [
      [design.id, base, "INVALID_PIN_ELECTRICAL_INTENT"],
      [design.id, { ...base, intent: "future" }, "INVALID_PIN_ELECTRICAL_INTENT"],
      [design.id, { ...base, pinId: "missing" }, "PIN_NOT_FOUND"],
      [design.id, { ...base, pinId: "primitive:port" }, "PIN_NOT_FOUND"],
      [other.id, base, "PIN_NOT_FOUND"],
    ] as const) {
      const body = envelope(target, 0, command as unknown as DesignerCommand);
      const result = await sdk.dispatchCommand(target, body);
      expect(result).toMatchObject({ ok: false, code });
      expect(await sdk.dispatchCommand(target, body)).toMatchObject({ ok: false, code });
      expect((await sdk.getSchematicProjection(target))!.revision).toBe(0);
    }
    expect(getSharedDb().select().from(schematicPins).where(eq(schematicPins.id, "p")).get()!.electricalIntent).toBeNull();
  });

  test("HTTP parser requires exact intent and pin fields; valid command reaches storage", async () => {
    const { sdk, server } = await bootDesignerRuntime("pin-intent-http");
    const design = await sdk.createDesign();
    replaceSchematicProjection(getSharedDb(), design.id, ercProjection({ revision: 0, parts: [ercPart([ercPin("p", "input")])] }), new Date().toISOString());
    for (const fields of [
      { pinId: "p" }, { pinId: "p", intent: "future" }, { pinId: "p", intent: {} },
      { pinId: "", intent: null }, { pinId: "  ", intent: null }, { pinId: 1, intent: null },
    ]) {
      const body = envelope(design.id, 0, { type: "set_pin_electrical_intent", ...fields } as unknown as DesignerCommand);
      expect((await postCommand(server, design.id, body)).status).toBe(400);
    }
    const valid = await postCommand(server, design.id, envelope(design.id, 0, { type: "set_pin_electrical_intent", pinId: "p", intent: "no_connect" }));
    expect(valid.status).toBe(200);
    expect(loadSchematicProjection(getSharedDb(), design.id)!.parts[0]!.pins[0]!.electricalIntent).toBe("no_connect");
  });

  test("batch failure rolls back intent; valid batch has one revision and undo", async () => {
    const { sdk } = await bootDesignerRuntime("pin-intent-batch");
    const design = await sdk.createDesign();
    replaceSchematicProjection(getSharedDb(), design.id, ercProjection({
      revision: 0, parts: [ercPart([ercPin("p", "input"), ercPin("nc", "no_connect", 1_000_000)])],
    }), new Date().toISOString());
    const command: DesignerCommand = { type: "batch_commands", commands: [
      { type: "set_pin_electrical_intent", pinId: "p", intent: "no_connect" },
      { type: "set_pin_electrical_intent", pinId: "nc", intent: "power_source" },
    ] };
    expect(await sdk.dispatchCommand(design.id, envelope(design.id, 0, command))).toMatchObject({
      ok: false, code: "INVALID_PIN_ELECTRICAL_INTENT",
    });
    const read = () => loadSchematicProjection(getSharedDb(), design.id)!;
    expect(read().revision).toBe(0);
    expect(read().parts[0]!.pins.every((pin) => pin.electricalIntent === undefined)).toBe(true);
    await dispatchOk(sdk, design.id, { type: "batch_commands", commands: [
      { type: "set_pin_electrical_intent", pinId: "p", intent: "power_source" },
      { type: "set_pin_electrical_intent", pinId: "nc", intent: "no_connect" },
    ] });
    expect(read().revision).toBe(1);
    expect(read().parts[0]!.pins.every((pin) => pin.electricalIntent !== undefined)).toBe(true);
    expect((await sdk.undo(design.id, TEST_SESSION)).ok).toBe(true);
    expect(read().parts[0]!.pins.every((pin) => pin.electricalIntent === undefined)).toBe(true);
  });
});
