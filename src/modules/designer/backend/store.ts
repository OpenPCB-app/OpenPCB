import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type {
  CoreBackendModuleContext,
  ModuleDbClient,
} from "../../../core/contracts/modules/backend-module";
import {
  type DesignerCommandEnvelope,
  type DesignerCommandOkResult,
  type DesignerDerivedNet,
  type DesignerDesignRecord,
  type DesignerDesignSummary,
  type DesignerDispatchResult,
  type DesignerEntityKind,
  type DesignerJunction,
  type DesignerLabel,
  type DesignerPin,
  type DesignerPlacedPart,
  type DesignerSchematicProjection,
  type DesignerSearchLibraryParams,
  type DesignerWire,
  type LibraryComponent,
  type LibraryComponentPlacementDetail,
  type LibrarySDK,
} from "../../../contracts/modules/sdk";
import { MODULE_SDK_TOKENS } from "../../../contracts/modules/sdk-map";
import { buildCreateWirePayload } from "./commands/create-wire";
import {
  buildPlacePartPayload,
  normalizeRotationDeg,
  recomputePinWorldPositions,
} from "./commands/place-part";
import {
  type PersistedLabelPayload,
  type PersistedPartPayload,
  type PersistedWirePayload,
} from "./payload-types";
import {
  commandLog,
  designHeads,
  schematicLabels,
  schematicParts,
  schematicPins,
  schematicWires,
} from "./schema";

type DbClient = BunSQLiteDatabase<Record<string, unknown>>;

type PartRow = typeof schematicParts.$inferSelect;
type PinRow = typeof schematicPins.$inferSelect;
type WireRow = typeof schematicWires.$inferSelect;
type LabelRow = typeof schematicLabels.$inferSelect;

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
    if (rootA === rootB) {
      return;
    }
    this.parent.set(rootB, rootA);
  }
}

function getDb(moduleDb: ModuleDbClient): DbClient {
  return (moduleDb as { db: DbClient }).db;
}

function nowIso(): string {
  return new Date().toISOString();
}

function pointKey(point: { x: number; y: number }): string {
  return `${point.x}:${point.y}`;
}

function parsePointKey(key: string): { x: number; y: number } {
  const split = key.split(":", 2);
  return {
    x: Number(split[0] ?? "0"),
    y: Number(split[1] ?? "0"),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function parseJsonRecord(payloadJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed payload
  }
  return {};
}

function parseDispatchResultJson(payloadJson: string): DesignerDispatchResult | null {
  const parsed = parseJsonRecord(payloadJson);
  if (parsed.ok === true) {
    const revision = asNumber(parsed.revision);
    if (revision === null) {
      return null;
    }
    const createdEntityIdRaw = parsed.createdEntityId;
    return {
      ok: true,
      revision,
      createdEntityId:
        typeof createdEntityIdRaw === "string" || createdEntityIdRaw === null
          ? createdEntityIdRaw
          : null,
      idempotent: true,
    };
  }

  if (parsed.ok !== false) {
    return null;
  }

  const code = asString(parsed.code);
  if (!code) {
    return null;
  }

  if (code === "REVISION_CONFLICT") {
    const conflict = asRecord(parsed.conflict);
    const actual = asNumber(conflict?.actual);
    const expectedRaw = conflict?.expected;
    const expected = expectedRaw === null ? null : asNumber(expectedRaw);
    if (actual === null || (expectedRaw !== null && expected === null)) {
      return null;
    }
    return {
      ok: false,
      code,
      conflict: {
        expected,
        actual,
      },
    };
  }

  if (code === "COMPONENT_NOT_FOUND") {
    const componentId = asString(parsed.componentId);
    return componentId
      ? {
          ok: false,
          code,
          componentId,
        }
      : null;
  }

  if (code === "COMPONENT_NOT_WIREABLE") {
    const componentId = asString(parsed.componentId);
    const reason = asString(parsed.reason);
    if (!componentId || reason !== "NO_PINS") {
      return null;
    }
    return {
      ok: false,
      code,
      componentId,
      reason,
    };
  }

  if (code === "PIN_NOT_FOUND") {
    const pinId = asString(parsed.pinId);
    return pinId
      ? {
          ok: false,
          code,
          pinId,
        }
      : null;
  }

  if (code === "ENTITY_NOT_FOUND") {
    const entityId = asString(parsed.entityId);
    const entityKind = asString(parsed.entityKind) as DesignerEntityKind | null;
    if (!entityId || !entityKind) {
      return null;
    }
    if (entityKind !== "part" && entityKind !== "wire" && entityKind !== "label") {
      return null;
    }
    return {
      ok: false,
      code,
      entityId,
      entityKind,
    };
  }

  if (code === "INVALID_WIRE_PATH") {
    const detail = asString(parsed.detail);
    return detail
      ? {
          ok: false,
          code,
          detail,
        }
      : null;
  }

  if (code === "INVALID_LABEL") {
    const detail = asString(parsed.detail);
    return detail
      ? {
          ok: false,
          code,
          detail,
        }
      : null;
  }

  return null;
}

function conflict(expected: number | null, actual: number): DesignerDispatchResult {
  return {
    ok: false,
    code: "REVISION_CONFLICT",
    conflict: {
      expected,
      actual,
    },
  };
}

function componentNotFound(componentId: string): DesignerDispatchResult {
  return {
    ok: false,
    code: "COMPONENT_NOT_FOUND",
    componentId,
  };
}

function pinNotFound(pinId: string): DesignerDispatchResult {
  return {
    ok: false,
    code: "PIN_NOT_FOUND",
    pinId,
  };
}

function entityNotFound(
  entityId: string,
  entityKind: DesignerEntityKind,
): DesignerDispatchResult {
  return {
    ok: false,
    code: "ENTITY_NOT_FOUND",
    entityId,
    entityKind,
  };
}

function invalidWirePath(detail: string): DesignerDispatchResult {
  return {
    ok: false,
    code: "INVALID_WIRE_PATH",
    detail,
  };
}

function invalidLabel(detail: string): DesignerDispatchResult {
  return {
    ok: false,
    code: "INVALID_LABEL",
    detail,
  };
}

function okResult(revision: number, createdEntityId: string): DesignerCommandOkResult {
  return {
    ok: true,
    revision,
    createdEntityId,
    idempotent: false,
  };
}

function parseSymbolSnapshotJson(payloadJson: string): LibraryComponentPlacementDetail["symbol"] {
  return parseJsonRecord(payloadJson) as unknown as LibraryComponentPlacementDetail["symbol"];
}

function parseFootprintSnapshotJson(
  payloadJson: string,
): LibraryComponentPlacementDetail["footprint"] {
  return parseJsonRecord(payloadJson) as unknown as LibraryComponentPlacementDetail["footprint"];
}

function mapPinRow(row: PinRow): DesignerPin {
  return {
    id: row.id,
    originPinKey: row.originPinKey,
    number: row.number,
    name: row.name,
    electricalType: row.electricalType,
    unit: row.unit,
    localPositionNm: {
      x: row.localXNm,
      y: row.localYNm,
    },
    worldPositionNm: {
      x: row.worldXNm,
      y: row.worldYNm,
    },
  };
}

function mapPartRow(row: PartRow, pins: DesignerPin[]): DesignerPlacedPart {
  return {
    id: row.id,
    componentId: row.componentId,
    reference: row.reference,
    value: row.value,
    rotationDeg: normalizeRotationDeg(row.rotationDeg),
    mirrored: row.mirrored === 1,
    positionNm: {
      x: row.positionXNm,
      y: row.positionYNm,
    },
    symbol: parseSymbolSnapshotJson(row.symbolSnapshotJson),
    footprint: parseFootprintSnapshotJson(row.footprintSnapshotJson),
    pins,
  };
}

function mapWireRow(row: WireRow): DesignerWire {
  const parsed = JSON.parse(row.pointsJson) as unknown;
  const points = Array.isArray(parsed)
    ? parsed
        .map((point) => {
          const record = asRecord(point);
          const x = asNumber(record?.x);
          const y = asNumber(record?.y);
          if (x === null || y === null) {
            return null;
          }
          return { x, y };
        })
        .filter((point): point is { x: number; y: number } => point !== null)
    : [];

  return {
    id: row.id,
    sourcePinId: row.sourcePinId,
    targetPinId: row.targetPinId,
    pointsNm: points,
  };
}

function parseWirePointsJson(pointsJson: string): Array<{ x: number; y: number }> {
  const parsed = JSON.parse(pointsJson) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map((point) => {
      const record = asRecord(point);
      const x = asNumber(record?.x);
      const y = asNumber(record?.y);
      if (x === null || y === null) {
        return null;
      }
      return { x, y };
    })
    .filter((point): point is { x: number; y: number } => point !== null);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function projectPointToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number; t: number; distance: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return {
      x: start.x,
      y: start.y,
      t: 0,
      distance: distance(point, start),
    };
  }
  const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lenSq;
  const t = Math.max(0, Math.min(1, rawT));
  const projected = {
    x: Math.round(start.x + dx * t),
    y: Math.round(start.y + dy * t),
  };
  return {
    ...projected,
    t,
    distance: distance(point, projected),
  };
}

