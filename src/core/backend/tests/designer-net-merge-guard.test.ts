import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  DesignerBatchableCommand,
  DesignerCommand,
  DesignerCommandEnvelope,
  DesignerDerivedNet,
} from "../../../sdks/designer";
import { resetCaptureRuntimeForTesting } from "../../../modules/designer/backend/capture";
import { detectNetMerge } from "../../../modules/designer/backend/net-merge-guard";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { openReceiptStore } from "./designer-operation-receipts-harness";

const SESSION = "designer-ui-session";
const MM = 1_000_000;

function net(
  name: string,
  pins: string[],
  extra: Partial<DesignerDerivedNet> = {},
): DesignerDerivedNet {
  return {
    id: `root:${name}:${pins.join(",")}`,
    name,
    pinIds: pins,
    wireIds: [],
    labelIds: [],
    primitiveIds: [],
    ...extra,
  };
}

describe("detectNetMerge (pure)", () => {
  test("two named nets fusing are reported with BEFORE names and pin counts", () => {
    const before = [net("VCC", ["a", "b"]), net("SIG", ["c"])];
    const after = [net("SIG", ["a", "b", "c"])];
    expect(detectNetMerge(before, after)).toEqual({
      nets: [
        { name: "VCC", pinCount: 2 },
        { name: "SIG", pinCount: 1 },
      ],
    });
  });

  test("naming an unnamed single-pin net is not a merge", () => {
    expect(detectNetMerge([net("Net_1", ["a"])], [net("VCC", ["a"])])).toBeNull();
  });

  test("unnamed single-pin stub joining a named net is not significant", () => {
    const before = [net("VCC", ["a", "b"]), net("Net_1", ["c"])];
    const after = [net("VCC", ["a", "b", "c"])];
    expect(detectNetMerge(before, after)).toBeNull();
  });

  test("unnamed multi-pin net joining ONE named net is ordinary naming", () => {
    // e.g. a GND port dropped on a 2-pin net: no confirm.
    const before = [net("VCC", ["a"]), net("Net_2", ["b", "c"])];
    const after = [net("VCC", ["a", "b", "c"])];
    expect(detectNetMerge(before, after)).toBeNull();
  });

  test("two unnamed multi-pin nets fusing are a merge (null names)", () => {
    const before = [net("Net_1", ["a", "b"]), net("Net_2", ["c", "d"])];
    const after = [net("SIG", ["a", "b", "c", "d"])];
    expect(detectNetMerge(before, after)).toEqual({
      nets: [
        { name: null, pinCount: 2 },
        { name: null, pinCount: 2 },
      ],
    });
  });

  test("members without pins (label/primitive-only nets) are matched by entity id", () => {
    const before = [
      net("A", [], { labelIds: ["l1"] }),
      net("B", [], { primitiveIds: ["p1"] }),
    ];
    const after = [net("A", [], { labelIds: ["l1"], primitiveIds: ["p1", "p2"] })];
    expect(detectNetMerge(before, after)?.nets).toHaveLength(2);
  });

  test("unrelated nets stay apart", () => {
    const before = [net("A", ["a"]), net("B", ["b"])];
    expect(detectNetMerge(before, [net("A", ["a"]), net("B", ["b"])])).toBeNull();
  });
});

let folder: string;
let file: string;
const oldPath = process.env.OPENPCB_DB_PATH;
const oldCapture = process.env.OPENPCB_FEATURE_DATASET_CAPTURE;

beforeEach(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), "designer-net-merge-"));
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

async function send(store: Store, designId: string, command: DesignerCommand) {
  const head = await store.getSchematicProjection(designId);
  const envelope: DesignerCommandEnvelope = {
    commandId: crypto.randomUUID(),
    sessionId: SESSION,
    aggregateId: designId,
    baseRevision: head?.revision ?? null,
    issuedAt: Date.now(),
    command,
  };
  return store.dispatchCommand(designId, envelope);
}

const label = (text: string, xMm: number): DesignerBatchableCommand => ({
  type: "upsert_label",
  text,
  positionNm: { x: xMm * MM, y: 0 },
});

async function twoNamedNets(store: Store) {
  const design = await store.createDesign();
  expect((await send(store, design.id, label("A", 0))).ok).toBe(true);
  expect((await send(store, design.id, label("B", 10))).ok).toBe(true);
  return design.id;
}

