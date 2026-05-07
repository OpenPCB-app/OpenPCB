import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import {
  applyPatches,
  invertPatchBatch,
  type EcsPatch,
} from "../../../shared/domain/commands";
import {
  asEntityId,
  EcsWorld,
  type EntityId,
} from "../../../shared/domain/ecs";
import type {
  DesignerDerivedNet,
  DesignerEntityKind,
  DesignerJunction,
  DesignerLabel,
  DesignerPlacedPart,
  DesignerSchematicProjection,
  DesignerWire,
  PcbBoardSettings,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
} from "../../../sdks";
import { normalizeRotationDeg } from "./commands/place-part";
import {
  designHeads,
  schematicLabels,
  schematicParts,
  schematicPins,
  schematicWires,
} from "./schema";

type DbClient = BunSQLiteDatabase<Record<string, unknown>>;

export type DesignerWorldComponent =
  | {
      type: "designer.entity";
      kind: DesignerEntityKind;
      payload: Record<string, unknown>;
    }
  | {
      type: "designer.pcb_settings";
      payload: Record<string, unknown>;
    }
  | {
      type: "designer.pcb_placement";
      payload: Record<string, unknown>;
    }
  | {
      type: "designer.pcb_trace";
      payload: Record<string, unknown>;
    }
  | {
      type: "designer.pcb_via";
      payload: Record<string, unknown>;
    };

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(key: string): void {
    if (!this.parent.has(key)) {
      this.parent.set(key, key);
    }
  }

  find(key: string): string {
    const existing = this.parent.get(key);
    if (!existing) {
      this.parent.set(key, key);
      return key;
    }
    if (existing === key) {
      return key;
    }
    const root = this.find(existing);
    this.parent.set(key, root);
    return root;
  }

  union(a: string, b: string): void {
    this.add(a);
    this.add(b);
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent.set(rootB, rootA);
    }
  }
}

function pointKey(point: { x: number; y: number }): string {
  return `${point.x}:${point.y}`;
}

function parsePointKey(key: string): { x: number; y: number } {
  const split = key.split(":", 2);
  return { x: Number(split[0] ?? "0"), y: Number(split[1] ?? "0") };
}

function toWorldEntityId(kind: DesignerEntityKind, entityId: string): EntityId {
  return asEntityId(`${kind}:${entityId}`);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function toPayloadRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return cloneRecord(value as Record<string, unknown>);
  }
  return {};
}

function projectionEntityComponents(
  projection: DesignerSchematicProjection,
): Array<{ entityId: EntityId; component: DesignerWorldComponent }> {
  return [
    ...projection.parts.map((part) => ({
      entityId: toWorldEntityId("part", part.id),
      component: {
        type: "designer.entity" as const,
        kind: "part" as const,
        payload: toPayloadRecord(part as unknown as Record<string, unknown>),
      },
    })),
    ...projection.wires.map((wire) => ({
      entityId: toWorldEntityId("wire", wire.id),
      component: {
        type: "designer.entity" as const,
        kind: "wire" as const,
        payload: toPayloadRecord(wire as unknown as Record<string, unknown>),
      },
    })),
    ...projection.labels.map((label) => ({
      entityId: toWorldEntityId("label", label.id),
      component: {
        type: "designer.entity" as const,
        kind: "label" as const,
        payload: toPayloadRecord(label as unknown as Record<string, unknown>),
      },
    })),
  ];
}

export function projectionToWorld(
  projection: DesignerSchematicProjection,
): EcsWorld<DesignerWorldComponent> {
  const world = new EcsWorld<DesignerWorldComponent>();
  for (const entry of projectionEntityComponents(projection)) {
    world.setComponent(entry.entityId, entry.component);
  }
  return world;
}

function componentEquals(
  left: DesignerWorldComponent,
  right: DesignerWorldComponent,
): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "designer.entity" && right.type === "designer.entity") {
    return (
      left.kind === right.kind &&
      JSON.stringify(left.payload) === JSON.stringify(right.payload)
    );
  }
  return JSON.stringify(left.payload) === JSON.stringify(right.payload);
}

