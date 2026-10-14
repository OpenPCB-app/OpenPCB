import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DesignerCommand, DesignerCommandEnvelope } from "../../../sdks/designer";
import { resetCaptureRuntimeForTesting } from "../../../modules/designer/backend/capture";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { openReceiptStore } from "./designer-operation-receipts-harness";

// Mirror the fixed ids the frontend uses (useDesignerWorkspace / usePcbWorkspace).
const UI_SESSION = "designer-ui-session";
const PCB_SESSION = "designer-pcb-session";

let folder: string;
let file: string;
const oldPath = process.env.OPENPCB_DB_PATH;
const oldCapture = process.env.OPENPCB_FEATURE_DATASET_CAPTURE;

beforeEach(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), "designer-history-session-"));
  file = path.join(folder, "domain.sqlite");
});

afterEach(async () => {
  resetCaptureRuntimeForTesting();
  resetSharedSqliteForTesting();
  if (oldPath === undefined) delete process.env.OPENPCB_DB_PATH;
  else process.env.OPENPCB_DB_PATH = oldPath;
  if (oldCapture === undefined) delete process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
  else process.env.OPENPCB_FEATURE_DATASET_CAPTURE = oldCapture;
  await rm(folder, { recursive: true, force: true });
});

type Store = Awaited<ReturnType<typeof openReceiptStore>>;

async function send(
  store: Store,
  designId: string,
  sessionId: string,
  command: DesignerCommand,
) {
  const head = await store.getSchematicProjection(designId);
  const envelope: DesignerCommandEnvelope = {
    commandId: crypto.randomUUID(),
    sessionId,
    aggregateId: designId,
    baseRevision: head?.revision ?? null,
    issuedAt: Date.now(),
    command,
  };
  const result = await store.dispatchCommand(designId, envelope);
  if (!result.ok) throw new Error(`${command.type} failed: ${JSON.stringify(result)}`);
  return result;
}

const label = (text: string): DesignerCommand => ({
  type: "upsert_label",
  text,
  positionNm: { x: 0, y: 0 },
});
const hole: DesignerCommand = {
  type: "pcb_add_free_hole",
  centerMm: { x: 3, y: 4 },
  drillMm: 1,
};

describe("designer undo history sessions", () => {
  test("history survives store re-instantiation for the same session id", async () => {
    const first = await openReceiptStore(file);
    const design = await first.createDesign();
    await send(first, design.id, UI_SESSION, label("KEEP"));
    expect((await first.getSchematicProjection(design.id))!.labels).toHaveLength(1);

    const second = await openReceiptStore(file); // remount / app restart
    expect((await second.getHistory(design.id, UI_SESSION)).undoDepth).toBe(1);
    const undone = await second.undo(design.id, UI_SESSION);
    expect(undone.ok).toBe(true);
    expect((await second.getSchematicProjection(design.id))!.labels).toHaveLength(0);
  });

  test("a different session id sees no history (HISTORY_EMPTY)", async () => {
    const first = await openReceiptStore(file);
    const design = await first.createDesign();
    await send(first, design.id, UI_SESSION, label("KEEP"));

    const second = await openReceiptStore(file);
    const other = await second.undo(design.id, "some-other-session");
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.code).toBe("HISTORY_EMPTY");
    expect((await second.getSchematicProjection(design.id))!.labels).toHaveLength(1);
  });

  test("schematic and PCB sessions keep independent stacks", async () => {
    const store = await openReceiptStore(file);
    const design = await store.createDesign();
    await send(store, design.id, UI_SESSION, label("SCH"));
    await send(store, design.id, PCB_SESSION, hole);

    const reopened = await openReceiptStore(file);
    expect((await reopened.getHistory(design.id, UI_SESSION)).undoDepth).toBe(1);
    expect((await reopened.getHistory(design.id, PCB_SESSION)).undoDepth).toBe(1);

    expect((await reopened.undo(design.id, UI_SESSION)).ok).toBe(true);
    expect((await reopened.getSchematicProjection(design.id))!.labels).toHaveLength(0);
    expect((await reopened.getPcbProjection(design.id))!.freeHoles).toHaveLength(1);
    expect((await reopened.getHistory(design.id, PCB_SESSION)).undoDepth).toBe(1);
  });
});