describe("net-merge gate (integration)", () => {
  test("merging portal is refused without confirm and leaves no trace", async () => {
    const store = await openReceiptStore(file);
    const id = await twoNamedNets(store);
    const before = (await store.getSchematicProjection(id))!;
    const histBefore = await store.getHistory(id, SESSION);
    expect(before.nets.map((n) => n.name).sort()).toEqual(["A", "B"]);

    const result = await send(store, id, {
      type: "place_net_portal",
      positionNm: { x: 10 * MM, y: 0 },
      portalText: "A",
    });
    expect(result.ok).toBe(false);
    if (result.ok || result.code !== "NET_MERGE_REQUIRES_CONFIRM") throw new Error("wrong result");
    expect(result.nets.map((n) => n.name).sort()).toEqual(["A", "B"]);

    const after = (await store.getSchematicProjection(id))!;
    expect(after.revision).toBe(before.revision);
    expect(after.nets).toEqual(before.nets);
    expect(after.primitives ?? []).toHaveLength(0);
    expect(await store.getHistory(id, SESSION)).toEqual(histBefore);
  });

  test("confirmMerge:true merges atomically; one undo restores both nets", async () => {
    const store = await openReceiptStore(file);
    const id = await twoNamedNets(store);
    const histBefore = await store.getHistory(id, SESSION);

    const result = await send(store, id, {
      type: "place_net_portal",
      positionNm: { x: 10 * MM, y: 0 },
      portalText: "A",
      confirmMerge: true,
    });
    expect(result.ok).toBe(true);
    const merged = (await store.getSchematicProjection(id))!;
    expect(merged.nets).toHaveLength(1);
    expect((await store.getHistory(id, SESSION)).undoDepth).toBe(histBefore.undoDepth + 1);

    expect((await store.undo(id, SESSION)).ok).toBe(true);
    const restored = (await store.getSchematicProjection(id))!;
    expect(restored.nets.map((n) => n.name).sort()).toEqual(["A", "B"]);
  });

  test("relabeling one net into another's name is refused", async () => {
    const store = await openReceiptStore(file);
    const id = await twoNamedNets(store);
    const proj = (await store.getSchematicProjection(id))!;
    const b = proj.labels.find((l) => l.text === "B")!;
    const result = await send(store, id, {
      type: "upsert_label",
      labelId: b.id,
      text: "A",
      positionNm: b.positionNm,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NET_MERGE_REQUIRES_CONFIRM");
    const after = (await store.getSchematicProjection(id))!;
    expect(after.labels.find((l) => l.id === b.id)?.text).toBe("B");
  });

  test("benign label on empty space needs no confirm", async () => {
    const store = await openReceiptStore(file);
    const id = await twoNamedNets(store);
    const result = await send(store, id, label("C", 30));
    expect(result.ok).toBe(true);
  });

  test("GND port joining two named nets is refused, confirmed merges", async () => {
    const store = await openReceiptStore(file);
    const design = await store.createDesign();
    const id = design.id;
    expect((await send(store, id, label("SIG", 0))).ok).toBe(true);
    expect((await send(store, id, label("VCC", 10))).ok).toBe(true);
    // First GND port renames SIG's net to GND: one before-net, no merge.
    expect((await send(store, id, {
      type: "place_gnd_port",
      positionNm: { x: 0, y: 0 },
    })).ok).toBe(true);
    // Second GND port on VCC's net fuses it with the GND net (one GND name).
    const refused = await send(store, id, {
      type: "place_gnd_port",
      positionNm: { x: 10 * MM, y: 0 },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("NET_MERGE_REQUIRES_CONFIRM");
    const ok = await send(store, id, {
      type: "place_gnd_port",
      positionNm: { x: 10 * MM, y: 0 },
      confirmMerge: true,
    });
    expect(ok.ok).toBe(true);
    expect((await store.getSchematicProjection(id))!.nets).toHaveLength(1);
  });
  test("batch carrying a merging gated step is refused whole and leaves no trace", async () => {
    const store = await openReceiptStore(file);
    const id = await twoNamedNets(store);
    const before = (await store.getSchematicProjection(id))!;
    const histBefore = await store.getHistory(id, SESSION);
    const result = await send(store, id, {
      type: "batch_commands",
      commands: [
        label("C", 30),
        { type: "place_net_portal", positionNm: { x: 10 * MM, y: 0 }, portalText: "A" },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok || result.code !== "NET_MERGE_REQUIRES_CONFIRM") throw new Error("wrong result");
    const after = (await store.getSchematicProjection(id))!;
    expect(after.revision).toBe(before.revision);
    expect(after.nets).toEqual(before.nets);
    expect(after.labels).toHaveLength(before.labels.length);
    expect(await store.getHistory(id, SESSION)).toEqual(histBefore);
  });

  test("batch with confirmMerge:true on the step merges; benign batch passes", async () => {
    const store = await openReceiptStore(file);
    const id = await twoNamedNets(store);
    expect((await send(store, id, { type: "batch_commands", commands: [label("C", 30)] })).ok).toBe(true);
    const merged = await send(store, id, {
      type: "batch_commands",
      commands: [
        {
          type: "place_net_portal",
          positionNm: { x: 10 * MM, y: 0 },
          portalText: "A",
          confirmMerge: true,
        },
      ],
    });
    expect(merged.ok).toBe(true);
  });
});