function insertVertexOnWire(
  points: Array<{ x: number; y: number }>,
  point: { x: number; y: number },
): { points: Array<{ x: number; y: number }>; insertIndex: number } | null {
  if (points.length < 2) {
    return null;
  }

  let bestIndex = -1;
  let bestProjection: { x: number; y: number; t: number; distance: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const curr = points[index];
    if (!prev || !curr) {
      continue;
    }
    const projection = projectPointToSegment(point, prev, curr);
    if (projection.distance < bestDistance) {
      bestDistance = projection.distance;
      bestProjection = projection;
      bestIndex = index;
    }
  }

  if (!bestProjection || bestIndex < 1) {
    return null;
  }

  const result = [...points];
  const prev = result[bestIndex - 1];
  const curr = result[bestIndex];
  if (!prev || !curr) {
    return null;
  }

  if (pointKey(prev) === pointKey(bestProjection)) {
    return {
      points: result,
      insertIndex: bestIndex - 1,
    };
  }
  if (pointKey(curr) === pointKey(bestProjection)) {
    return {
      points: result,
      insertIndex: bestIndex,
    };
  }

  result.splice(bestIndex, 0, { x: bestProjection.x, y: bestProjection.y });
  return {
    points: result,
    insertIndex: bestIndex,
  };
}

function sanitizePath(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const output: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    const prev = output[output.length - 1];
    if (prev && pointKey(prev) === pointKey(point)) {
      continue;
    }
    output.push(point);
  }
  return output;
}

function stretchWireEndpoint(
  points: Array<{ x: number; y: number }>,
  endpoint: "source" | "target",
  from: { x: number; y: number },
  to: { x: number; y: number },
): Array<{ x: number; y: number }> {
  if (from.x === to.x && from.y === to.y) {
    return points;
  }
  if (points.length === 0) {
    return points;
  }

  const adjusted = points.map((point) => ({ ...point }));
  const endpointIndex = endpoint === "source" ? 0 : adjusted.length - 1;
  const neighborIndex = endpoint === "source" ? 1 : adjusted.length - 2;
  const endpointPoint = adjusted[endpointIndex];
  if (!endpointPoint) {
    return adjusted;
  }

  endpointPoint.x = to.x;
  endpointPoint.y = to.y;

  const neighbor = adjusted[neighborIndex];
  if (!neighbor) {
    return adjusted;
  }

  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;

  if (from.x === neighbor.x) {
    neighbor.x += deltaX;
  } else if (from.y === neighbor.y) {
    neighbor.y += deltaY;
  } else {
    neighbor.x += deltaX;
    neighbor.y += deltaY;
  }

  return sanitizePath(adjusted);
}

