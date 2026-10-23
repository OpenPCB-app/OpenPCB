import { describe, expect, test } from "bun:test";
import { getSharedDb } from "../db/sqlite-client";
import { readNetIdentityRetired, writeNetIdentityState } from "../../../modules/designer/backend/net-identity/state-store";
import { designNetSalt, formatDurableNetId } from "../../../modules/designer/backend/net-identity/types";
import { createRoutedIdentityFixture, openPropertyRuntime, physicalVerdict, rawReferenceSignature } from "./helpers/net-identity-property-runtime";
import { identityState, placed, send, setupRuntimeCleanup } from "./helpers/net-identity-runtime";

setupRuntimeCleanup();

describe("T132 native durable reference regression", () => {
  test("schematic edits preserve routed/rule ownership and verdict; PCB moves change routing only, through full history/reopen cycles", async () => {
    const fixture = await createRoutedIdentityFixture(true), { designId, pins, netIds } = fixture;
    let runtime = fixture.runtime;
    const initial = (await runtime.store.getPcbProjection(designId))!, baseline = physicalVerdict(initial), references = rawReferenceSignature(designId);
    expect(initial.ratsnest).toEqual([]); expect(initial.unresolvedFootprints).toEqual([]);
    for (const command of [
      { type: "move_part", partId: pins[0]!.partId, positionNm: { x: -3_000_000, y: -2_000_000 }, confirmMerge: true },
      { type: "rotate_part", partId: pins[0]!.partId, rotationDeg: 90, confirmMerge: true },
      { type: "mirror_part", partId: pins[0]!.partId, mirrored: true, confirmMerge: true },
      { type: "update_part_properties", partId: pins[0]!.partId, reference: "R132" },
    ] as const) {
      await send(runtime, designId, command, "T132");
      const pcb = (await runtime.store.getPcbProjection(designId))!;
      expect(identityState(designId).active.map((record) => record.id).sort()).toEqual([...netIds].sort());
      expect(rawReferenceSignature(designId)).toBe(references); expect(pcb.netIdentity!.orphanedCopperCount).toBe(0);
      expect(physicalVerdict(pcb)).toEqual(baseline);
    }
    const firstPlacement = initial.placements.find((placement) => placement.partId === pins[0]!.partId)!;
    await send(runtime, designId, { type: "pcb_move_placement", placementId: firstPlacement.id, positionMm: { x: -14, y: -8 } }, "T132");
    const moved = (await runtime.store.getPcbProjection(designId))!, movedVerdict = physicalVerdict(moved);
    expect(moved.ratsnest.length).toBeGreaterThan(0); expect(rawReferenceSignature(designId)).toBe(references);
    expect(moved.netIdentity!.orphanedCopperCount).toBe(0);
    const watermark = identityState(designId).nextSeq;
    for (let cycle = 0; cycle < 2; cycle++) {
      for (let step = 0; step < 5; step++) {
        expect((await runtime.store.undo(designId, "T132")).ok).toBe(true);
        expect(rawReferenceSignature(designId)).toBe(references);
      }
      expect(physicalVerdict((await runtime.store.getPcbProjection(designId))!)).toEqual(baseline);
      runtime = await openPropertyRuntime(runtime.file);
      expect((await runtime.store.getHistory(designId, "T132")).redoDepth).toBe(5);
      for (let step = 0; step < 5; step++) expect((await runtime.store.redo(designId, "T132")).ok).toBe(true);
      expect(physicalVerdict((await runtime.store.getPcbProjection(designId))!)).toEqual(movedVerdict);
      expect(identityState(designId).nextSeq).toBeGreaterThanOrEqual(watermark);
      expect(identityState(designId).active.map((record) => record.id).sort()).toEqual([...netIds].sort());
    }
  }, 30_000);

  test("delete only wire then redraw same pins preserves inherited durable ID and raw bindings across reboot/undo/redo", async () => {
    const fixture = await createRoutedIdentityFixture(true), { designId, pins, wires, netIds } = fixture;
    let runtime = fixture.runtime;
    const baseline = physicalVerdict((await runtime.store.getPcbProjection(designId))!), references = rawReferenceSignature(designId);
    const watermark = identityState(designId).nextSeq;
    await send(runtime, designId, { type: "delete_entity", entityKind: "wire", entityId: wires[0]! }, "redraw");
    expect(identityState(designId).active.some((record) => record.id === netIds[0])).toBe(true);
    expect(rawReferenceSignature(designId)).toBe(references);
    expect((await runtime.store.getPcbProjection(designId))!.netIdentity!.orphanedCopperCount).toBe(0);
    runtime = await openPropertyRuntime(runtime.file);
    await send(runtime, designId, { type: "create_wire", sourcePinId: pins[0]!.pinId, targetPinId: pins[1]!.pinId }, "redraw");
    expect(identityState(designId).active.map((record) => record.id).sort()).toEqual([...netIds].sort());
    expect(physicalVerdict((await runtime.store.getPcbProjection(designId))!)).toEqual(baseline);
    for (let step = 0; step < 2; step++) expect((await runtime.store.undo(designId, "redraw")).ok).toBe(true);
    expect(physicalVerdict((await runtime.store.getPcbProjection(designId))!)).toEqual(baseline);
    for (let step = 0; step < 2; step++) expect((await runtime.store.redo(designId, "redraw")).ok).toBe(true);
    expect(rawReferenceSignature(designId)).toBe(references);
    expect(physicalVerdict((await runtime.store.getPcbProjection(designId))!)).toEqual(baseline);
    expect(identityState(designId).nextSeq).toBe(watermark);
  }, 30_000);

  test("equal-pin equally auto-named singleton merge keeps seq10 with copper over older seq9", async () => {
    let runtime = await openPropertyRuntime();
    const design = await runtime.store.createDesign(), first = await placed(runtime, design.id, 0, 0), second = await placed(runtime, design.id, 10_000_000, 0);
    const salt = designNetSalt(design.id), nine = formatDurableNetId(salt, 9), ten = formatDurableNetId(salt, 10);
    writeNetIdentityState(getSharedDb(), { ...identityState(design.id), nextSeq: 11, active: [
      { id: nine, name: "Net_9", nameSource: "auto", members: [{ kind: "pin", id: first.pinId }] },
      { id: ten, name: "Net_10", nameSource: "auto", members: [{ kind: "pin", id: second.pinId }] },
    ] });
    await send(runtime, design.id, { type: "pcb_add_via", netId: ten, netClassId: "default", centerMm: { x: 0, y: 0 }, legality: "off" }, "PCB");
    runtime = await openPropertyRuntime(runtime.file);
    await send(runtime, design.id, { type: "create_wire", sourcePinId: first.pinId, targetPinId: second.pinId }, "merge");
    expect(identityState(design.id).active.map((record) => record.id)).toEqual([ten]);
    expect(readNetIdentityRetired(getSharedDb(), design.id)).toContainEqual(expect.objectContaining({ netId: nine, reason: "merged", successorIds: [ten] }));
    expect((await runtime.store.getPcbProjection(design.id))!.vias[0]!.netId).toBe(ten);
    expect((await runtime.store.undo(design.id, "merge")).ok).toBe(true);
    expect(identityState(design.id).active.map((record) => record.id).sort()).toEqual([nine, ten].sort());
    expect((await runtime.store.redo(design.id, "merge")).ok).toBe(true);
    expect(identityState(design.id).active.map((record) => record.id)).toEqual([ten]);
    expect(identityState(design.id).nextSeq).toBe(11);
  });
});
