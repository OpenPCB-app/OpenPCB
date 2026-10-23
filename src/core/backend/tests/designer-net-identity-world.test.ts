import { describe, expect, test } from "bun:test";
import { applyPatches } from "../../../shared/domain/commands";
import { asEntityId, type EcsWorld } from "../../../shared/domain/ecs";
import { enumerateNetReferences, type NetReferenceSource } from "../../../shared/electrical-identity/references";
import {
  buildCombinedHistoryPatchSet, buildHistoryPatchSet, combinedStateFromWorld, combinedStateToWorld,
  deriveNetsAndJunctions, projectionFromWorld, projectionFromWorldWithIdentity, projectionToWorld,
  schematicSourceFromWorld, type DesignerCombinedState, type DesignerWorldComponent, type WorldIdentityBinder,
} from "../../../modules/designer/backend/projection-world";
import type { SchematicSource } from "../../../modules/designer/backend/projection-read";
import type { BindResult } from "../../../modules/designer/backend/net-identity/bind";
import { formatDurableNetId, NetIdentityStateInvalidError, type ActiveNetRecord } from "../../../modules/designer/backend/net-identity/types";
import { createDefaultPcbBoardSettings } from "../../../modules/designer/backend/pcb/pcb-defaults";
import { ercPart, ercPin, ercProjection } from "./helpers/erc-fixtures";

const id = (seq: number) => formatDurableNetId("aaaaaaaaaa", seq);

function active(seq = 1, overrides: Partial<ActiveNetRecord> = {}): ActiveNetRecord {
  return { id: id(seq), name: "ALIAS", nameSource: "override", displayOverride: "ALIAS",
    members: [{ kind: "pin", id: "part:1" }, { kind: "pin", id: "part:2" }, { kind: "wire", id: "wire" }], ...overrides };
}

function schematic() {
  return ercProjection({ designId: "world-design", revision: 5,
    parts: [ercPart([ercPin("part:2", "passive", 10_000_000), ercPin("part:1", "passive")])],
    wires: [{ id: "wire", sourcePinId: "part:1", targetPinId: "part:2",
      pointsNm: [{ x: 0, y: 0 }, { x: 10_000_000, y: 0 }] }],
    labels: [{ id: "label", text: "SIG", positionNm: { x: 0, y: 0 } }],
    primitives: [{ id: "junction", kind: "junction", positionNm: { x: 5_000_000, y: 0 }, rotationDeg: 0 }],
    nets: [{ id: id(99), name: "Public names must not supply metadata", pinIds: [], wireIds: [], labelIds: [], primitiveIds: [] }],
  });
}

function legacy(source: SchematicSource) {
  const { designId, revision, parts, wires, labels, primitives } = source;
  const derived = deriveNetsAndJunctions(parts, wires, labels, primitives);
  return { designId, revision, parts, wires,
    labels: labels.map((label) => ({ ...label, attached: derived.attachedLabelIds.has(label.id) })),
    primitives: primitives.map((primitive) => ({ ...primitive, attached: derived.attachedPrimitiveIds.has(primitive.id) })),
    nets: derived.nets, junctions: derived.junctions, netDiagnostics: derived.warnings };
}

function binding(records: readonly ActiveNetRecord[]): BindResult {
  return { nets: [], nextActive: structuredClone([...records]), nextSeq: 10, inSync: true,
    createdIds: [], preservedIds: records.map((record) => record.id), retirements: [], transitions: [], sanitized: [] };
}

const echoBinder: WorldIdentityBinder = (source, records) => ({ projection: legacy(source), bind: binding(records) });

