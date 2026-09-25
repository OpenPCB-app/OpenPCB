import { describe, expect, test } from "bun:test";
import type { DesignerBatchableCommand, DesignerSDK } from "../../../sdks";
import {
  bootDesignerRuntime,
  dispatchOk,
  envelope,
  importCapacitorComponent,
  placeCapacitors,
  postCommand,
  TEST_SESSION,
} from "./helpers/designer-runtime";

async function wirePins(
  sdk: DesignerSDK,
  designId: string,
  fromPartId: string,
  toPartId: string,
): Promise<string> {
  const projection = (await sdk.getSchematicProjection(designId))!;
  const pinOf = (partId: string, index: number) =>
    projection.parts.find((part) => part.id === partId)!.pins[index]!.id;
  const created = await dispatchOk(sdk, designId, {
    type: "create_wire",
    sourcePinId: pinOf(fromPartId, 1),
    targetPinId: pinOf(toPartId, 0),
  });
  return created.createdEntityId!;
}

async function counts(sdk: DesignerSDK, designId: string) {
  const projection = (await sdk.getSchematicProjection(designId))!;
  return {
    revision: projection.revision,
    parts: projection.parts.length,
    wires: projection.wires.length,
    labels: projection.labels.length,
  };
}

describe("batch_commands (T-096)", () => {
  test("a multi-delete is ONE revision and ONE undo step that restores everything", async () => {
    const { sdk, server } = await bootDesignerRuntime("batch-delete");
    const design = await sdk.createDesign({ name: "Batch delete" });
    const componentId = await importCapacitorComponent(server);
    const partIds = await placeCapacitors(sdk, design.id, componentId, 4);
    const wireId = await wirePins(sdk, design.id, partIds[0]!, partIds[1]!);
    const label = await dispatchOk(sdk, design.id, {
      type: "upsert_label",
      text: "SDA",
      positionNm: { x: 50_000_000, y: 50_000_000 },
    });
    const before = await counts(sdk, design.id);
    expect(before.wires).toBe(1);
    const historyBefore = await sdk.getHistory(design.id, TEST_SESSION);

    // The wire is listed AFTER the part that already removes it (cascade).
    const commands: DesignerBatchableCommand[] = [
      ...partIds.map((entityId) => ({
        type: "delete_entity" as const,
        entityId,
        entityKind: "part" as const,
      })),
      { type: "delete_entity", entityId: wireId, entityKind: "wire" },
      {
        type: "delete_entity",
        entityId: label.createdEntityId!,
        entityKind: "label",
      },
    ];
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, before.revision, {
        type: "batch_commands",
        commands,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision).toBe(before.revision + 1);

    const after = await counts(sdk, design.id);
    expect(after).toEqual({
      revision: before.revision + 1,
      parts: 0,
      wires: 0,
      labels: 0,
    });
    const history = await sdk.getHistory(design.id, TEST_SESSION);
    expect(history.undoDepth).toBe(historyBefore.undoDepth + 1);

    const undone = await sdk.undo(design.id, TEST_SESSION);
    expect(undone.ok).toBe(true);
    const restored = await counts(sdk, design.id);
    expect(restored.parts).toBe(before.parts);
    expect(restored.wires).toBe(before.wires);
    expect(restored.labels).toBe(before.labels);

    const redone = await sdk.redo(design.id, TEST_SESSION);
    expect(redone.ok).toBe(true);
    expect((await counts(sdk, design.id)).parts).toBe(0);
  });

  test("a failing step fails the whole batch and persists nothing", async () => {
    const { sdk, server } = await bootDesignerRuntime("batch-rollback");
    const design = await sdk.createDesign({ name: "Batch rollback" });
    const componentId = await importCapacitorComponent(server);
    const [partId] = await placeCapacitors(sdk, design.id, componentId, 1);
    const before = await counts(sdk, design.id);
    const historyBefore = await sdk.getHistory(design.id, TEST_SESSION);

    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, before.revision, {
        type: "batch_commands",
        commands: [
          { type: "delete_entity", entityId: partId!, entityKind: "part" },
          { type: "delete_entity", entityId: "no-such-wire", entityKind: "wire" },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ENTITY_NOT_FOUND");

    // The first step's delete was rolled back with the savepoint.
    expect(await counts(sdk, design.id)).toEqual(before);
    const history = await sdk.getHistory(design.id, TEST_SESSION);
    expect(history.undoDepth).toBe(historyBefore.undoDepth);
  });

  test("a multi-rotate lands as one undo step", async () => {
    const { sdk, server } = await bootDesignerRuntime("batch-rotate");
    const design = await sdk.createDesign({ name: "Batch rotate" });
    const componentId = await importCapacitorComponent(server);
    const partIds = await placeCapacitors(sdk, design.id, componentId, 3);
    await dispatchOk(sdk, design.id, {
      type: "batch_commands",
      commands: partIds.map((partId) => ({
        type: "rotate_part" as const,
        partId,
        rotationDeg: 90 as const,
      })),
    });
    const rotated = (await sdk.getSchematicProjection(design.id))!;
    expect(rotated.parts.every((part) => part.rotationDeg === 90)).toBe(true);

    await sdk.undo(design.id, TEST_SESSION);
    const reverted = (await sdk.getSchematicProjection(design.id))!;
    expect(reverted.parts.every((part) => part.rotationDeg === 0)).toBe(true);
  });

  test("PCB steps are snapshotted too: a batched placement move undoes in one step", async () => {
    const { sdk, server } = await bootDesignerRuntime("batch-pcb");
    const design = await sdk.createDesign({ name: "Batch pcb" });
    const componentId = await importCapacitorComponent(server);
    await placeCapacitors(sdk, design.id, componentId, 2);
    const pcb = (await sdk.getPcbProjection(design.id))!;
    const original = new Map(
      pcb.placements.map((p) => [p.id, { ...p.positionMm }]),
    );
    await dispatchOk(sdk, design.id, {
      type: "batch_commands",
      commands: pcb.placements.map((placement, i) => ({
        type: "pcb_move_placement" as const,
        placementId: placement.id,
        positionMm: { x: 5 + i * 5, y: 7 },
      })),
    });
    const moved = (await sdk.getPcbProjection(design.id))!;
    expect(moved.placements.every((p) => p.positionMm.y === 7)).toBe(true);

    await sdk.undo(design.id, TEST_SESSION);
    const reverted = (await sdk.getPcbProjection(design.id))!;
    for (const placement of reverted.placements) {
      expect(placement.positionMm).toEqual(original.get(placement.id)!);
    }
  });

  test("the HTTP parser accepts a batch and refuses nesting, place_part and empty batches", async () => {
    const { sdk, server } = await bootDesignerRuntime("batch-http");
    const design = await sdk.createDesign({ name: "Batch http" });
    const label = await dispatchOk(sdk, design.id, {
      type: "upsert_label",
      text: "A",
      positionNm: { x: 0, y: 0 },
    });
    const head = await counts(sdk, design.id);
    const post = (command: unknown) =>
      postCommand(server, design.id, {
        commandId: crypto.randomUUID(),
        sessionId: TEST_SESSION,
        aggregateId: design.id,
        baseRevision: head.revision,
        issuedAt: Date.now(),
        command,
      });

    for (const bad of [
      { type: "batch_commands", commands: [] },
      {
        type: "batch_commands",
        commands: [{ type: "batch_commands", commands: [] }],
      },
      {
        type: "batch_commands",
        commands: [
          { type: "place_part", componentId: "x", positionNm: { x: 0, y: 0 } },
        ],
      },
      {
        type: "batch_commands",
        commands: [{ type: "delete_entity", entityId: 5, entityKind: "label" }],
      },
    ]) {
      const response = await post(bad);
      expect(response.status).toBe(400);
    }

    const ok = await post({
      type: "batch_commands",
      commands: [
        {
          type: "delete_entity",
          entityId: label.createdEntityId,
          entityKind: "label",
        },
      ],
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { data: { result: { ok: boolean } } };
    expect(body.data.result.ok).toBe(true);
    expect((await counts(sdk, design.id)).labels).toBe(0);
  });
});