function updateConnectedWireGeometry(params: {
  tx: DbClient;
  designId: string;
  movedPinIds: string[];
  oldByPinId: Map<string, { x: number; y: number }>;
  nextByPinId: Map<string, { x: number; y: number }>;
  timestamp: string;
}): void {
  const { tx, designId, movedPinIds, oldByPinId, nextByPinId, timestamp } = params;
  if (movedPinIds.length === 0) {
    return;
  }

  const wireRows = tx
    .select()
    .from(schematicWires)
    .where(
      and(
        eq(schematicWires.designId, designId),
        or(
          inArray(schematicWires.sourcePinId, movedPinIds),
          inArray(schematicWires.targetPinId, movedPinIds),
        ),
      ),
    )
    .all();

  for (const wireRow of wireRows) {
    let points = parseWirePointsJson(wireRow.pointsJson);
    if (points.length === 0) {
      continue;
    }

    const oldSource = oldByPinId.get(wireRow.sourcePinId);
    const nextSource = nextByPinId.get(wireRow.sourcePinId);
    if (oldSource && nextSource) {
      points = stretchWireEndpoint(points, "source", oldSource, nextSource);
    }

    const oldTarget = oldByPinId.get(wireRow.targetPinId);
    const nextTarget = nextByPinId.get(wireRow.targetPinId);
    if (oldTarget && nextTarget) {
      points = stretchWireEndpoint(points, "target", oldTarget, nextTarget);
    }

    tx.update(schematicWires)
      .set({
        pointsJson: JSON.stringify(points),
        updatedAt: timestamp,
      })
      .where(eq(schematicWires.id, wireRow.id))
      .run();
  }
}

function mapLabelRow(row: LabelRow): DesignerLabel {
  return {
    id: row.id,
    text: row.text,
    positionNm: {
      x: row.xNm,
      y: row.yNm,
    },
  };
}

