import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
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
  DesignerPrimitive,
  DesignerSchematicProjection,
  DesignerWire,
  PcbBoardSettings,
  PcbFreeHole,
  PcbFreePad,
  PcbOverlayShape,
  PcbOverlayText,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
} from "../../../sdks";
import { normalizeRotationDeg } from "./commands/place-part";
import { asPrimitiveFromPayload, insertPrimitiveRow } from "./primitive-store";
import {
  designHeads,
  schematicLabels,
  schematicParts,
  schematicPins,
  schematicPrimitives,
  schematicWires,
} from "./schema";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

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
    }
  | {
      type: "designer.pcb_free_hole";
      payload: Record<string, unknown>;
    }
  | {
      type: "designer.pcb_free_pad";
      payload: Record<string, unknown>;
    }
  | {
      type: "designer.pcb_overlay_text";
      payload: Record<string, unknown>;
    }
  | {
      type: "designer.pcb_overlay_shape";
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
    ...projection.primitives.map((primitive) => ({
      entityId: toWorldEntityId("primitive", primitive.id),
      component: {
        type: "designer.entity" as const,
        kind: "primitive" as const,
        payload: toPayloadRecord(
          primitive as unknown as Record<string, unknown>,
        ),
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
        snapshot.components.get("designer.pcb_via") ??
        snapshot.components.get("designer.pcb_free_hole") ??
        snapshot.components.get("designer.pcb_free_pad") ??
        snapshot.components.get("designer.pcb_overlay_text") ??
        snapshot.components.get("designer.pcb_overlay_shape");
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
const PCB_FREE_HOLE_PREFIX = "pcb:free_hole:";
const PCB_FREE_PAD_PREFIX = "pcb:free_pad:";
const PCB_OVERLAY_TEXT_PREFIX = "pcb:overlay_text:";
const PCB_OVERLAY_SHAPE_PREFIX = "pcb:overlay_shape:";

export interface DesignerCombinedState {
  schematic: DesignerSchematicProjection;
  pcb: PcbBoardSettings;
  placements: PcbPlacedPart[];
  traces: PcbTrace[];
  vias: PcbVia[];
  freeHoles: PcbFreeHole[];
  freePads: PcbFreePad[];
  overlayTexts: PcbOverlayText[];
  overlayShapes: PcbOverlayShape[];
}

export function combinedStateToWorld(
  state: DesignerCombinedState,
): EcsWorld<DesignerWorldComponent> {
  const world = projectionToWorld(state.schematic);
  world.ensureEntity(PCB_SETTINGS_ENTITY_ID);
  // Strip `viewState` from the snapshot fed into the history patch builder.
  // View state (viewSide / displayMode / fill toggles / opacities) is
  // display-only and changes via a non-undoable `pcb_set_view_state`
  // command. Including it would (a) make every viewState change emit a
  // history entry and (b) cause unrelated undos to revert the user's
  // current viewport configuration. board_settings persistence is
  // unaffected — the field still round-trips through `pcb-store.ts`.
  const { viewState: _viewState, ...pcbWithoutViewState } = state.pcb;
  world.setComponent(PCB_SETTINGS_ENTITY_ID, {
    type: "designer.pcb_settings",
    payload: toPayloadRecord(pcbWithoutViewState as typeof state.pcb),
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
  for (const hole of state.freeHoles) {
    const entityId = asEntityId(`${PCB_FREE_HOLE_PREFIX}${hole.id}`);
    world.ensureEntity(entityId);
    world.setComponent(entityId, {
      type: "designer.pcb_free_hole",
      payload: toPayloadRecord(hole),
    });
  }
  for (const pad of state.freePads) {
    const entityId = asEntityId(`${PCB_FREE_PAD_PREFIX}${pad.id}`);
    world.ensureEntity(entityId);
    world.setComponent(entityId, {
      type: "designer.pcb_free_pad",
      payload: toPayloadRecord(pad),
    });
  }
  for (const overlay of state.overlayTexts) {
    const entityId = asEntityId(`${PCB_OVERLAY_TEXT_PREFIX}${overlay.id}`);
    world.ensureEntity(entityId);
    world.setComponent(entityId, {
      type: "designer.pcb_overlay_text",
      payload: toPayloadRecord(overlay),
    });
  }
  for (const overlay of state.overlayShapes) {
    const entityId = asEntityId(`${PCB_OVERLAY_SHAPE_PREFIX}${overlay.id}`);
    world.ensureEntity(entityId);
    world.setComponent(entityId, {
      type: "designer.pcb_overlay_shape",
      payload: toPayloadRecord(overlay),
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
  const freeHoles: PcbFreeHole[] = [];
  const freePads: PcbFreePad[] = [];
  const overlayTexts: PcbOverlayText[] = [];
  const overlayShapes: PcbOverlayShape[] = [];
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
      continue;
    }
    const holeComp = snapshot.components.get("designer.pcb_free_hole");
    if (holeComp && holeComp.type === "designer.pcb_free_hole") {
      freeHoles.push(holeComp.payload as unknown as PcbFreeHole);
      continue;
    }
    const padComp = snapshot.components.get("designer.pcb_free_pad");
    if (padComp && padComp.type === "designer.pcb_free_pad") {
      freePads.push(padComp.payload as unknown as PcbFreePad);
      continue;
    }
    const overlayTextComp = snapshot.components.get(
      "designer.pcb_overlay_text",
    );
    if (
      overlayTextComp &&
      overlayTextComp.type === "designer.pcb_overlay_text"
    ) {
      overlayTexts.push(overlayTextComp.payload as unknown as PcbOverlayText);
      continue;
    }
    const overlayShapeComp = snapshot.components.get(
      "designer.pcb_overlay_shape",
    );
    if (
      overlayShapeComp &&
      overlayShapeComp.type === "designer.pcb_overlay_shape"
    ) {
      overlayShapes.push(
        overlayShapeComp.payload as unknown as PcbOverlayShape,
      );
    }
  }
  placements.sort((a, b) => a.id.localeCompare(b.id));
  traces.sort((a, b) => a.id.localeCompare(b.id));
  vias.sort((a, b) => a.id.localeCompare(b.id));
  freeHoles.sort((a, b) => a.id.localeCompare(b.id));
  freePads.sort((a, b) => a.id.localeCompare(b.id));
  overlayTexts.sort((a, b) => a.id.localeCompare(b.id));
  overlayShapes.sort((a, b) => a.id.localeCompare(b.id));
  return {
    schematic,
    pcb,
    placements,
    traces,
    vias,
    freeHoles,
    freePads,
    overlayTexts,
    overlayShapes,
  };
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

export interface NetDerivationWarning {
  code: "PWR_RAIL_CONFLICT" | "LABEL_OVERRIDDEN_BY_GND";
  netRoot: string;
  detail: string;
}

export interface NetDerivationResult {
  nets: DesignerDerivedNet[];
  junctions: DesignerJunction[];
  warnings: NetDerivationWarning[];
}

/**
 * Builds nets + junctions from schematic geometry. Net-name priority:
 *   GND port present                           -> "GND"
 *   exactly one PWR rail                       -> railText
 *   more than one PWR rail (rare conflict)     -> alphabetically first + warning
 *   any NET_PORTAL                             -> alphabetically first portalText
 *   any DesignerLabel text                     -> alphabetically first label text
 *   otherwise                                  -> Net_<n>
 *
 * NET_PORTALs sharing the same `portalText` join across disconnected
 * sub-graphs (cross-region net), which is what distinguishes them from local
 * DesignerLabels.
 */
export function deriveNetsAndJunctions(
  parts: DesignerPlacedPart[],
  wires: DesignerWire[],
  labels: DesignerLabel[],
  primitives: DesignerPrimitive[] = [],
): NetDerivationResult {
  const unionFind = new UnionFind();
  // Count wire segment-ends ("stubs") meeting at each point. A junction dot is
  // shown where >= 3 stubs coincide (T, cross, or a branch tapping a wire — even
  // a collinear branch). A single corner or a straight pass-through vertex has
  // exactly 2 stubs and is not a junction; clean paths never carry redundant
  // collinear vertices (simplifyCollinearPath removes them).
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
  for (const prim of primitives) {
    const key = pointKey(prim.positionNm);
    // Synthetic primitive pin id `primitive:<id>` so wires that terminate
    // on a primitive's connection point are unioned into the same net as
    // the primitive itself.
    pinKeyById.set(`primitive:${prim.id}`, key);
    unionFind.add(key);
  }

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

  // Global named-net union: every primitive that names a net merges with all
  // others sharing that name, even without a physical wire — across GND ports
  // (canonical "GND"), PWR rails (railText) and net portals (portalText) in ONE
  // namespace, so e.g. a pwr("+5V") and a net_portal("+5V") form a single net.
  // The grouping key is case-insensitive (VCC == vcc); display names are still
  // taken from the original primitive text downstream.
  const keysByNetName = new Map<string, string[]>();
  for (const prim of primitives) {
    let netName: string | null = null;
    if (prim.kind === "gnd") netName = "GND";
    else if (prim.kind === "pwr") netName = prim.railText.trim() || null;
    else if (prim.kind === "net_portal")
      netName = prim.portalText.trim() || null;
    if (!netName) continue;
    const groupKey = netName.toUpperCase();
    const arr = keysByNetName.get(groupKey) ?? [];
    arr.push(pointKey(prim.positionNm));
    keysByNetName.set(groupKey, arr);
  }
  for (const keys of keysByNetName.values()) {
    for (let index = 1; index < keys.length; index += 1) {
      unionFind.union(keys[0]!, keys[index]!);
    }
  }

  const netMap = new Map<
    string,
    {
      pinIds: Set<string>;
      wireIds: Set<string>;
      labelIds: Set<string>;
      primitiveIds: Set<string>;
      names: Set<string>;
      pwrRails: Set<string>;
      portalTexts: Set<string>;
      gndCount: number;
    }
  >();
  const ensureNet = (root: string) => {
    const existing = netMap.get(root);
    if (existing) return existing;
    const created = {
      pinIds: new Set<string>(),
      wireIds: new Set<string>(),
      labelIds: new Set<string>(),
      primitiveIds: new Set<string>(),
      names: new Set<string>(),
      pwrRails: new Set<string>(),
      portalTexts: new Set<string>(),
      gndCount: 0,
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
  for (const prim of primitives) {
    const net = ensureNet(unionFind.find(pointKey(prim.positionNm)));
    net.primitiveIds.add(prim.id);
    if (prim.kind === "gnd") {
      net.gndCount += 1;
    } else if (prim.kind === "pwr") {
      const rail = prim.railText.trim();
      if (rail.length > 0) net.pwrRails.add(rail);
    } else if (prim.kind === "net_portal") {
      const text = prim.portalText.trim();
      if (text.length > 0) net.portalTexts.add(text);
    }
  }

  const warnings: NetDerivationWarning[] = [];
  let unnamedIndex = 1;
  const nets = [...netMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([root, net]) => {
      let name: string;
      if (net.gndCount > 0) {
        name = "GND";
        // Warn if any non-GND label is on this net (likely a misnaming).
        for (const labelName of net.names) {
          if (labelName.toUpperCase() !== "GND") {
            warnings.push({
              code: "LABEL_OVERRIDDEN_BY_GND",
              netRoot: root,
              detail: `Label "${labelName}" overridden by GND port`,
            });
            break;
          }
        }
      } else if (net.pwrRails.size >= 1) {
        const sortedRails = [...net.pwrRails].sort((a, b) =>
          a.localeCompare(b),
        );
        name = sortedRails[0] ?? `Net_${unnamedIndex++}`;
        // Only a genuine conflict when the rails differ case-insensitively
        // (the global union already merges "VCC" and "vcc" into one net).
        const distinctRails = new Set(sortedRails.map((r) => r.toUpperCase()));
        if (distinctRails.size > 1) {
          warnings.push({
            code: "PWR_RAIL_CONFLICT",
            netRoot: root,
            detail: `Multiple power rails on one net: ${sortedRails.join(", ")}`,
          });
        }
      } else if (net.portalTexts.size > 0) {
        const sorted = [...net.portalTexts].sort((a, b) => a.localeCompare(b));
        name = sorted[0] ?? `Net_${unnamedIndex++}`;
      } else {
        const sortedLabels = [...net.names].sort((a, b) => a.localeCompare(b));
        name = sortedLabels[0] ?? `Net_${unnamedIndex++}`;
      }
      return {
        id: root,
        name,
        pinIds: [...net.pinIds].sort((a, b) => a.localeCompare(b)),
        wireIds: [...net.wireIds].sort((a, b) => a.localeCompare(b)),
        labelIds: [...net.labelIds].sort((a, b) => a.localeCompare(b)),
        primitiveIds: [...net.primitiveIds].sort((a, b) => a.localeCompare(b)),
      };
    });

  const junctions = [...incidentCount.entries()]
    .filter(([, count]) => count >= 3)
    .map(([key]) => parsePointKey(key))
    .map((point) => ({ xNm: point.x, yNm: point.y }))
    .sort((a, b) => (a.xNm === b.xNm ? a.yNm - b.yNm : a.xNm - b.xNm));

  return { nets, junctions, warnings };
}

export function projectionFromWorld(
  designId: string,
  revision: number,
  world: EcsWorld<DesignerWorldComponent>,
): DesignerSchematicProjection {
  const parts: DesignerPlacedPart[] = [];
  const wires: DesignerWire[] = [];
  const labels: DesignerLabel[] = [];
  const primitives: DesignerPrimitive[] = [];

  for (const snapshot of world.snapshots()) {
    const component = snapshot.components.get("designer.entity");
    if (!component || component.type !== "designer.entity") continue;
    if (component.kind === "part")
      parts.push(component.payload as unknown as DesignerPlacedPart);
    if (component.kind === "wire")
      wires.push(component.payload as unknown as DesignerWire);
    if (component.kind === "label")
      labels.push(component.payload as unknown as DesignerLabel);
    if (component.kind === "primitive") {
      const parsed = asPrimitiveFromPayload(component.payload);
      if (parsed) primitives.push(parsed);
    }
  }

  parts.sort((a, b) => a.id.localeCompare(b.id));
  wires.sort((a, b) => a.id.localeCompare(b.id));
  labels.sort((a, b) => a.id.localeCompare(b.id));
  primitives.sort((a, b) => a.id.localeCompare(b.id));
  const derived = deriveNetsAndJunctions(parts, wires, labels, primitives);
  return {
    designId,
    revision,
    parts,
    wires,
    labels,
    primitives,
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
  tx.delete(schematicPrimitives)
    .where(eq(schematicPrimitives.designId, designId))
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
        propertiesJson: JSON.stringify(part.propertiesJson ?? {}),
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

  for (const primitive of projection.primitives) {
    insertPrimitiveRow(tx, designId, primitive, timestamp);
  }

  tx.update(designHeads)
    .set({ revision: projection.revision, updatedAt: timestamp })
    .where(eq(designHeads.id, designId))
    .run();
}