function worldEntityComponents(
  world: EcsWorld<DesignerWorldComponent>,
): Array<{ entityId: EntityId; component: DesignerWorldComponent }> {
  return world
    .snapshots()
    .map((snapshot) => {
      const component =
        snapshot.components.get("designer.entity") ??
        snapshot.components.get("designer.pcb_settings") ??
        snapshot.components.get("designer.pcb_placement") ??
        snapshot.components.get("designer.pcb_trace") ??
        snapshot.components.get("designer.pcb_via");
      return component ? { entityId: snapshot.id, component } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

function buildWorldDiffPatches(
  beforeWorld: EcsWorld<DesignerWorldComponent>,
  afterWorld: EcsWorld<DesignerWorldComponent>,
): EcsPatch<DesignerWorldComponent>[] {
  const beforeMap = new Map<string, DesignerWorldComponent>();
  const afterMap = new Map<string, DesignerWorldComponent>();
  for (const entry of worldEntityComponents(beforeWorld))
    beforeMap.set(entry.entityId, entry.component);
  for (const entry of worldEntityComponents(afterWorld))
    afterMap.set(entry.entityId, entry.component);

  const patches: EcsPatch<DesignerWorldComponent>[] = [];
  for (const entityKey of [...afterMap.keys()].sort((a, b) =>
    a.localeCompare(b),
  )) {
    const nextComponent = afterMap.get(entityKey);
    const previousComponent = beforeMap.get(entityKey);
    if (
      nextComponent &&
      (!previousComponent || !componentEquals(previousComponent, nextComponent))
    ) {
      patches.push({
        kind: "component.set",
        entityId: asEntityId(entityKey),
        component: nextComponent,
      });
    }
  }
  for (const entityKey of [...beforeMap.keys()].sort((a, b) =>
    a.localeCompare(b),
  )) {
    if (!afterMap.has(entityKey)) {
      patches.push({ kind: "entity.delete", entityId: asEntityId(entityKey) });
    }
  }
  return patches;
}

export function buildHistoryPatchSet(
  before: DesignerSchematicProjection,
  after: DesignerSchematicProjection,
): {
  forwardPatches: EcsPatch<DesignerWorldComponent>[];
  inversePatches: EcsPatch<DesignerWorldComponent>[];
} {
  const beforeWorld = projectionToWorld(before);
  const afterWorld = projectionToWorld(after);
  const forwardPatches = buildWorldDiffPatches(beforeWorld, afterWorld);
  const applied = applyPatches(beforeWorld, forwardPatches);
  return { forwardPatches, inversePatches: invertPatchBatch(applied) };
}

const PCB_SETTINGS_ENTITY_ID = asEntityId("pcb:board_settings");
const PCB_PLACEMENT_PREFIX = "pcb:placement:";
const PCB_TRACE_PREFIX = "pcb:trace:";
const PCB_VIA_PREFIX = "pcb:via:";

export interface DesignerCombinedState {
  schematic: DesignerSchematicProjection;
  pcb: PcbBoardSettings;
  placements: PcbPlacedPart[];
  traces: PcbTrace[];
  vias: PcbVia[];
}

export function combinedStateToWorld(
  state: DesignerCombinedState,
): EcsWorld<DesignerWorldComponent> {
  const world = projectionToWorld(state.schematic);
  world.ensureEntity(PCB_SETTINGS_ENTITY_ID);
  world.setComponent(PCB_SETTINGS_ENTITY_ID, {
    type: "designer.pcb_settings",
    payload: toPayloadRecord(state.pcb),
  });
  for (const placement of state.placements) {
    const entityId = asEntityId(`${PCB_PLACEMENT_PREFIX}${placement.id}`);
    world.ensureEntity(entityId);
    world.setComponent(entityId, {
      type: "designer.pcb_placement",
      payload: toPayloadRecord(placement),
    });
  }
  for (const trace of state.traces) {
    const entityId = asEntityId(`${PCB_TRACE_PREFIX}${trace.id}`);
    world.ensureEntity(entityId);
    world.setComponent(entityId, {
      type: "designer.pcb_trace",
      payload: toPayloadRecord(trace),
    });
  }
  for (const via of state.vias) {
    const entityId = asEntityId(`${PCB_VIA_PREFIX}${via.id}`);
    world.ensureEntity(entityId);
    world.setComponent(entityId, {
      type: "designer.pcb_via",
      payload: toPayloadRecord(via),
    });
  }
  return world;
}

export function combinedStateFromWorld(
  designId: string,
  revision: number,
  world: EcsWorld<DesignerWorldComponent>,
): DesignerCombinedState {
  const schematic = projectionFromWorld(designId, revision, world);
  const pcbSnapshot = world.snapshotEntity(PCB_SETTINGS_ENTITY_ID);
  const pcbComponent = pcbSnapshot?.components.get("designer.pcb_settings");
  const pcb = (pcbComponent?.payload ?? {}) as unknown as PcbBoardSettings;

  const placements: PcbPlacedPart[] = [];
  const traces: PcbTrace[] = [];
  const vias: PcbVia[] = [];
  for (const snapshot of world.snapshots()) {
    const placementComp = snapshot.components.get("designer.pcb_placement");
    if (placementComp && placementComp.type === "designer.pcb_placement") {
      placements.push(placementComp.payload as unknown as PcbPlacedPart);
      continue;
    }
    const traceComp = snapshot.components.get("designer.pcb_trace");
    if (traceComp && traceComp.type === "designer.pcb_trace") {
      traces.push(traceComp.payload as unknown as PcbTrace);
      continue;
    }
    const viaComp = snapshot.components.get("designer.pcb_via");
    if (viaComp && viaComp.type === "designer.pcb_via") {
      vias.push(viaComp.payload as unknown as PcbVia);
    }
  }
  placements.sort((a, b) => a.id.localeCompare(b.id));
  traces.sort((a, b) => a.id.localeCompare(b.id));
  vias.sort((a, b) => a.id.localeCompare(b.id));
  return { schematic, pcb, placements, traces, vias };
}

export function buildCombinedHistoryPatchSet(
  before: DesignerCombinedState,
  after: DesignerCombinedState,
): {
  forwardPatches: EcsPatch<DesignerWorldComponent>[];
  inversePatches: EcsPatch<DesignerWorldComponent>[];
} {
  const beforeWorld = combinedStateToWorld(before);
  const afterWorld = combinedStateToWorld(after);
  const forwardPatches = buildWorldDiffPatches(beforeWorld, afterWorld);
  const applied = applyPatches(beforeWorld, forwardPatches);
  return { forwardPatches, inversePatches: invertPatchBatch(applied) };
}

export function deriveNetsAndJunctions(
  parts: DesignerPlacedPart[],
  wires: DesignerWire[],
  labels: DesignerLabel[],
): { nets: DesignerDerivedNet[]; junctions: DesignerJunction[] } {
  const unionFind = new UnionFind();
  const incidentCount = new Map<string, number>();
  const pinKeyById = new Map<string, string>();

  for (const part of parts) {
    for (const pin of part.pins) {
      const key = pointKey(pin.worldPositionNm);
      pinKeyById.set(pin.id, key);
      unionFind.add(key);
    }
  }
  for (const label of labels) unionFind.add(pointKey(label.positionNm));

  for (const wire of wires) {
    for (const point of wire.pointsNm) unionFind.add(pointKey(point));
    for (let index = 1; index < wire.pointsNm.length; index += 1) {
      const prev = wire.pointsNm[index - 1];
      const curr = wire.pointsNm[index];
      if (!prev || !curr) continue;
      const prevKey = pointKey(prev);
      const currKey = pointKey(curr);
      unionFind.union(prevKey, currKey);
      incidentCount.set(prevKey, (incidentCount.get(prevKey) ?? 0) + 1);
      incidentCount.set(currKey, (incidentCount.get(currKey) ?? 0) + 1);
    }
    const first = wire.pointsNm[0];
    const last = wire.pointsNm[wire.pointsNm.length - 1];
    const sourceKey = pinKeyById.get(wire.sourcePinId);
    const targetKey = pinKeyById.get(wire.targetPinId);
    if (sourceKey && first) unionFind.union(sourceKey, pointKey(first));
    if (targetKey && last) unionFind.union(targetKey, pointKey(last));
  }

  const netMap = new Map<
    string,
    {
      pinIds: Set<string>;
      wireIds: Set<string>;
      labelIds: Set<string>;
      names: Set<string>;
    }
  >();
  const ensureNet = (root: string) => {
    const existing = netMap.get(root);
    if (existing) return existing;
    const created = {
      pinIds: new Set<string>(),
      wireIds: new Set<string>(),
      labelIds: new Set<string>(),
      names: new Set<string>(),
    };
    netMap.set(root, created);
    return created;
  };

  for (const part of parts)
    for (const pin of part.pins)
      ensureNet(unionFind.find(pointKey(pin.worldPositionNm))).pinIds.add(
        pin.id,
      );
  for (const wire of wires) {
    const anchor = wire.pointsNm[0];
    if (anchor)
      ensureNet(unionFind.find(pointKey(anchor))).wireIds.add(wire.id);
  }
  for (const label of labels) {
    const net = ensureNet(unionFind.find(pointKey(label.positionNm)));
    net.labelIds.add(label.id);
    if (label.text.trim()) net.names.add(label.text.trim());
  }

  let unnamedIndex = 1;
  const nets = [...netMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([root, net]) => {
      const names = [...net.names].sort((a, b) => a.localeCompare(b));
      return {
        id: root,
        name: names[0] ?? `Net_${unnamedIndex++}`,
        pinIds: [...net.pinIds].sort((a, b) => a.localeCompare(b)),
        wireIds: [...net.wireIds].sort((a, b) => a.localeCompare(b)),
        labelIds: [...net.labelIds].sort((a, b) => a.localeCompare(b)),
      };
    });

  const junctions = [...incidentCount.entries()]
    .filter(([, count]) => count >= 3)
    .map(([key]) => parsePointKey(key))
    .map((point) => ({ xNm: point.x, yNm: point.y }))
    .sort((a, b) => (a.xNm === b.xNm ? a.yNm - b.yNm : a.xNm - b.xNm));

  return { nets, junctions };
}

export function projectionFromWorld(
  designId: string,
  revision: number,
  world: EcsWorld<DesignerWorldComponent>,
): DesignerSchematicProjection {
  const parts: DesignerPlacedPart[] = [];
  const wires: DesignerWire[] = [];
  const labels: DesignerLabel[] = [];

  for (const snapshot of world.snapshots()) {
    const component = snapshot.components.get("designer.entity");
    if (!component || component.type !== "designer.entity") continue;
    if (component.kind === "part")
      parts.push(component.payload as unknown as DesignerPlacedPart);
    if (component.kind === "wire")
      wires.push(component.payload as unknown as DesignerWire);
    if (component.kind === "label")
      labels.push(component.payload as unknown as DesignerLabel);
  }

  parts.sort((a, b) => a.id.localeCompare(b.id));
  wires.sort((a, b) => a.id.localeCompare(b.id));
  labels.sort((a, b) => a.id.localeCompare(b.id));
  const derived = deriveNetsAndJunctions(parts, wires, labels);
  return {
    designId,
    revision,
    parts,
    wires,
    labels,
    nets: derived.nets,
    junctions: derived.junctions,
  };
}

export function replaceSchematicProjection(
  tx: DbClient,
  designId: string,
  projection: DesignerSchematicProjection,
  timestamp: string,
): void {
  tx.delete(schematicPins).where(eq(schematicPins.designId, designId)).run();
  tx.delete(schematicWires).where(eq(schematicWires.designId, designId)).run();
  tx.delete(schematicLabels)
    .where(eq(schematicLabels.designId, designId))
    .run();
  tx.delete(schematicParts).where(eq(schematicParts.designId, designId)).run();

  for (const part of projection.parts) {
    tx.insert(schematicParts)
      .values({
        id: part.id,
        designId,
        componentId: part.componentId,
        reference: part.reference,
        value: part.value,
        positionXNm: part.positionNm.x,
        positionYNm: part.positionNm.y,
        rotationDeg: normalizeRotationDeg(part.rotationDeg),
        mirrored: part.mirrored ? 1 : 0,
        symbolSnapshotJson: JSON.stringify(part.symbol),
        footprintSnapshotJson: JSON.stringify(part.footprint),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    for (const pin of part.pins) {
      tx.insert(schematicPins)
        .values({
          id: pin.id,
          designId,
          partId: part.id,
          originPinKey: pin.originPinKey,
          number: pin.number,
          name: pin.name,
          electricalType: pin.electricalType,
          unit: pin.unit,
          localXNm: pin.localPositionNm.x,
          localYNm: pin.localPositionNm.y,
          worldXNm: pin.worldPositionNm.x,
          worldYNm: pin.worldPositionNm.y,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
    }
  }

  for (const wire of projection.wires) {
    tx.insert(schematicWires)
      .values({
        id: wire.id,
        designId,
        sourcePinId: wire.sourcePinId,
        targetPinId: wire.targetPinId,
        pointsJson: JSON.stringify(wire.pointsNm),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }

  for (const label of projection.labels) {
    tx.insert(schematicLabels)
      .values({
        id: label.id,
        designId,
        text: label.text,
        xNm: label.positionNm.x,
        yNm: label.positionNm.y,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }

  tx.update(designHeads)
    .set({ revision: projection.revision, updatedAt: timestamp })
    .where(eq(designHeads.id, designId))
    .run();
}