function deriveNetsAndJunctions(
  parts: DesignerPlacedPart[],
  wires: DesignerWire[],
  labels: DesignerLabel[],
): {
  nets: DesignerDerivedNet[];
  junctions: DesignerJunction[];
} {
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

  for (const label of labels) {
    unionFind.add(pointKey(label.positionNm));
  }

  for (const wire of wires) {
    for (const point of wire.pointsNm) {
      unionFind.add(pointKey(point));
    }

    for (let index = 1; index < wire.pointsNm.length; index += 1) {
      const prev = wire.pointsNm[index - 1];
      const curr = wire.pointsNm[index];
      if (!prev || !curr) {
        continue;
      }
      const prevKey = pointKey(prev);
      const currKey = pointKey(curr);
      unionFind.union(prevKey, currKey);
      incidentCount.set(prevKey, (incidentCount.get(prevKey) ?? 0) + 1);
      incidentCount.set(currKey, (incidentCount.get(currKey) ?? 0) + 1);
    }

    const sourceKey = pinKeyById.get(wire.sourcePinId);
    const targetKey = pinKeyById.get(wire.targetPinId);
    const first = wire.pointsNm[0];
    const last = wire.pointsNm[wire.pointsNm.length - 1];
    if (sourceKey && first) {
      unionFind.union(sourceKey, pointKey(first));
    }
    if (targetKey && last) {
      unionFind.union(targetKey, pointKey(last));
    }
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

  function ensureNet(root: string) {
    const existing = netMap.get(root);
    if (existing) {
      return existing;
    }
    const created = {
      pinIds: new Set<string>(),
      wireIds: new Set<string>(),
      labelIds: new Set<string>(),
      names: new Set<string>(),
    };
    netMap.set(root, created);
    return created;
  }

  for (const part of parts) {
    for (const pin of part.pins) {
      const root = unionFind.find(pointKey(pin.worldPositionNm));
      ensureNet(root).pinIds.add(pin.id);
    }
  }

  for (const wire of wires) {
    const anchor = wire.pointsNm[0];
    if (!anchor) {
      continue;
    }
    const root = unionFind.find(pointKey(anchor));
    ensureNet(root).wireIds.add(wire.id);
  }

  for (const label of labels) {
    const root = unionFind.find(pointKey(label.positionNm));
    const net = ensureNet(root);
    net.labelIds.add(label.id);
    if (label.text.trim().length > 0) {
      net.names.add(label.text.trim());
    }
  }

  const nets: DesignerDerivedNet[] = [];
  const sortedRoots = [...netMap.keys()].sort((a, b) => a.localeCompare(b));
  let unnamedIndex = 1;
  for (const root of sortedRoots) {
    const net = netMap.get(root);
    if (!net) {
      continue;
    }

    const names = [...net.names].sort((a, b) => a.localeCompare(b));
    const name = names[0] ?? `Net_${unnamedIndex++}`;
    nets.push({
      id: root,
      name,
      pinIds: [...net.pinIds].sort((a, b) => a.localeCompare(b)),
      wireIds: [...net.wireIds].sort((a, b) => a.localeCompare(b)),
      labelIds: [...net.labelIds].sort((a, b) => a.localeCompare(b)),
    });
  }

  const junctions: DesignerJunction[] = [...incidentCount.entries()]
    .filter(([, count]) => count >= 3)
    .map(([key]) => parsePointKey(key))
    .map((point) => ({ xNm: point.x, yNm: point.y }))
    .sort((a, b) => (a.xNm === b.xNm ? a.yNm - b.yNm : a.xNm - b.xNm));

  return {
    nets,
    junctions,
  };
}

function loadSchematicProjection(db: DbClient, designId: string): DesignerSchematicProjection | null {
  const head = db.select().from(designHeads).where(eq(designHeads.id, designId)).get();
  if (!head) {
    return null;
  }

  const partRows = db
    .select()
    .from(schematicParts)
    .where(eq(schematicParts.designId, designId))
    .orderBy(asc(schematicParts.createdAt))
    .all();

  const pinRows = db
    .select()
    .from(schematicPins)
    .where(eq(schematicPins.designId, designId))
    .orderBy(asc(schematicPins.createdAt))
    .all();

  const wireRows = db
    .select()
    .from(schematicWires)
    .where(eq(schematicWires.designId, designId))
    .orderBy(asc(schematicWires.createdAt))
    .all();

  const labelRows = db
    .select()
    .from(schematicLabels)
    .where(eq(schematicLabels.designId, designId))
    .orderBy(asc(schematicLabels.createdAt))
    .all();

  const pinsByPartId = new Map<string, DesignerPin[]>();
  for (const pinRow of pinRows) {
    const mapped = mapPinRow(pinRow);
    const target = pinsByPartId.get(pinRow.partId);
    if (target) {
      target.push(mapped);
    } else {
      pinsByPartId.set(pinRow.partId, [mapped]);
    }
  }

  const parts = partRows.map((row) => mapPartRow(row, pinsByPartId.get(row.id) ?? []));
  const wires = wireRows.map(mapWireRow);
  const labels = labelRows.map(mapLabelRow);
  const derived = deriveNetsAndJunctions(parts, wires, labels);

  return {
    designId,
    revision: head.revision,
    parts,
    wires,
    labels,
    nets: derived.nets,
    junctions: derived.junctions,
  };
}

function mapDesignSummary(row: typeof designHeads.$inferSelect): DesignerDesignSummary {
  return {
    id: row.id,
    name: row.name,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function resolveLibrarySdk(ctx: CoreBackendModuleContext): LibrarySDK {
  const sdk = ctx.sdk.get<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
  if (!sdk) {
    throw new Error("LibrarySDK unavailable in designer runtime context");
  }
  return sdk;
}

function toDesignRecordFromProjection(
  summary: DesignerDesignSummary,
  projection: DesignerSchematicProjection,
): DesignerDesignRecord {
  return {
    head: summary,
    entities: [
      ...projection.parts.map((part) => ({
        id: part.id,
        designId: summary.id,
        kind: "part" as const,
        payload: part as unknown as Record<string, unknown>,
        createdAt: summary.updatedAt,
        updatedAt: summary.updatedAt,
      })),
      ...projection.wires.map((wire) => ({
        id: wire.id,
        designId: summary.id,
        kind: "wire" as const,
        payload: wire as unknown as Record<string, unknown>,
        createdAt: summary.updatedAt,
        updatedAt: summary.updatedAt,
      })),
      ...projection.labels.map((label) => ({
        id: label.id,
        designId: summary.id,
        kind: "label" as const,
        payload: label as unknown as Record<string, unknown>,
        createdAt: summary.updatedAt,
        updatedAt: summary.updatedAt,
      })),
    ],
  };
}

export interface DesignerStore {
  createDesign(input?: { name?: string }): Promise<DesignerDesignSummary>;
  listDesigns(): Promise<DesignerDesignSummary[]>;
  getDesign(designId: string): Promise<DesignerDesignRecord | null>;
  getSchematicProjection(
    designId: string,
  ): Promise<DesignerSchematicProjection | null>;
  searchLibraryComponents(
    params: DesignerSearchLibraryParams,
  ): Promise<LibraryComponent[]>;
  resolveLibraryComponentForPlacement(
    componentId: string,
  ): Promise<LibraryComponentPlacementDetail | null>;
  dispatchCommand(
    designId: string,
    envelope: DesignerCommandEnvelope,
  ): Promise<DesignerDispatchResult>;
}

export function createDesignerStore(ctx: CoreBackendModuleContext): DesignerStore {
  const db = getDb(ctx.db);

  return {
    async createDesign(input) {
      const id = crypto.randomUUID();
      const timestamp = nowIso();
      const name = input?.name?.trim() || "Untitled Design";

      db.insert(designHeads)
        .values({
          id,
          name,
          revision: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();

      return {
        id,
        name,
        revision: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },

    async listDesigns() {
      const rows = db
        .select()
        .from(designHeads)
        .orderBy(asc(designHeads.createdAt))
        .all();
      return rows.map(mapDesignSummary);
    },

    async getDesign(designId) {
      const head = db.select().from(designHeads).where(eq(designHeads.id, designId)).get();
      if (!head) {
        return null;
      }

      const projection = loadSchematicProjection(db, designId);
      if (!projection) {
        return null;
      }

      return toDesignRecordFromProjection(mapDesignSummary(head), projection);
    },

    async getSchematicProjection(designId) {
      return loadSchematicProjection(db, designId);
    },

    async searchLibraryComponents(params) {
      const library = resolveLibrarySdk(ctx);
      return library.searchComponents({
        query: params.query,
        tags: params.tags,
        limit: params.limit,
      });
    },

    async resolveLibraryComponentForPlacement(componentId) {
      const library = resolveLibrarySdk(ctx);
      return library.resolveComponentForPlacement(componentId);
    },

    async dispatchCommand(designId, envelope) {
      const existingLog = db
        .select()
        .from(commandLog)
        .where(eq(commandLog.commandId, envelope.commandId))
        .get();
      if (existingLog) {
        if (existingLog.designId !== designId) {
          return conflict(envelope.baseRevision, existingLog.appliedRevision);
        }

        const parsed = parseDispatchResultJson(existingLog.resultJson);
        if (parsed) {
          if (parsed.ok) {
            return {
              ...parsed,
              idempotent: true,
            };
          }
          return parsed;
        }

        return conflict(envelope.baseRevision, existingLog.appliedRevision);
      }

      const placeComponentDetail =
        envelope.command.type === "place_part"
          ? await this.resolveLibraryComponentForPlacement(envelope.command.componentId)
          : null;

      try {
        const result = ctx.db.transaction((txRaw) => {
          const tx = txRaw as DbClient;
          const head = tx
            .select()
            .from(designHeads)
            .where(eq(designHeads.id, designId))
            .get();
          if (!head) {
            const missingResult = conflict(envelope.baseRevision, -1);
            tx.insert(commandLog)
              .values({
                commandId: envelope.commandId,
                designId,
                sessionId: envelope.sessionId,
                commandType: envelope.command.type,
                commandJson: JSON.stringify(envelope.command),
                resultJson: JSON.stringify(missingResult),
                issuedAt: Math.trunc(envelope.issuedAt),
                appliedRevision: -1,
                createdAt: nowIso(),
              })
              .run();
            return missingResult;
          }

          if (
            envelope.baseRevision !== null &&
            envelope.baseRevision !== head.revision
          ) {
            const conflictResult = conflict(envelope.baseRevision, head.revision);
            tx.insert(commandLog)
              .values({
                commandId: envelope.commandId,
                designId,
                sessionId: envelope.sessionId,
                commandType: envelope.command.type,
                commandJson: JSON.stringify(envelope.command),
                resultJson: JSON.stringify(conflictResult),
                issuedAt: Math.trunc(envelope.issuedAt),
                appliedRevision: head.revision,
                createdAt: nowIso(),
              })
              .run();
            return conflictResult;
          }

          const projection = loadSchematicProjection(tx, designId);
          if (!projection) {
            const missingResult = conflict(envelope.baseRevision, head.revision);
            tx.insert(commandLog)
              .values({
                commandId: envelope.commandId,
                designId,
                sessionId: envelope.sessionId,
                commandType: envelope.command.type,
                commandJson: JSON.stringify(envelope.command),
                resultJson: JSON.stringify(missingResult),
                issuedAt: Math.trunc(envelope.issuedAt),
                appliedRevision: head.revision,
                createdAt: nowIso(),
              })
              .run();
            return missingResult;
          }

          const timestamp = nowIso();
          let result: DesignerDispatchResult;

          const command = envelope.command;
          if (command.type === "place_part") {
            if (!placeComponentDetail) {
              result = componentNotFound(command.componentId);
            } else {
              const payload: PersistedPartPayload = buildPlacePartPayload(
                placeComponentDetail,
                command.positionNm,
                command.rotationDeg ?? 0,
                command.mirrored ?? false,
                projection.parts,
              );

              tx.insert(schematicParts)
                .values({
                  id: payload.id,
                  designId,
                  componentId: payload.componentId,
                  reference: payload.reference,
                  value: payload.value,
                  positionXNm: payload.positionNm.x,
                  positionYNm: payload.positionNm.y,
                  rotationDeg: payload.rotationDeg,
                  mirrored: payload.mirrored ? 1 : 0,
                  symbolSnapshotJson: JSON.stringify(payload.symbol),
                  footprintSnapshotJson: JSON.stringify(payload.footprint),
                  createdAt: timestamp,
                  updatedAt: timestamp,
                })
                .run();

              for (const pin of payload.pins) {
                tx.insert(schematicPins)
                  .values({
                    id: pin.id,
                    designId,
                    partId: payload.id,
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

              const nextRevision = head.revision + 1;
              tx.update(designHeads)
                .set({
                  revision: nextRevision,
                  updatedAt: timestamp,
                })
                .where(eq(designHeads.id, designId))
                .run();

              result = okResult(nextRevision, payload.id);
            }
          } else if (command.type === "create_wire") {
            const sourcePinRow = tx
              .select()
              .from(schematicPins)
              .where(
                and(
                  eq(schematicPins.designId, designId),
                  eq(schematicPins.id, command.sourcePinId),
                ),
              )
              .get();
            if (!sourcePinRow) {
              result = pinNotFound(command.sourcePinId);
            } else {
              const targetPinRow = tx
                .select()
                .from(schematicPins)
                .where(
                  and(
                    eq(schematicPins.designId, designId),
                    eq(schematicPins.id, command.targetPinId),
                  ),
                )
                .get();
              if (!targetPinRow) {
                result = pinNotFound(command.targetPinId);
              } else {
                const sourcePin = mapPinRow(sourcePinRow);
                const targetPin = mapPinRow(targetPinRow);

                const built = buildCreateWirePayload(
                  sourcePin,
                  targetPin,
                  command.pointsNm,
                );
                if (!built.payload) {
                  result = invalidWirePath(
                    built.invalidReason ?? "wire path is invalid",
                  );
                } else {
                  const payload: PersistedWirePayload = built.payload;
                  tx.insert(schematicWires)
                    .values({
                      id: payload.id,
                      designId,
                      sourcePinId: payload.sourcePinId,
                      targetPinId: payload.targetPinId,
                      pointsJson: JSON.stringify(payload.pointsNm),
                      createdAt: timestamp,
                      updatedAt: timestamp,
                    })
                    .run();

                  const nextRevision = head.revision + 1;
                  tx.update(designHeads)
                    .set({
                      revision: nextRevision,
                      updatedAt: timestamp,
                    })
                    .where(eq(designHeads.id, designId))
                    .run();

                  result = okResult(nextRevision, payload.id);
                }
              }
            }
          } else if (command.type === "create_wire_junction") {
            const sourcePinRow = tx
              .select()
              .from(schematicPins)
              .where(
                and(
                  eq(schematicPins.designId, designId),
                  eq(schematicPins.id, command.sourcePinId),
                ),
              )
              .get();
            if (!sourcePinRow) {
              result = pinNotFound(command.sourcePinId);
            } else {
              const wireRow = tx
                .select()
                .from(schematicWires)
                .where(
                  and(
                    eq(schematicWires.designId, designId),
                    eq(schematicWires.id, command.wireId),
                  ),
                )
                .get();
              if (!wireRow) {
                result = entityNotFound(command.wireId, "wire");
              } else {
                const sourcePin = mapPinRow(sourcePinRow);
                const wirePoints = parseWirePointsJson(wireRow.pointsJson);
                const insertion = insertVertexOnWire(wirePoints, command.targetPointNm);

                if (!insertion) {
                  result = invalidWirePath("target wire has no routable segments");
                } else {
                  const junctionPoint = insertion.points[insertion.insertIndex];
                  if (!junctionPoint) {
                    result = invalidWirePath("junction insertion failed");
                  } else {
                    const endpointSourcePinRow = tx
                      .select()
                      .from(schematicPins)
                      .where(
                        and(
                          eq(schematicPins.designId, designId),
                          eq(schematicPins.id, wireRow.sourcePinId),
                        ),
                      )
                      .get();
                    const endpointTargetPinRow = tx
                      .select()
                      .from(schematicPins)
                      .where(
                        and(
                          eq(schematicPins.designId, designId),
                          eq(schematicPins.id, wireRow.targetPinId),
                        ),
                      )
                      .get();

                    if (!endpointSourcePinRow) {
                      result = pinNotFound(wireRow.sourcePinId);
                    } else if (!endpointTargetPinRow) {
                      result = pinNotFound(wireRow.targetPinId);
                    } else {
                      const endpointSourcePin = mapPinRow(endpointSourcePinRow);
                      const endpointTargetPin = mapPinRow(endpointTargetPinRow);

                      const pseudoJunctionPin: DesignerPin = {
                        id: `junction:${wireRow.id}`,
                        originPinKey: `junction:${wireRow.id}`,
                        number: null,
                        name: "junction",
                        electricalType: "passive",
                        unit: 1,
                        localPositionNm: {
                          x: junctionPoint.x,
                          y: junctionPoint.y,
                        },
                        worldPositionNm: {
                          x: junctionPoint.x,
                          y: junctionPoint.y,
                        },
                      };

                      const toJunctionBuild = buildCreateWirePayload(
                        sourcePin,
                        pseudoJunctionPin,
                        command.pointsNm,
                      );
                      if (!toJunctionBuild.payload) {
                        result = invalidWirePath(
                          toJunctionBuild.invalidReason ?? "wire path is invalid",
                        );
                      } else {
                        const pathToSourceEndpoint = insertion.points
                          .slice(0, insertion.insertIndex + 1)
                          .reverse();
                        const pathToTargetEndpoint = insertion.points.slice(insertion.insertIndex);

                        const pathLength = (points: Array<{ x: number; y: number }>): number => {
                          let total = 0;
                          for (let index = 1; index < points.length; index += 1) {
                            const prev = points[index - 1];
                            const curr = points[index];
                            if (!prev || !curr) {
                              continue;
                            }
                            total += Math.abs(curr.x - prev.x) + Math.abs(curr.y - prev.y);
                          }
                          return total;
                        };

                        const useSourceEndpoint =
                          pathLength(pathToSourceEndpoint) <= pathLength(pathToTargetEndpoint);
                        const endpointPath = useSourceEndpoint
                          ? pathToSourceEndpoint
                          : pathToTargetEndpoint;
                        const targetEndpointPin = useSourceEndpoint
                          ? endpointSourcePin
                          : endpointTargetPin;

                        const mergedPoints = sanitizePath([
                          ...toJunctionBuild.payload.pointsNm,
                          ...endpointPath.slice(1),
                        ]);
                        const finalBuild = buildCreateWirePayload(
                          sourcePin,
                          targetEndpointPin,
                          mergedPoints,
                        );
                        if (!finalBuild.payload) {
                          result = invalidWirePath(
                            finalBuild.invalidReason ?? "wire path is invalid",
                          );
                        } else {
                          tx.update(schematicWires)
                            .set({
                              pointsJson: JSON.stringify(insertion.points),
                              updatedAt: timestamp,
                            })
                            .where(eq(schematicWires.id, wireRow.id))
                            .run();

                          tx.insert(schematicWires)
                            .values({
                              id: finalBuild.payload.id,
                              designId,
                              sourcePinId: finalBuild.payload.sourcePinId,
                              targetPinId: finalBuild.payload.targetPinId,
                              pointsJson: JSON.stringify(finalBuild.payload.pointsNm),
                              createdAt: timestamp,
                              updatedAt: timestamp,
                            })
                            .run();

                          const nextRevision = head.revision + 1;
                          tx.update(designHeads)
                            .set({
                              revision: nextRevision,
                              updatedAt: timestamp,
                            })
                            .where(eq(designHeads.id, designId))
                            .run();

                          result = okResult(nextRevision, finalBuild.payload.id);
                        }
                      }
                    }
                  }
                }
              }
            }
          } else if (command.type === "move_part") {
            const partRow = tx
              .select()
              .from(schematicParts)
              .where(
                and(
                  eq(schematicParts.designId, designId),
                  eq(schematicParts.id, command.partId),
                ),
              )
              .get();
            if (!partRow) {
              result = entityNotFound(command.partId, "part");
            } else {
              tx.update(schematicParts)
                .set({
                  positionXNm: command.positionNm.x,
                  positionYNm: command.positionNm.y,
                  updatedAt: timestamp,
                })
                .where(eq(schematicParts.id, command.partId))
                .run();

              const pinRows = tx
                .select()
                .from(schematicPins)
                .where(eq(schematicPins.partId, command.partId))
                .all();

              const worlds = recomputePinWorldPositions(
                pinRows.map((pin) => ({
                  localPositionNm: {
                    x: pin.localXNm,
                    y: pin.localYNm,
                  },
                })),
                command.positionNm,
                normalizeRotationDeg(partRow.rotationDeg),
                partRow.mirrored === 1,
              );

              const oldByPinId = new Map<string, { x: number; y: number }>();
              const nextByPinId = new Map<string, { x: number; y: number }>();

              for (let index = 0; index < pinRows.length; index += 1) {
                const pin = pinRows[index];
                const world = worlds[index];
                if (!pin || !world) {
                  continue;
                }
                oldByPinId.set(pin.id, { x: pin.worldXNm, y: pin.worldYNm });
                nextByPinId.set(pin.id, { x: world.x, y: world.y });
                tx.update(schematicPins)
                  .set({
                    worldXNm: world.x,
                    worldYNm: world.y,
                    updatedAt: timestamp,
                  })
                  .where(eq(schematicPins.id, pin.id))
                  .run();
              }

              updateConnectedWireGeometry({
                tx,
                designId,
                movedPinIds: [...oldByPinId.keys()],
                oldByPinId,
                nextByPinId,
                timestamp,
              });

              const nextRevision = head.revision + 1;
              tx.update(designHeads)
                .set({
                  revision: nextRevision,
                  updatedAt: timestamp,
                })
                .where(eq(designHeads.id, designId))
                .run();

              result = okResult(nextRevision, command.partId);
            }
          } else if (command.type === "rotate_part") {
            const partRow = tx
              .select()
              .from(schematicParts)
              .where(
                and(
                  eq(schematicParts.designId, designId),
                  eq(schematicParts.id, command.partId),
                ),
              )
              .get();
            if (!partRow) {
              result = entityNotFound(command.partId, "part");
            } else {
              const rotationDeg = normalizeRotationDeg(command.rotationDeg);
              tx.update(schematicParts)
                .set({
                  rotationDeg,
                  updatedAt: timestamp,
                })
                .where(eq(schematicParts.id, command.partId))
                .run();

              const pinRows = tx
                .select()
                .from(schematicPins)
                .where(eq(schematicPins.partId, command.partId))
                .all();

              const worlds = recomputePinWorldPositions(
                pinRows.map((pin) => ({
                  localPositionNm: {
                    x: pin.localXNm,
                    y: pin.localYNm,
                  },
                })),
                {
                  x: partRow.positionXNm,
                  y: partRow.positionYNm,
                },
                rotationDeg,
                partRow.mirrored === 1,
              );

              const oldByPinId = new Map<string, { x: number; y: number }>();
              const nextByPinId = new Map<string, { x: number; y: number }>();

              for (let index = 0; index < pinRows.length; index += 1) {
                const pin = pinRows[index];
                const world = worlds[index];
                if (!pin || !world) {
                  continue;
                }
                oldByPinId.set(pin.id, { x: pin.worldXNm, y: pin.worldYNm });
                nextByPinId.set(pin.id, { x: world.x, y: world.y });
                tx.update(schematicPins)
                  .set({
                    worldXNm: world.x,
                    worldYNm: world.y,
                    updatedAt: timestamp,
                  })
                  .where(eq(schematicPins.id, pin.id))
                  .run();
              }

              updateConnectedWireGeometry({
                tx,
                designId,
                movedPinIds: [...oldByPinId.keys()],
                oldByPinId,
                nextByPinId,
                timestamp,
              });

              const nextRevision = head.revision + 1;
              tx.update(designHeads)
                .set({
                  revision: nextRevision,
                  updatedAt: timestamp,
                })
                .where(eq(designHeads.id, designId))
                .run();

              result = okResult(nextRevision, command.partId);
            }
          } else if (command.type === "mirror_part") {
            const partRow = tx
              .select()
              .from(schematicParts)
              .where(
                and(
                  eq(schematicParts.designId, designId),
                  eq(schematicParts.id, command.partId),
                ),
              )
              .get();
            if (!partRow) {
              result = entityNotFound(command.partId, "part");
            } else {
              const mirrored = command.mirrored ? 1 : 0;
              tx.update(schematicParts)
                .set({
                  mirrored,
                  updatedAt: timestamp,
                })
                .where(eq(schematicParts.id, command.partId))
                .run();

              const pinRows = tx
                .select()
                .from(schematicPins)
                .where(eq(schematicPins.partId, command.partId))
                .all();

              const worlds = recomputePinWorldPositions(
                pinRows.map((pin) => ({
                  localPositionNm: {
                    x: pin.localXNm,
                    y: pin.localYNm,
                  },
                })),
                {
                  x: partRow.positionXNm,
                  y: partRow.positionYNm,
                },
                normalizeRotationDeg(partRow.rotationDeg),
                mirrored === 1,
              );

              const oldByPinId = new Map<string, { x: number; y: number }>();
              const nextByPinId = new Map<string, { x: number; y: number }>();

              for (let index = 0; index < pinRows.length; index += 1) {
                const pin = pinRows[index];
                const world = worlds[index];
                if (!pin || !world) {
                  continue;
                }
                oldByPinId.set(pin.id, { x: pin.worldXNm, y: pin.worldYNm });
                nextByPinId.set(pin.id, { x: world.x, y: world.y });
                tx.update(schematicPins)
                  .set({
                    worldXNm: world.x,
                    worldYNm: world.y,
                    updatedAt: timestamp,
                  })
                  .where(eq(schematicPins.id, pin.id))
                  .run();
              }

              updateConnectedWireGeometry({
                tx,
                designId,
                movedPinIds: [...oldByPinId.keys()],
                oldByPinId,
                nextByPinId,
                timestamp,
              });

              const nextRevision = head.revision + 1;
              tx.update(designHeads)
                .set({
                  revision: nextRevision,
                  updatedAt: timestamp,
                })
                .where(eq(designHeads.id, designId))
                .run();

              result = okResult(nextRevision, command.partId);
            }
          } else if (command.type === "delete_entity") {
            if (command.entityKind === "part") {
              const part = tx
                .select({ id: schematicParts.id })
                .from(schematicParts)
                .where(
                  and(
                    eq(schematicParts.designId, designId),
                    eq(schematicParts.id, command.entityId),
                  ),
                )
                .get();
              if (!part) {
                result = entityNotFound(command.entityId, "part");
              } else {
                const pinRows = tx
                  .select({ id: schematicPins.id })
                  .from(schematicPins)
                  .where(eq(schematicPins.partId, command.entityId))
                  .all();
                const pinIds = pinRows.map((pin) => pin.id);
                if (pinIds.length > 0) {
                  tx.delete(schematicWires)
                    .where(
                      and(
                        eq(schematicWires.designId, designId),
                        or(
                          inArray(schematicWires.sourcePinId, pinIds),
                          inArray(schematicWires.targetPinId, pinIds),
                        ),
                      ),
                    )
                    .run();
                }

                tx.delete(schematicPins)
                  .where(eq(schematicPins.partId, command.entityId))
                  .run();
                tx.delete(schematicParts)
                  .where(eq(schematicParts.id, command.entityId))
                  .run();

                const nextRevision = head.revision + 1;
                tx.update(designHeads)
                  .set({
                    revision: nextRevision,
                    updatedAt: timestamp,
                  })
                  .where(eq(designHeads.id, designId))
                  .run();

                result = okResult(nextRevision, command.entityId);
              }
            } else if (command.entityKind === "wire") {
              const wire = tx
                .select({ id: schematicWires.id })
                .from(schematicWires)
                .where(
                  and(
                    eq(schematicWires.designId, designId),
                    eq(schematicWires.id, command.entityId),
                  ),
                )
                .get();
              if (!wire) {
                result = entityNotFound(command.entityId, "wire");
              } else {
                tx.delete(schematicWires)
                  .where(eq(schematicWires.id, command.entityId))
                  .run();

                const nextRevision = head.revision + 1;
                tx.update(designHeads)
                  .set({
                    revision: nextRevision,
                    updatedAt: timestamp,
                  })
                  .where(eq(designHeads.id, designId))
                  .run();

                result = okResult(nextRevision, command.entityId);
              }
            } else {
              const label = tx
                .select({ id: schematicLabels.id })
                .from(schematicLabels)
                .where(
                  and(
                    eq(schematicLabels.designId, designId),
                    eq(schematicLabels.id, command.entityId),
                  ),
                )
                .get();
              if (!label) {
                result = entityNotFound(command.entityId, "label");
              } else {
                tx.delete(schematicLabels)
                  .where(eq(schematicLabels.id, command.entityId))
                  .run();

                const nextRevision = head.revision + 1;
                tx.update(designHeads)
                  .set({
                    revision: nextRevision,
                    updatedAt: timestamp,
                  })
                  .where(eq(designHeads.id, designId))
                  .run();

                result = okResult(nextRevision, command.entityId);
              }
            }
          } else {
            const text = command.text.trim();
            if (text.length === 0) {
              result = invalidLabel("label text must not be empty");
            } else if (command.labelId) {
              const label = tx
                .select({ id: schematicLabels.id })
                .from(schematicLabels)
                .where(
                  and(
                    eq(schematicLabels.designId, designId),
                    eq(schematicLabels.id, command.labelId),
                  ),
                )
                .get();
              if (!label) {
                result = entityNotFound(command.labelId, "label");
              } else {
                tx.update(schematicLabels)
                  .set({
                    text,
                    xNm: command.positionNm.x,
                    yNm: command.positionNm.y,
                    updatedAt: timestamp,
                  })
                  .where(eq(schematicLabels.id, command.labelId))
                  .run();

                const nextRevision = head.revision + 1;
                tx.update(designHeads)
                  .set({
                    revision: nextRevision,
                    updatedAt: timestamp,
                  })
                  .where(eq(designHeads.id, designId))
                  .run();

                result = okResult(nextRevision, command.labelId);
              }
            } else {
              const payload: PersistedLabelPayload = {
                id: crypto.randomUUID(),
                text,
                positionNm: command.positionNm,
              };

              tx.insert(schematicLabels)
                .values({
                  id: payload.id,
                  designId,
                  text: payload.text,
                  xNm: payload.positionNm.x,
                  yNm: payload.positionNm.y,
                  createdAt: timestamp,
                  updatedAt: timestamp,
                })
                .run();

              const nextRevision = head.revision + 1;
              tx.update(designHeads)
                .set({
                  revision: nextRevision,
                  updatedAt: timestamp,
                })
                .where(eq(designHeads.id, designId))
                .run();

              result = okResult(nextRevision, payload.id);
            }
          }

          tx.insert(commandLog)
            .values({
              commandId: envelope.commandId,
              designId,
              sessionId: envelope.sessionId,
              commandType: command.type,
              commandJson: JSON.stringify(command),
              resultJson: JSON.stringify(result),
              issuedAt: Math.trunc(envelope.issuedAt),
              appliedRevision: result.ok ? result.revision : head.revision,
              createdAt: timestamp,
            })
            .run();

          return result;
        });

        return result;
      } catch {
        const racedLog = db
          .select()
          .from(commandLog)
          .where(eq(commandLog.commandId, envelope.commandId))
          .get();
        if (racedLog) {
          const racedResult = parseDispatchResultJson(racedLog.resultJson);
          if (racedResult) {
            if (racedResult.ok) {
              return {
                ...racedResult,
                idempotent: true,
              };
            }
            return racedResult;
          }
        }

        return conflict(envelope.baseRevision, -1);
      }
    },
  };
}