function worldView(world: EcsWorld<DesignerWorldComponent>) {
  return world.snapshots().map((snapshot) => ({ id: snapshot.id, components: [...snapshot.components] }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function state(netId = id(1)): DesignerCombinedState {
  return { schematic: schematic(), pcb: { ...createDefaultPcbBoardSettings("2026-10-22T00:00:00.000Z"),
    perNetClassAssignments: { [netId]: "default" } },
    placements: [], traces: [{ id: "trace", netId, netClassId: "default", layer: "F.Cu", widthMm: 0.25,
      pointsNm: [{ x: 0, y: 0 }, { x: 1_000_000, y: 0 }], segmentMode: "manhattan-90" }],
    vias: [{ id: "via", netId, netClassId: "default", centerMm: { x: 1, y: 0 }, diameterMm: 0.6,
      drillMm: 0.3, fromLayer: "F.Cu", toLayer: "B.Cu", viaType: "through", protection: "tented", provenance: "manual" }],
    freePads: [{ id: "free-pad", netId, centerMm: { x: 2, y: 0 }, rotationDeg: 0, padType: "smd",
      shape: "rect", widthMm: 1, heightMm: 1, drillMm: null, layer: "F.Cu", solderMaskExpansionMm: null,
      solderPasteExpansionMm: null, lockedAt: null }],
    zones: [{ id: "board:F.Cu", netId, netName: null, enabled: true, name: null, lockedAt: null,
      layer: "F.Cu", region: { kind: "board" }, priority: 0 }],
    freeHoles: [], overlayTexts: [], overlayShapes: [], keepouts: [], activeNetIdentities: [active()],
  };
}

describe("history world explicit durable identities", () => {
  test("only explicit durable records emit, with full cloned metadata", () => {
    const projection = schematic();
    const records = [active(), active(2, { id: "nc:part:2" }), active(3, { id: "pending:0" })];
    const world = projectionToWorld(projection, records);
    const identities = world.snapshots().filter((snapshot) => snapshot.components.has("designer.net_identity"));
    expect(identities.map((snapshot) => snapshot.id)).toEqual([asEntityId(`net_identity:${id(1)}`)]);
    expect(identities[0]!.components.get("designer.net_identity")!.payload).toEqual(active());
    records[0]!.members[0] = { kind: "pin", id: "mutated" };
    records[0]!.displayOverride = "mutated";
    projection.parts[0]!.pins[0]!.name = "mutated";
    expect(projectionFromWorldWithIdentity("world-design", 5, world, echoBinder).previousActive).toEqual([active()]);
    expect(schematicSourceFromWorld("world-design", 5, world).parts[0]!.pins[0]!.name).not.toBe("mutated");
    expect(projectionToWorld(schematic()).snapshots().some((snapshot) => snapshot.components.has("designer.net_identity"))).toBe(false);
  });

  test("schematic patches and inverse preserve full names, sources, members and overrides", () => {
    const before = [active(), active(3, { name: "OLD", nameSource: "label", displayOverride: undefined })];
    const after = [active(1, { name: "RENAMED", nameSource: "label", displayOverride: "STORED OVERRIDE" }), active(2)];
    const projection = schematic();
    const patches = buildHistoryPatchSet(projection, projection, { before, after });
    expect(patches.forwardPatches).toHaveLength(3);
    const world = projectionToWorld(projection, before);
    const original = worldView(world);
    applyPatches(world, patches.forwardPatches);
    expect(projectionFromWorldWithIdentity("world-design", 6, world, echoBinder).previousActive).toEqual(after);
    applyPatches(world, patches.inversePatches);
    expect(worldView(world)).toEqual(original);
    expect(projectionFromWorldWithIdentity("world-design", 7, world, echoBinder).previousActive).toEqual(before);
    expect(buildHistoryPatchSet(projection, projection).forwardPatches).toEqual([]);
  });

  test("combined patches supply post-patch PCB census before binding and reverse it on undo", () => {
    const before = state();
    const after = state(id(2));
    after.activeNetIdentities = [active(2)];
    const patches = buildCombinedHistoryPatchSet(before, after);
    const world = combinedStateToWorld(before);
    const captured: NetReferenceSource[] = [];
    const binder: WorldIdentityBinder = (source, records, references) => {
      expect(references).toBeDefined();
      captured.push(structuredClone(references!));
      return { projection: legacy(source), bind: binding(records) };
    };
    applyPatches(world, patches.forwardPatches);
    const next = combinedStateFromWorld("world-design", 6, world, binder);
    expect(enumerateNetReferences(captured[0]!).map((reference) => reference.netId)).toEqual(Array(5).fill(id(2)));
    expect(next.activeNetIdentities).toEqual(after.activeNetIdentities);
    expect(next.identityBinding!.previousActive).toEqual(after.activeNetIdentities);
    expect(next.identityBinding!.bind.nextActive).toEqual(after.activeNetIdentities);
    applyPatches(world, patches.inversePatches);
    const undone = combinedStateFromWorld("world-design", 7, world, binder);
    expect(enumerateNetReferences(captured[1]!).map((reference) => reference.netId)).toEqual(Array(5).fill(id(1)));
    expect(undone.activeNetIdentities).toEqual(before.activeNetIdentities);
  });

  test("legacy source, projection and combined state retain byte parity and ignore identity components", () => {
    const input = state();
    const world = combinedStateToWorld(input);
    const source = schematicSourceFromWorld("world-design", 5, world);
    const expected = legacy(source);
    expect(JSON.stringify(projectionFromWorld("world-design", 5, world))).toBe(JSON.stringify(expected));
    const { viewState: _view, activeLayer: _active, visibleLayers: _visible, ...pcb } = input.pcb;
    const originalOrder = { schematic: expected, pcb, placements: input.placements, traces: input.traces,
      vias: input.vias, freeHoles: input.freeHoles, freePads: input.freePads, overlayTexts: input.overlayTexts,
      overlayShapes: input.overlayShapes, zones: input.zones, keepouts: input.keepouts };
    expect(JSON.stringify(combinedStateFromWorld("world-design", 5, world))).toBe(JSON.stringify(originalOrder));
    const legacyWorld = combinedStateToWorld({ ...input, activeNetIdentities: undefined });
    expect(JSON.stringify(combinedStateFromWorld("world-design", 5, legacyWorld))).toBe(JSON.stringify(originalOrder));
    expect(combinedStateFromWorld("world-design", 5, world).activeNetIdentities).toBeUndefined();
    expect(combinedStateFromWorld("world-design", 5, world).identityBinding).toBeUndefined();
  });

  test("source decoding keeps legacy sort order and primitive parsing", () => {
    const projection = schematic();
    projection.parts.push({ ...ercPart([]), id: "aaa" });
    projection.labels.push({ id: "aaa", text: "UNATTACHED", positionNm: { x: 9_000_000, y: 8_000_000 } });
    const world = projectionToWorld(projection);
    world.setComponent(asEntityId("primitive:invalid"), {
      type: "designer.entity", kind: "primitive", payload: { id: "invalid", kind: "unknown" },
    });
    const source = schematicSourceFromWorld("world-design", 12, world);
    expect(source.parts.map((part) => part.id)).toEqual(["aaa", "part"]);
    expect(source.labels.map((label) => label.id)).toEqual(["aaa", "label"]);
    expect(source.primitives.map((primitive) => primitive.id)).toEqual(["junction"]);
    expect(source.revision).toBe(12);
    expect(projectionFromWorld("world-design", 12, world).labels[0]!.attached).toBe(false);
  });

  test("contested members survive across records for the binder sanitizer", () => {
    const records = [active(), active(2)];
    const world = projectionToWorld(schematic(), records);
    let observed: readonly ActiveNetRecord[] = [];
    const result = projectionFromWorldWithIdentity("world-design", 5, world, (source, previous, references) => {
      observed = structuredClone(previous);
      expect(references).toBeUndefined();
      return { projection: legacy(source), bind: binding(previous) };
    });
    expect(observed).toEqual(records);
    expect(result.previousActive).toEqual(records);
  });

  test("explicit binder receives an empty active state without inferring public net metadata", () => {
    const world = projectionToWorld(schematic());
    let calls = 0;
    const decoded = projectionFromWorldWithIdentity("world-design", 5, world, (source, previous) => {
      calls += 1;
      expect(previous).toEqual([]);
      expect(source).not.toHaveProperty("nets");
      return { projection: legacy(source), bind: binding(previous) };
    });
    expect(calls).toBe(1);
    expect(decoded.previousActive).toEqual([]);
    expect(decoded.bind.nextActive).toEqual([]);
  });

  test("duplicate IDs and component entity/payload mismatches refuse before binder invocation", () => {
    expect(() => projectionToWorld(schematic(), [active(), active()])).toThrow(NetIdentityStateInvalidError);
    let calls = 0;
    const binder: WorldIdentityBinder = (source, records) => {
      calls += 1;
      return { projection: legacy(source), bind: binding(records) };
    };
    for (const entityId of [`net_identity:${id(2)}`, `other:${id(1)}`]) {
      const world = projectionToWorld(schematic(), [active()]);
      world.setComponent(asEntityId(entityId), { type: "designer.net_identity", payload: active() });
      expect(() => projectionFromWorldWithIdentity("world-design", 5, world, binder)).toThrow(NetIdentityStateInvalidError);
      expect(projectionFromWorld("world-design", 5, world).nets).toHaveLength(1);
    }
    const world = projectionToWorld(schematic());
    world.setComponent(asEntityId("net_identity:nc:part:1"), {
      type: "designer.net_identity", payload: active(1, { id: "nc:part:1" }),
    });
    expect(() => projectionFromWorldWithIdentity("world-design", 5, world, binder)).toThrow(NetIdentityStateInvalidError);
    expect(calls).toBe(0);
  });

  test("callback and returned state mutations cannot alter input world or saved predecessor records", () => {
    const input = state();
    const world = combinedStateToWorld(input);
    const snapshot = worldView(world);
    const decoded = combinedStateFromWorld("world-design", 6, world, (source, previous, references) => {
      (previous as ActiveNetRecord[])[0]!.members[0] = { kind: "pin", id: "callback mutation" };
      references!.board.perNetClassAssignments![id(1)] = "callback mutation";
      source.parts[0]!.pins[0]!.name = "callback mutation";
      return { projection: legacy(source), bind: binding([active(2)]) };
    });
    expect(decoded.identityBinding!.previousActive).toEqual([active()]);
    expect(decoded.pcb.perNetClassAssignments).toEqual(input.pcb.perNetClassAssignments);
    decoded.activeNetIdentities![0]!.name = "output mutation";
    expect(decoded.identityBinding!.bind.nextActive[0]!.name).toBe("ALIAS");
    expect(worldView(world)).toEqual(snapshot);
    expect(input.activeNetIdentities).toEqual([active()]);
  });
});
