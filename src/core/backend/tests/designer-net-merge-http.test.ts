import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { DesignerCommand, DesignerDispatchResult } from "../../../sdks/designer";
import { resetCaptureRuntimeForTesting } from "../../../modules/designer/backend/capture";
import { commandLog } from "../../../modules/designer/backend/schema";
import { getSharedDb, getSharedSqlite, resetSharedSqliteForTesting } from "../db/sqlite-client";
import { bootDesignerRuntime, dispatchOk, envelope, importCapacitorComponent, postCommand } from "./helpers/designer-runtime";

const previousPath = process.env.OPENPCB_DB_PATH, previousCapture = process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
const files: string[] = [];
afterEach(() => {
  resetCaptureRuntimeForTesting(); resetSharedSqliteForTesting();
  if (previousPath === undefined) delete process.env.OPENPCB_DB_PATH; else process.env.OPENPCB_DB_PATH = previousPath;
  if (previousCapture === undefined) delete process.env.OPENPCB_FEATURE_DATASET_CAPTURE; else process.env.OPENPCB_FEATURE_DATASET_CAPTURE = previousCapture;
  for (const file of files.splice(0)) for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
});

function rawRows(): string {
  const sqlite = getSharedSqlite();
  const tables = sqlite.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'designer_%' ORDER BY name").all();
  return JSON.stringify(tables.map(({ name }) => ({ name, rows: sqlite.query(`SELECT * FROM "${name}" ORDER BY rowid`).all() })));
}

describe("HTTP merge confirmation fields", () => {
  test("all ten added command parsers retain true/false consent and refuse invalid values before writes", async () => {
    process.env.OPENPCB_FEATURE_DATASET_CAPTURE = "0";
    const { sdk, server } = await bootDesignerRuntime("merge-confirm-http"); files.push(process.env.OPENPCB_DB_PATH!);
    const design = await sdk.createDesign(), id = design.id, componentId = await importCapacitorComponent(server);
    const part = await dispatchOk(sdk, id, { type: "place_part", componentId, positionNm: { x: 0, y: 0 } });
    const initial = (await sdk.getSchematicProjection(id))!, pins = initial.parts[0]!.pins;
    const wire = await dispatchOk(sdk, id, { type: "create_wire", sourcePinId: pins[0]!.id, targetPinId: pins[1]!.id });
    const primitive = await dispatchOk(sdk, id, { type: "place_net_portal", portalText: "Unique", positionNm: { x: 1_000_000_000, y: 1_000_000_000 } });
    const commands: DesignerCommand[] = [
      { type: "place_part", componentId, positionNm: { x: 100_000_000, y: 100_000_000 } },
      { type: "duplicate_part", partId: part.createdEntityId!, positionNm: { x: 500_000_000, y: 500_000_000 } },
      { type: "move_part", partId: part.createdEntityId!, positionNm: { x: 20_000_000, y: 20_000_000 } },
      { type: "rotate_part", partId: part.createdEntityId!, rotationDeg: 90 },
      { type: "mirror_part", partId: part.createdEntityId!, mirrored: true },
      { type: "move_primitive", primitiveId: primitive.createdEntityId!, positionNm: { x: 1_100_000_000, y: 1_100_000_000 } },
      { type: "rotate_primitive", primitiveId: primitive.createdEntityId!, rotationDeg: 90 },
      { type: "update_primitive_text", primitiveId: primitive.createdEntityId!, text: "StillUnique" },
      { type: "update_wire_geometry", wireId: wire.createdEntityId!, pointsNm: initial.parts[0]!.pins.map(pin => pin.worldPositionNm) },
      { type: "auto_arrange_schematic", originNm: { x: 50_000_000, y: 50_000_000 }, scope: "all" },
    ];
    for (const command of commands) {
      for (const confirmMerge of [true, false]) {
        const current = (await sdk.getSchematicProjection(id))!;
        const body = envelope(id, current.revision, { ...command, confirmMerge } as DesignerCommand);
        const response = await postCommand(server, id, body);
        expect(response.status).toBe(200);
        const result = ((await response.json()) as { data: { result: DesignerDispatchResult } }).data.result;
        expect(result.ok).toBe(true);
        const logged = getSharedDb().select().from(commandLog).where(eq(commandLog.commandId, body.commandId)).get()!;
        expect((JSON.parse(logged.commandJson) as { confirmMerge: boolean }).confirmMerge).toBe(confirmMerge);
      }
      for (const invalid of ["true", 1, {}, []]) {
        const current = (await sdk.getSchematicProjection(id))!, before = rawRows();
        const response = await postCommand(server, id, { ...envelope(id, current.revision, command), command: { ...command, confirmMerge: invalid } });
        expect(response.status).toBe(400); expect(await response.text()).toContain("command.confirmMerge must be a boolean");
        expect(rawRows()).toBe(before);
      }
    }
  });
});
