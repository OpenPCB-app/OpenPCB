import { describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import type { DesignerCommand, DesignerPcbAddTraceCommand, PcbBoardSettings, PcbZone } from "../../../sdks/designer";
import { designNetSalt, formatDurableNetId } from "../../../modules/designer/backend/net-identity/types";
import { computeBoardContentDigest } from "../../../modules/designer/backend/pcb/board-content-digest";
import { loadPcbZones } from "../../../modules/designer/backend/pcb/pcb-store";
import { commandLog, netIdentityState, pcbEntities } from "../../../modules/designer/backend/schema";
import { getSharedDb } from "../db/sqlite-client";
import { body, connected, identityState, openIdentityRuntime, placed, rawRuntimeState, send, setupRuntimeCleanup } from "./helpers/net-identity-runtime";

setupRuntimeCleanup();

function unknownId(designId: string): string {
  return formatDurableNetId(designNetSalt(designId), 999);
}
function trace(netId: string | null): DesignerPcbAddTraceCommand {
  return { type: "pcb_add_trace", netId, netClassId: "default", layer: "F.Cu", widthMm: 0.25,
    pointsNm: [{ x: 20_000_000, y: 20_000_000 }, { x: 25_000_000, y: 20_000_000 }], segmentMode: "manhattan-90", legality: "off" };
}
function polygonZone(netId: string | null, netName: string | null, enabled = true): Extract<DesignerCommand, { type: "pcb_add_zone" }> {
  return { type: "pcb_add_zone", layer: "F.Cu", enabled, net: { netId, netName }, name: "Stored zone",
    region: { kind: "polygon", pointsMm: [{ x: 20, y: 20 }, { x: 25, y: 20 }, { x: 25, y: 25 }, { x: 20, y: 25 }] } };
}
function storedZone(designId: string, zoneId: string): PcbZone {
  return loadPcbZones(getSharedDb(), designId).zones.find((zone) => zone.id === zoneId)!;
}
function rawZone(designId: string, zoneId: string) {
  const row = getSharedDb().select().from(pcbEntities).where(and(
    eq(pcbEntities.designId, designId), eq(pcbEntities.kind, "zone"),
  )).all().find((row) => (JSON.parse(row.payloadJson) as PcbZone).id === zoneId);
  if (!row) throw new Error("missing zone fixture");
  return row;
}
function ruleCommand(board: PcbBoardSettings, netId: string, otherId: string): Extract<DesignerCommand, { type: "pcb_set_design_rules" }> {
  return { type: "pcb_set_design_rules", perNetClassAssignments: { [netId]: board.netClasses[0]!.id },
    lengthMatchGroups: [{ id: "length", name: "Length", netIds: [netId], target: { kind: "absolute", mm: 10 }, toleranceMm: 0 }],
    diffPairs: [{ id: "pair", name: "Pair", pNetId: netId, nNetId: otherId }],
    drcRules: [{ id: "rule", name: "Rule", enabled: true, priority: 1,
      scopes: [{ kind: "net", netIds: [netId] }, { kind: "net", netIds: [otherId] }], constraint: { kind: "clearance", mm: 0.5 } }] };
}

describe("durable command boundary through the store", () => {
  test("zone hint persists one bound ID and original envelope; later rename never rebinds", async () => {
    const runtime = await openIdentityRuntime(), design = await runtime.store.createDesign();
    const chain = await connected(runtime, design.id);
    const label = await send(runtime, design.id, { type: "upsert_label", text: "SIGNAL", positionNm: { x: chain.first.x, y: 0 } });
    const command = polygonZone(null, " signal "), envelope = body(design.id, command), original = JSON.stringify(envelope);
    const result = await runtime.store.dispatchCommand(design.id, envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(storedZone(design.id, result.createdEntityId!)).toMatchObject({ netId: chain.netId, netName: null });
    expect(JSON.stringify(envelope)).toBe(original);
    const logged = getSharedDb().select().from(commandLog).where(eq(commandLog.commandId, envelope.commandId)).get()!;
    expect(logged.commandJson).toBe(JSON.stringify(command));
    const beforeRename = rawZone(design.id, result.createdEntityId!);
    await send(runtime, design.id, { type: "upsert_label", labelId: label.createdEntityId!, text: "RENAMED", positionNm: { x: chain.first.x, y: 0 } });
    const projection = (await runtime.store.getPcbProjection(design.id))!;
    expect((await runtime.store.getSchematicProjection(design.id))!.nets.find((net) => net.id === chain.netId)!.name).toBe("RENAMED");
    expect(projection.zones!.find((zone) => zone.id === result.createdEntityId)).toMatchObject({ netId: chain.netId, netName: null });
    expect(rawZone(design.id, result.createdEntityId!)).toEqual(beforeRename);
    expect(await runtime.store.dispatchCommand(design.id, envelope)).toEqual({ ...result, idempotent: true });
    expect(JSON.stringify(envelope)).toBe(original);
  });

  test("unknown, foreign-design, retired nc and pending references refuse before handler writes", async () => {
    const runtime = await openIdentityRuntime(), design = await runtime.store.createDesign();
    const chain = await connected(runtime, design.id);
    const cases = [
      { netId: unknownId(design.id), reason: "unknown", successorIds: [] },
      { netId: formatDurableNetId(designNetSalt("foreign-design"), 1), reason: "foreign-design", successorIds: [] },
      { netId: `nc:${chain.first.pinId}`, reason: "retired", successorIds: [chain.netId] },
      { netId: "pending:0", reason: "pending", successorIds: [] },
      { netId: "pt:0:0", reason: "foreign", successorIds: [] },
    ];
    for (const expected of cases) {
      const command = { ...trace(expected.netId), netClassId: "missing-class" }, envelope = body(design.id, command);
      const before = rawRuntimeState(design.id), authored = JSON.stringify(envelope);
      expect(await runtime.store.dispatchCommand(design.id, envelope)).toMatchObject({ ok: false, code: "NET_REFERENCE_DANGLING", field: "netId", ...expected });
      expect(rawRuntimeState(design.id)).toEqual(before); expect(JSON.stringify(envelope)).toBe(authored);
    }
  });

  test("same failed original envelope replays exact refusal after state deletion without ensure", async () => {
    const runtime = await openIdentityRuntime(), design = await runtime.store.createDesign();
    await connected(runtime, design.id);
    const envelope = body(design.id, polygonZone(null, "Unknown name"));
    const first = await runtime.store.dispatchCommand(design.id, envelope);
    expect(first).toMatchObject({ ok: false, code: "NET_REFERENCE_DANGLING", reason: "unknown-name", netName: "Unknown name" });
    getSharedDb().delete(netIdentityState).where(eq(netIdentityState.designId, design.id)).run();
    const before = rawRuntimeState(design.id);
    expect(await runtime.store.dispatchCommand(design.id, envelope)).toEqual(first);
    expect(rawRuntimeState(design.id)).toEqual(before); expect(identityState(design.id)).toBeNull();
    expect(getSharedDb().select().from(commandLog).where(eq(commandLog.commandId, envelope.commandId)).get()!.commandJson).toBe(JSON.stringify(envelope.command));
  });

  test("late bad reference rolls back earlier valid batch edit and its history", async () => {
    const runtime = await openIdentityRuntime(), design = await runtime.store.createDesign();
    const chain = await connected(runtime, design.id), before = rawRuntimeState(design.id);
    const command: DesignerCommand = { type: "batch_commands", commands: [
      { type: "update_part_properties", partId: chain.first.partId, value: "must roll back" }, trace(unknownId(design.id)),
    ] };
    expect(await runtime.store.dispatchCommand(design.id, body(design.id, command))).toMatchObject({ ok: false, code: "NET_REFERENCE_DANGLING", reason: "unknown" });
    expect(rawRuntimeState(design.id)).toEqual(before);
  });

  test("batch net creation sees fresh pending projection and refuses provisional reference atomically", async () => {
    const runtime = await openIdentityRuntime(), design = await runtime.store.createDesign();
    const first = await placed(runtime, design.id, 0, 0), second = await placed(runtime, design.id, 10_000_000, 0);
    const before = rawRuntimeState(design.id);
    for (const reference of [trace("pending:0"), polygonZone(null, " Net_pending_0 ")]) {
      const command: DesignerCommand = { type: "batch_commands", commands: [
        { type: "create_wire", sourcePinId: first.pinId, targetPinId: second.pinId }, reference,
      ] };
      expect(await runtime.store.dispatchCommand(design.id, body(design.id, command))).toMatchObject({ ok: false, code: "NET_REFERENCE_DANGLING", netId: "pending:0", reason: "pending" });
      expect(rawRuntimeState(design.id)).toEqual(before); expect(identityState(design.id).active).toEqual([]);
    }
  });

  test("late autolayout reference refuses before valid placement and early route writes", async () => {
    const runtime = await openIdentityRuntime(), design = await runtime.store.createDesign();
    const chain = await connected(runtime, design.id), projection = (await runtime.store.getPcbProjection(design.id))!;
    const placement = projection.placements.find((placement) => placement.partId === chain.first.partId)!;
    const before = rawRuntimeState(design.id), command: DesignerCommand = {
      type: "pcb_apply_autolayout_candidate", jobId: "job", candidateId: "candidate", snapshotDigest: computeBoardContentDigest(projection),
      placementOperations: [{ type: "pcb_move_placement", placementId: placement.id, positionMm: { x: 12, y: 12 } }],
      routeOperations: [trace(chain.netId), trace(unknownId(design.id))], provenance: {},
    };
    expect(await runtime.store.dispatchCommand(design.id, body(design.id, command))).toMatchObject({ ok: false, code: "NET_REFERENCE_DANGLING", field: "routeOperations[1].netId", reason: "unknown" });
    expect(rawRuntimeState(design.id)).toEqual(before);
  });

  test("enabling disabled stored zone validates omitted reference and normalizes legacy hint", async () => {
    const runtime = await openIdentityRuntime(), design = await runtime.store.createDesign();
    const chain = await connected(runtime, design.id), name = identityState(design.id).active[0]!.name;
    const zone = await send(runtime, design.id, polygonZone(chain.netId, null, false));
    const row = rawZone(design.id, zone.createdEntityId!), saved = storedZone(design.id, zone.createdEntityId!);
    getSharedDb().update(pcbEntities).set({ payloadJson: JSON.stringify({ ...saved, netId: unknownId(design.id), netName: name }) }).where(eq(pcbEntities.id, row.id)).run();
    const command: DesignerCommand = { type: "pcb_update_zone", zoneId: zone.createdEntityId!, enabled: true, priority: 7 }, before = rawRuntimeState(design.id);
    expect(await runtime.store.dispatchCommand(design.id, body(design.id, command))).toMatchObject({ ok: false, code: "NET_REFERENCE_DANGLING", reason: "unknown", field: "net.netId" });
    expect(rawRuntimeState(design.id)).toEqual(before); expect(command).not.toHaveProperty("net");
    getSharedDb().update(pcbEntities).set({ payloadJson: JSON.stringify({ ...saved, netId: null, netName: ` ${name.toLowerCase()} ` }) }).where(eq(pcbEntities.id, row.id)).run();
    await send(runtime, design.id, command);
    expect(storedZone(design.id, zone.createdEntityId!)).toMatchObject({ enabled: true, priority: 7, name: "Stored zone", netId: chain.netId, netName: null });
    expect(command).not.toHaveProperty("net");
  });

  test("same-owner stale rules resave and remove; copied owners refuse before changes", async () => {
    const runtime = await openIdentityRuntime(), design = await runtime.store.createDesign();
    const chain = await connected(runtime, design.id), board = (await runtime.store.getPcbProjection(design.id))!.board;
    const command = ruleCommand(board, chain.netId, `nc:${chain.third.pinId}`);
    await send(runtime, design.id, command);
    await send(runtime, design.id, { type: "batch_commands", commands: [
      { type: "delete_entity", entityKind: "part", entityId: chain.first.partId },
      { type: "delete_entity", entityKind: "part", entityId: chain.second.partId },
    ] });
    expect(identityState(design.id).active.map((net) => net.id)).not.toContain(chain.netId);
    await send(runtime, design.id, { ...command, drcRules: [{ ...command.drcRules![0]!, scopes: [...command.drcRules![0]!.scopes].reverse() }] });
    for (const copied of [
      { type: "pcb_set_design_rules", lengthMatchGroups: [{ ...command.lengthMatchGroups![0]!, id: "copy" }] },
      { type: "pcb_set_design_rules", diffPairs: [{ ...command.diffPairs![0]!, id: "copy" }] },
      { type: "pcb_set_design_rules", drcRules: [{ ...command.drcRules![0]!, id: "copy" }] },
    ] satisfies DesignerCommand[]) {
      const before = rawRuntimeState(design.id);
      expect(await runtime.store.dispatchCommand(design.id, body(design.id, copied))).toMatchObject({ ok: false, code: "NET_REFERENCE_DANGLING", netId: chain.netId, reason: "retired" });
      expect(rawRuntimeState(design.id)).toEqual(before);
    }
    await send(runtime, design.id, { type: "pcb_set_design_rules", perNetClassAssignments: {}, lengthMatchGroups: [], diffPairs: [], drcRules: [] });
    const cleared = (await runtime.store.getPcbProjection(design.id))!.board;
    expect(cleared.perNetClassAssignments ?? {}).toEqual({});
    expect(cleared.lengthMatchGroups ?? []).toEqual([]);
    expect(cleared.diffPairs ?? []).toEqual([]); expect(cleared.drcRules ?? []).toEqual([]);
  });
});
