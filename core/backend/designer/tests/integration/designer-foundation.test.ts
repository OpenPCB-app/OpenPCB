import { describe, expect, test } from "bun:test";
import { createInMemoryDesignerFoundation } from "../../application/create-in-memory-foundation";
import type { CommandEnvelope } from "../../contracts/commands/command-envelope";
import type { DesignerCommand } from "../../contracts/commands/command-envelope";

const ROOT_SHEET_ID = "sheet-root";
const SESSION_ID = "session-1";

function commandEnvelope(
  commandId: string,
  baseRevision: number | null,
  command: DesignerCommand,
  designId?: string,
): CommandEnvelope<DesignerCommand> {
  return {
    commandId,
    sessionId: SESSION_ID,
    designId,
    baseRevision,
    command,
    issuedAt: Date.now(),
  };
}

function singlePinSnapshot(referencePrefix: string = "U") {
  return {
    symbolKind: "generic",
    referencePrefix,
    pins: [
      {
        originPinKey: "1",
        name: "1",
        localPosition: { xNm: 0, yNm: 0 },
      },
    ],
  };
}

describe("designer foundation", () => {
  test("creates default root sheet and places first part", async () => {
    const foundation = createInMemoryDesignerFoundation();

    const result = await foundation.dispatchCommand.execute(
      commandEnvelope("cmd-1", null, {
        type: "place_part",
        partInstanceId: "part-1",
        sheetId: ROOT_SHEET_ID,
        xNm: 0,
        yNm: 0,
        rotationDeg: 0,
        mirrored: false,
        originRef: { componentId: "cmp-1", variantId: "var-1" },
        symbolSnapshot: singlePinSnapshot("R"),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const projection = await foundation.getSchematicProjection.execute(result.designId);
    expect(projection).not.toBeNull();
    expect(projection?.sheets).toEqual([{ id: ROOT_SHEET_ID, title: "Sheet 1", index: 0 }]);
    expect(projection?.parts).toHaveLength(1);
    expect(projection?.parts[0]?.reference).toBe("R1");
  });

  test("placing a part onto existing wire keeps net stable and joins same net", async () => {
    const foundation = createInMemoryDesignerFoundation();

    const placeA = await foundation.dispatchCommand.execute(
      commandEnvelope("cmd-a", null, {
        type: "place_part",
        partInstanceId: "part-a",
        sheetId: ROOT_SHEET_ID,
        xNm: 0,
        yNm: 0,
        rotationDeg: 0,
        mirrored: false,
        originRef: { componentId: "cmp-a", variantId: "var-a" },
        symbolSnapshot: singlePinSnapshot("U"),
      }),
    );
    if (!placeA.ok) throw new Error("placeA failed");

    const placeB = await foundation.dispatchCommand.execute(
      commandEnvelope("cmd-b", placeA.nextRevision, {
        type: "place_part",
        partInstanceId: "part-b",
        sheetId: ROOT_SHEET_ID,
        xNm: 2_540_000,
        yNm: 0,
        rotationDeg: 0,
        mirrored: false,
        originRef: { componentId: "cmp-b", variantId: "var-b" },
        symbolSnapshot: singlePinSnapshot("U"),
      }, placeA.designId),
    );
    if (!placeB.ok) throw new Error("placeB failed");

    const wire = await foundation.dispatchCommand.execute(
      commandEnvelope("cmd-wire", placeB.nextRevision, {
        type: "create_wire",
        wireId: "wire-1",
        sheetId: ROOT_SHEET_ID,
        pointsNm: [
          { xNm: 0, yNm: 0 },
          { xNm: 2_540_000, yNm: 0 },
        ],
      }, placeA.designId),
    );
    if (!wire.ok) throw new Error("wire failed");

    const before = await foundation.getSchematicProjection.execute(placeA.designId);
    expect(before?.nets).toHaveLength(1);
    const originalNetId = before?.nets[0]?.id;

    const placeC = await foundation.dispatchCommand.execute(
      commandEnvelope("cmd-c", wire.nextRevision, {
        type: "place_part",
        partInstanceId: "part-c",
        sheetId: ROOT_SHEET_ID,
        xNm: 1_270_000,
        yNm: 0,
        rotationDeg: 0,
        mirrored: false,
        originRef: { componentId: "cmp-c", variantId: "var-c" },
        symbolSnapshot: singlePinSnapshot("U"),
      }, placeA.designId),
    );
    if (!placeC.ok) throw new Error("placeC failed");

    const after = await foundation.getSchematicProjection.execute(placeA.designId);
    expect(after?.nets).toHaveLength(1);
    expect(after?.nets[0]?.id).toBe(originalNetId);
  });

  test("duplicate provided reference is rejected", async () => {
    const foundation = createInMemoryDesignerFoundation();
    const first = await foundation.dispatchCommand.execute(
      commandEnvelope("cmd-1", null, {
        type: "place_part",
        partInstanceId: "part-1",
        sheetId: ROOT_SHEET_ID,
        xNm: 0,
        yNm: 0,
        rotationDeg: 0,
        mirrored: false,
        originRef: { componentId: "cmp-1", variantId: "var-1" },
        symbolSnapshot: singlePinSnapshot("R"),
        reference: "R42",
      }),
    );
    if (!first.ok) throw new Error("first placement failed");

    await expect(
      foundation.dispatchCommand.execute(
        commandEnvelope("cmd-2", first.nextRevision, {
          type: "place_part",
          partInstanceId: "part-2",
          sheetId: ROOT_SHEET_ID,
          xNm: 1_270_000,
          yNm: 0,
          rotationDeg: 0,
          mirrored: false,
          originRef: { componentId: "cmp-2", variantId: "var-2" },
          symbolSnapshot: singlePinSnapshot("R"),
          reference: "R42",
        }, first.designId),
      ),
    ).rejects.toThrow("Duplicate part reference");
  });

  test("entity revision stamping and createdAt are preserved across updates", async () => {
    const foundation = createInMemoryDesignerFoundation();
    const placed = await foundation.dispatchCommand.execute(
      commandEnvelope("cmd-1", null, {
        type: "place_part",
        partInstanceId: "part-1",
        sheetId: ROOT_SHEET_ID,
        xNm: 0,
        yNm: 0,
        rotationDeg: 0,
        mirrored: false,
        originRef: { componentId: "cmp-1", variantId: "var-1" },
        symbolSnapshot: singlePinSnapshot("C"),
      }),
    );
    if (!placed.ok) throw new Error("place failed");

    const firstRow = (await foundation.internals.entityRepository.listByDesign(placed.designId)).find(
      (row) => row.id === "part-1",
    );
    expect(firstRow?.createdRevision).toBe(1);
    expect(firstRow?.updatedRevision).toBe(1);
    const firstCreatedAt = firstRow?.createdAt;

    const updated = await foundation.dispatchCommand.execute(
      commandEnvelope("cmd-2", placed.nextRevision, {
        type: "set_part_value",
        partInstanceId: "part-1",
        value: "100nF",
      }, placed.designId),
    );
    if (!updated.ok) throw new Error("update failed");

    const secondRow = (await foundation.internals.entityRepository.listByDesign(placed.designId)).find(
      (row) => row.id === "part-1",
    );
    expect(secondRow?.createdRevision).toBe(1);
    expect(secondRow?.updatedRevision).toBe(2);
    expect(secondRow?.createdAt).toBe(firstCreatedAt);
  });

  test("existing design requires non-null baseRevision", async () => {
    const foundation = createInMemoryDesignerFoundation();
    const placed = await foundation.dispatchCommand.execute(
      commandEnvelope("cmd-1", null, {
        type: "place_part",
        partInstanceId: "part-1",
        sheetId: ROOT_SHEET_ID,
        xNm: 0,
        yNm: 0,
        rotationDeg: 0,
        mirrored: false,
        originRef: { componentId: "cmp-1", variantId: "var-1" },
        symbolSnapshot: singlePinSnapshot("U"),
      }),
    );
    if (!placed.ok) throw new Error("place failed");

    const staleWrite = await foundation.dispatchCommand.execute(
      commandEnvelope("cmd-2", null, {
        type: "set_part_value",
        partInstanceId: "part-1",
        value: "10k",
      }, placed.designId),
    );

    expect(staleWrite.ok).toBe(false);
    if (staleWrite.ok) {
      return;
    }
    expect(staleWrite.serverRevision).toBe(1);
  });

  test("wire pin hints must match actual wire endpoints", async () => {
    const foundation = createInMemoryDesignerFoundation();
    const placed = await foundation.dispatchCommand.execute(
      commandEnvelope("cmd-1", null, {
        type: "place_part",
        partInstanceId: "part-1",
        sheetId: ROOT_SHEET_ID,
        xNm: 0,
        yNm: 0,
        rotationDeg: 0,
        mirrored: false,
        originRef: { componentId: "cmp-1", variantId: "var-1" },
        symbolSnapshot: singlePinSnapshot("U"),
      }),
    );
    if (!placed.ok) throw new Error("place failed");

    await expect(
      foundation.dispatchCommand.execute(
        commandEnvelope("cmd-2", placed.nextRevision, {
          type: "create_wire",
          wireId: "wire-1",
          sheetId: ROOT_SHEET_ID,
          pointsNm: [
            { xNm: 1_270_000, yNm: 0 },
            { xNm: 2_540_000, yNm: 0 },
          ],
          startPinRef: { partInstanceId: "part-1", originPinKey: "1" },
        }, placed.designId),
      ),
    ).rejects.toThrow("startPinRef must match first wire point");
  });

  test("undo and redo advance revisions monotonically", async () => {
    const foundation = createInMemoryDesignerFoundation();
    const placed = await foundation.dispatchCommand.execute(
      commandEnvelope("cmd-1", null, {
        type: "place_part",
        partInstanceId: "part-1",
        sheetId: ROOT_SHEET_ID,
        xNm: 0,
        yNm: 0,
        rotationDeg: 0,
        mirrored: false,
        originRef: { componentId: "cmp-1", variantId: "var-1" },
        symbolSnapshot: singlePinSnapshot("U"),
      }),
    );
    if (!placed.ok) throw new Error("place failed");

    const undone = await foundation.undo.execute(placed.designId, SESSION_ID);
    expect(undone?.acceptedRevision).toBe(1);
    expect(undone?.nextRevision).toBe(2);

    const afterUndo = await foundation.getSchematicProjection.execute(placed.designId);
    expect(afterUndo?.parts).toHaveLength(0);

    const redone = await foundation.redo.execute(placed.designId, SESSION_ID);
    expect(redone?.acceptedRevision).toBe(2);
    expect(redone?.nextRevision).toBe(3);

    const afterRedo = await foundation.getSchematicProjection.execute(placed.designId);
    expect(afterRedo?.parts).toHaveLength(1);
  });
});
