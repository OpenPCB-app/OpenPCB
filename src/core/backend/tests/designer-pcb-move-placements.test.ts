import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { DesignerCommand } from "../../../sdks/designer";
import { resetCaptureRuntimeForTesting } from "../../../modules/designer/backend/capture";
import { replaceSchematicProjection } from "../../../modules/designer/backend/projection-world";
import { designHeads, pcbEntities, sessionHistories } from "../../../modules/designer/backend/schema";
import { getSharedDb, resetSharedSqliteForTesting } from "../db/sqlite-client";
import { openReceiptStore } from "./designer-operation-receipts-harness";
import { ercPart, ercProjection } from "./helpers/erc-fixtures";

const SESSION = "designer-pcb-session";
const previousPath = process.env.OPENPCB_DB_PATH;
const previousCapture = process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
let folder: string | undefined;

afterEach(async () => {
  resetCaptureRuntimeForTesting();
  resetSharedSqliteForTesting();
  if (previousPath === undefined) delete process.env.OPENPCB_DB_PATH;
  else process.env.OPENPCB_DB_PATH = previousPath;
  if (previousCapture === undefined) delete process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
  else process.env.OPENPCB_FEATURE_DATASET_CAPTURE = previousCapture;
  if (folder) await rm(folder, { recursive: true, force: true });
  folder = undefined;
});

type Store = Awaited<ReturnType<typeof openReceiptStore>>;

async function send(store: Store, designId: string, command: DesignerCommand) {
  const head = getSharedDb().select().from(designHeads).where(eq(designHeads.id, designId)).get()!;
  return store.dispatchCommand(designId, {
    commandId: crypto.randomUUID(), sessionId: SESSION, aggregateId: designId,
    baseRevision: head.revision, issuedAt: Date.now(), command,
  });
}

async function fixture() {
  folder = await mkdtemp(path.join(os.tmpdir(), "designer-move-placements-"));
  const store = await openReceiptStore(path.join(folder, "domain.sqlite"));
  const design = await store.createDesign();
  const parts = [0, 1, 2].map((index) => ({
    ...ercPart([]), id: `part-${index}`, reference: `U${index + 1}`,
  }));
  replaceSchematicProjection(getSharedDb(), design.id, ercProjection({
    designId: design.id, revision: 0, parts,
  }), "2026-10-22T00:00:00.000Z");
  const projection = await store.getPcbProjection(design.id);
  expect(projection!.placements).toHaveLength(3);
  return { store, designId: design.id, placements: projection!.placements };
}

function rawState(designId: string) {
  const db = getSharedDb();
  return {
    pcb: db.select().from(pcbEntities).where(eq(pcbEntities.designId, designId)).orderBy(pcbEntities.id).all(),
    head: db.select().from(designHeads).where(eq(designHeads.id, designId)).get()!,
    history: db.select().from(sessionHistories).where(eq(sessionHistories.designId, designId)).all(),
  };
}

describe("pcb_move_placements dispatch atomicity", () => {
  test("late missing ID leaves raw PCB rows, head and persisted history unchanged", async () => {
    const { store, designId, placements } = await fixture();
    expect((await send(store, designId, {
      type: "pcb_move_placement", placementId: placements[0]!.id, positionMm: { x: 10, y: 11 },
    })).ok).toBe(true);
    const before = rawState(designId);
    const history = await store.getHistory(designId, SESSION);
    const result = await send(store, designId, {
      type: "pcb_move_placements", updates: [
        { placementId: placements[0]!.id, positionMm: { x: 20, y: 21 } },
        { placementId: placements[1]!.id, positionMm: { x: 30, y: 31 } },
        { placementId: "missing-late", positionMm: { x: 40, y: 41 } },
      ],
    });
    expect(result).toEqual({ ok: false, code: "PCB_PLACEMENT_NOT_FOUND", placementId: "missing-late" });
    expect(rawState(designId)).toEqual(before);
    expect(await store.getHistory(designId, SESSION)).toEqual(history);
  });

  test("success preserves input order, nm rounding, timestamps and one undo/redo", async () => {
    const { store, designId, placements } = await fixture();
    const before = rawState(designId);
    const result = await send(store, designId, {
      type: "pcb_move_placements", updates: [
        { placementId: placements[0]!.id, positionMm: { x: 1, y: 2 } },
        { placementId: placements[1]!.id, positionMm: { x: 12.1234567, y: -7.1234567 } },
        { placementId: placements[0]!.id, positionMm: { x: 22.9876543, y: 9.0000004 } },
      ],
    });
    expect(result).toMatchObject({ ok: true, revision: before.head.revision + 1 });
    const projection = (await store.getPcbProjection(designId))!;
    expect(projection.placements.find((part) => part.id === placements[0]!.id)!.positionMm)
      .toEqual({ x: 22.987654, y: 9 });
    expect(projection.placements.find((part) => part.id === placements[1]!.id)!.positionMm)
      .toEqual({ x: 12.123457, y: -7.123457 });
    expect(projection.placements.find((part) => part.id === placements[2]!.id)).toEqual(placements[2]);
    const after = rawState(designId);
    for (const placement of placements.slice(0, 2)) {
      const row = after.pcb.find((entry) => entry.id === placement.id)!;
      expect(row.createdAt).toBe(before.pcb.find((entry) => entry.id === placement.id)!.createdAt);
      expect(row.updatedAt).toBe(after.head.updatedAt);
    }
    expect(after.pcb.find((row) => row.id === placements[2]!.id))
      .toEqual(before.pcb.find((row) => row.id === placements[2]!.id));
    expect((await store.getHistory(designId, SESSION)).undoDepth).toBe(1);
    expect((await store.undo(designId, SESSION)).ok).toBe(true);
    expect((await store.getPcbProjection(designId))!.placements).toEqual(placements);
    expect((await store.getHistory(designId, SESSION)).undoDepth).toBe(0);
    expect((await store.redo(designId, SESSION)).ok).toBe(true);
    expect((await store.getPcbProjection(designId))!.placements).toEqual(projection.placements);
  });

  test("empty updates retain successful revision bump without PCB writes or undo entry", async () => {
    const { store, designId } = await fixture();
    const before = rawState(designId);
    expect(await send(store, designId, { type: "pcb_move_placements", updates: [] }))
      .toMatchObject({ ok: true, revision: before.head.revision + 1 });
    expect(rawState(designId).pcb).toEqual(before.pcb);
    expect((await store.getHistory(designId, SESSION)).undoDepth).toBe(0);
  });
});
