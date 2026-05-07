import { and, eq, inArray, or } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type {
  DesignerCommand,
  DesignerDispatchResult,
  DesignerPin,
  DesignerPrimitive,
  DesignerSchematicProjection,
  LibraryComponentPlacementDetail,
} from "../../../sdks";
import {
  insertPrimitiveRow,
  isPrimitivePinId,
  loadPrimitiveById,
  primitiveAsPin,
  primitiveIdFromPinId,
  primitivePinId,
  serializePrimitivePayload,
} from "./primitive-store";
import { buildCreateWirePayload } from "./commands/create-wire";
import {
  buildPlacePartPayload,
  normalizeRotationDeg,
  recomputePinWorldPositions,
} from "./commands/place-part";
import type {
  PersistedLabelPayload,
  PersistedPartPayload,
  PersistedWirePayload,
} from "./payload-types";
import {
  componentNotFound,
  entityNotFound,
  invalidLabel,
  invalidPcbBoardSettings,
  invalidPcbTrace,
  invalidPcbVia,
  invalidPrimitive,
  invalidWirePath,
  okResult,
  pcbNetClassNotFound,
  pcbPlacementNotFound,
  pcbTraceNotFound,
  pcbViaNotFound,
  pinNotFound,
  primitiveNotFound,
} from "./results";
import {
  designHeads,
  schematicLabels,
  schematicParts,
  schematicPins,
  schematicPrimitives,
  schematicWires,
} from "./schema";
import {
  deletePcbTrace,
  deletePcbVia,
  ensurePcbBoardSettings,
  insertPcbTrace,
  insertPcbVia,
  loadPcbTraceById,
  loadPcbViaById,
  movePcbPlacement,
  rotatePcbPlacement,
  updatePcbActiveLayer,
  updatePcbBoardSize,
  updatePcbTrace,
} from "./pcb/pcb-store";
import {
  validatePath as validateTracePath,
  sanitizePath as sanitizeTracePath,
} from "./pcb/pcb-trace-geometry";
import type { PcbNetClass, PcbTrace, PcbVia } from "../../../sdks";
import {
  insertVertexOnWire,
  parseWirePointsJson,
  sanitizePath,
  updateConnectedWireGeometry,
} from "./wire-geometry";

type DbClient = BunSQLiteDatabase<Record<string, unknown>>;
type PinRow = typeof schematicPins.$inferSelect;

export interface ExecuteDesignerCommandParams {
  tx: DbClient;
  designId: string;
  revision: number;
  command: DesignerCommand;
  projection: DesignerSchematicProjection;
  timestamp: string;
  placeComponentDetail: LibraryComponentPlacementDetail | null;
}

function isFinitePoint(point: { x: number; y: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function mapPinRow(row: PinRow): DesignerPin {
  return {
    id: row.id,
    originPinKey: row.originPinKey,
    number: row.number,
    name: row.name,
    electricalType: row.electricalType,
    unit: row.unit,
    localPositionNm: { x: row.localXNm, y: row.localYNm },
    worldPositionNm: { x: row.worldXNm, y: row.worldYNm },
  };
}

// Resolves a pin id that may reference either a real part pin
// (`schematicPins.id`) or a synthetic primitive pin (`primitive:<id>`).
function resolvePinAny(
  tx: DbClient,
  designId: string,
  pinId: string,
): DesignerPin | null {
  if (isPrimitivePinId(pinId)) {
    const primitive = loadPrimitiveById(
      tx,
      designId,
      primitiveIdFromPinId(pinId),
    );
    return primitive ? primitiveAsPin(primitive) : null;
  }
  const row = tx
    .select()
    .from(schematicPins)
    .where(
      and(eq(schematicPins.designId, designId), eq(schematicPins.id, pinId)),
    )
    .get();
  return row ? mapPinRow(row) : null;
}

function bumpRevision(
  tx: DbClient,
  designId: string,
  revision: number,
  timestamp: string,
): number {
  const nextRevision = revision + 1;
  tx.update(designHeads)
    .set({ revision: nextRevision, updatedAt: timestamp })
    .where(eq(designHeads.id, designId))
    .run();
  return nextRevision;
}

function insertPart(
  tx: DbClient,
  designId: string,
  payload: PersistedPartPayload,
  timestamp: string,
): void {
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
}

function insertWire(
  tx: DbClient,
  designId: string,
  payload: PersistedWirePayload,
  timestamp: string,
): void {
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
}

function pathLength(points: Array<{ x: number; y: number }>): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const curr = points[index];
    if (prev && curr)
      total += Math.abs(curr.x - prev.x) + Math.abs(curr.y - prev.y);
  }
  return total;
}

function updatePartPinsAndConnectedWires(params: {
  tx: DbClient;
  designId: string;
  partId: string;
  positionNm: { x: number; y: number };
  rotationDeg: number;
  mirrored: boolean;
  timestamp: string;
}): void {
  const { tx, designId, partId, positionNm, rotationDeg, mirrored, timestamp } =
    params;
  const pinRows = tx
    .select()
    .from(schematicPins)
    .where(eq(schematicPins.partId, partId))
    .all();
  const worlds = recomputePinWorldPositions(
    pinRows.map((pin) => ({
      localPositionNm: { x: pin.localXNm, y: pin.localYNm },
    })),
    positionNm,
    normalizeRotationDeg(rotationDeg),
    mirrored,
  );
  const nextByPinId = new Map<string, { x: number; y: number }>();
  for (let index = 0; index < pinRows.length; index += 1) {
    const pin = pinRows[index];
    const world = worlds[index];
    if (!pin || !world) continue;
    nextByPinId.set(pin.id, { x: world.x, y: world.y });
    tx.update(schematicPins)
      .set({ worldXNm: world.x, worldYNm: world.y, updatedAt: timestamp })
      .where(eq(schematicPins.id, pin.id))
      .run();
  }
  updateConnectedWireGeometry({
    tx,
    designId,
    movedPinIds: [...nextByPinId.keys()],
    nextByPinId,
    timestamp,
  });
}

export function executeDesignerCommand({
  tx,
  designId,
  revision,
  command,
  projection,
  timestamp,
  placeComponentDetail,
}: ExecuteDesignerCommandParams): DesignerDispatchResult {
  if (command.type === "pcb_set_board_settings") {
    if (command.widthMm <= 0 || command.heightMm <= 0) {
      return invalidPcbBoardSettings("board width and height must be positive");
    }
    if (command.widthMm > 2000 || command.heightMm > 2000) {
      return invalidPcbBoardSettings(
        "board width and height must be <= 2000mm",
      );
    }
    updatePcbBoardSize({
      db: tx,
      designId,
      widthMm: command.widthMm,
      heightMm: command.heightMm,
      timestamp,
    });
    return okResult(bumpRevision(tx, designId, revision, timestamp), null);
  }

  if (command.type === "pcb_move_placement") {
    const moved = movePcbPlacement({
      db: tx,
      designId,
      placementId: command.placementId,
      positionMm: command.positionMm,
      timestamp,
    });
    if (!moved) return pcbPlacementNotFound(command.placementId);
    return okResult(bumpRevision(tx, designId, revision, timestamp), null);
  }

  if (command.type === "pcb_rotate_placement") {
    const rotated = rotatePcbPlacement({
      db: tx,
      designId,
      placementId: command.placementId,
      rotationDeg: command.rotationDeg,
      timestamp,
    });
    if (!rotated) return pcbPlacementNotFound(command.placementId);
    return okResult(bumpRevision(tx, designId, revision, timestamp), null);
  }

  if (command.type === "pcb_set_active_layer") {
    updatePcbActiveLayer({
      db: tx,
      designId,
      layer: command.layer,
      timestamp,
    });
    return okResult(bumpRevision(tx, designId, revision, timestamp), null);
  }

  if (command.type === "pcb_add_trace") {
    const board = ensurePcbBoardSettings(tx, designId, timestamp);
    const netClass = board.netClasses.find(
      (nc) => nc.id === command.netClassId,
    );
    if (!netClass) return pcbNetClassNotFound(command.netClassId);
    const sanitized = sanitizeTracePath(command.pointsNm);
    if (sanitized.length < 2) {
      return invalidPcbTrace("path must have at least 2 distinct points");
    }
    const reason = validateTracePath(sanitized, command.segmentMode);
    if (reason) return invalidPcbTrace(reason);
    const trace: PcbTrace = {
      id: crypto.randomUUID(),
      netId: command.netId,
      netClassId: command.netClassId,
      layer: command.layer,
      widthMm: command.widthMm,
      pointsNm: sanitized,
      segmentMode: command.segmentMode,
    };
    insertPcbTrace(tx, designId, trace, timestamp);
    return okResult(bumpRevision(tx, designId, revision, timestamp), trace.id);
  }

  if (command.type === "pcb_add_via") {
    const board = ensurePcbBoardSettings(tx, designId, timestamp);
    const netClass = board.netClasses.find(
      (nc) => nc.id === command.netClassId,
    );
    if (!netClass) return pcbNetClassNotFound(command.netClassId);
    if (netClass.viaDiameterMm <= netClass.viaDrillMm) {
      return invalidPcbVia("net class viaDiameterMm must exceed viaDrillMm");
    }
    const via: PcbVia = {
      id: crypto.randomUUID(),
      netId: command.netId,
      netClassId: command.netClassId,
      centerMm: command.centerMm,
      diameterMm: netClass.viaDiameterMm,
      drillMm: netClass.viaDrillMm,
      fromLayer: "F.Cu",
      toLayer: "B.Cu",
    };
    insertPcbVia(tx, designId, via, timestamp);
    return okResult(bumpRevision(tx, designId, revision, timestamp), via.id);
  }

  if (command.type === "pcb_delete_trace") {
    const existing = loadPcbTraceById(tx, designId, command.traceId);
    if (!existing) return pcbTraceNotFound(command.traceId);
    deletePcbTrace(tx, command.traceId);
    return okResult(bumpRevision(tx, designId, revision, timestamp), null);
  }

  if (command.type === "pcb_delete_via") {
    const existing = loadPcbViaById(tx, designId, command.viaId);
    if (!existing) return pcbViaNotFound(command.viaId);
    deletePcbVia(tx, command.viaId);
    return okResult(bumpRevision(tx, designId, revision, timestamp), null);
  }

  if (command.type === "pcb_update_trace_geometry") {
    const existing = loadPcbTraceById(tx, designId, command.traceId);
    if (!existing) return pcbTraceNotFound(command.traceId);
    const sanitized = sanitizeTracePath(command.pointsNm);
    if (sanitized.length < 2) {
      return invalidPcbTrace("path must have at least 2 distinct points");
    }
    const reason = validateTracePath(sanitized, existing.segmentMode);
    if (reason) return invalidPcbTrace(reason);
    updatePcbTrace(tx, { ...existing, pointsNm: sanitized }, timestamp);
    return okResult(bumpRevision(tx, designId, revision, timestamp), null);
  }

  if (command.type === "place_part") {
    if (!placeComponentDetail) return componentNotFound(command.componentId);
    const payload = buildPlacePartPayload(
      placeComponentDetail,
      command.positionNm,
      command.rotationDeg ?? 0,
      command.mirrored ?? false,
      projection.parts,
    );
    insertPart(tx, designId, payload, timestamp);
    return okResult(
      bumpRevision(tx, designId, revision, timestamp),
      payload.id,
    );
  }

  if (command.type === "place_gnd_port") {
    if (!isFinitePoint(command.positionNm)) {
      return invalidPrimitive("GND port position must be finite numbers");
    }
    const primitive: DesignerPrimitive = {
      id: crypto.randomUUID(),
      kind: "gnd",
      positionNm: command.positionNm,
      rotationDeg: normalizeRotationDeg(command.rotationDeg ?? 0),
    };
    insertPrimitiveRow(tx, designId, primitive, timestamp);
    return okResult(
      bumpRevision(tx, designId, revision, timestamp),
      primitive.id,
    );
  }

  if (command.type === "place_pwr_port") {
    if (!isFinitePoint(command.positionNm)) {
      return invalidPrimitive("PWR port position must be finite numbers");
    }
    const railText = command.railText.trim();
    if (railText.length === 0) {
      return invalidPrimitive("PWR port requires a rail name");
    }
    const primitive: DesignerPrimitive = {
      id: crypto.randomUUID(),
      kind: "pwr",
      positionNm: command.positionNm,
      rotationDeg: normalizeRotationDeg(command.rotationDeg ?? 0),
      railText,
    };
    insertPrimitiveRow(tx, designId, primitive, timestamp);
    return okResult(
      bumpRevision(tx, designId, revision, timestamp),
      primitive.id,
    );
  }

  if (command.type === "place_net_portal") {
    if (!isFinitePoint(command.positionNm)) {
      return invalidPrimitive("Net portal position must be finite numbers");
    }
    const portalText = command.portalText.trim();
    if (portalText.length === 0) {
      return invalidPrimitive("Net portal requires a name");
    }
    const primitive: DesignerPrimitive = {
      id: crypto.randomUUID(),
      kind: "net_portal",
      positionNm: command.positionNm,
      rotationDeg: normalizeRotationDeg(command.rotationDeg ?? 0),
      portalText,
    };
    insertPrimitiveRow(tx, designId, primitive, timestamp);
    return okResult(
      bumpRevision(tx, designId, revision, timestamp),
      primitive.id,
    );
  }

  if (command.type === "move_primitive") {
    if (!isFinitePoint(command.positionNm)) {
      return invalidPrimitive("Primitive position must be finite numbers");
    }
    const existing = loadPrimitiveById(tx, designId, command.primitiveId);
    if (!existing) return primitiveNotFound(command.primitiveId);
    tx.update(schematicPrimitives)
      .set({
        positionXNm: command.positionNm.x,
        positionYNm: command.positionNm.y,
        updatedAt: timestamp,
      })
      .where(eq(schematicPrimitives.id, command.primitiveId))
      .run();
    const synthPinId = primitivePinId(command.primitiveId);
    const nextByPinId = new Map<string, { x: number; y: number }>();
    nextByPinId.set(synthPinId, { ...command.positionNm });
    updateConnectedWireGeometry({
      tx,
      designId,
      movedPinIds: [synthPinId],
      nextByPinId,
      timestamp,
    });
    return okResult(
      bumpRevision(tx, designId, revision, timestamp),
      command.primitiveId,
    );
  }

  if (command.type === "rotate_primitive") {
    const existing = loadPrimitiveById(tx, designId, command.primitiveId);
    if (!existing) return primitiveNotFound(command.primitiveId);
    tx.update(schematicPrimitives)
      .set({
        rotationDeg: normalizeRotationDeg(command.rotationDeg),
        updatedAt: timestamp,
      })
      .where(eq(schematicPrimitives.id, command.primitiveId))
      .run();
    return okResult(
      bumpRevision(tx, designId, revision, timestamp),
      command.primitiveId,
    );
  }

  if (command.type === "update_primitive_text") {
    const existing = loadPrimitiveById(tx, designId, command.primitiveId);
    if (!existing) return primitiveNotFound(command.primitiveId);
    if (existing.kind === "gnd") {
      return invalidPrimitive("GND ports do not have editable text");
    }
    const text = command.text.trim();
    if (text.length === 0) {
      return invalidPrimitive("Primitive text must not be empty");
    }
    const updated: DesignerPrimitive =
      existing.kind === "pwr"
        ? { ...existing, railText: text }
        : { ...existing, portalText: text };
    tx.update(schematicPrimitives)
      .set({
        payloadJson: serializePrimitivePayload(updated),
        updatedAt: timestamp,
      })
      .where(eq(schematicPrimitives.id, command.primitiveId))
      .run();
    return okResult(
      bumpRevision(tx, designId, revision, timestamp),
      command.primitiveId,
    );
  }

  if (command.type === "create_wire") {
    const sourcePin = resolvePinAny(tx, designId, command.sourcePinId);
    if (!sourcePin) return pinNotFound(command.sourcePinId);
    const targetPin = resolvePinAny(tx, designId, command.targetPinId);
    if (!targetPin) return pinNotFound(command.targetPinId);
    const built = buildCreateWirePayload(
      sourcePin,
      targetPin,
      command.pointsNm,
    );
    if (!built.payload)
      return invalidWirePath(built.invalidReason ?? "wire path is invalid");
    insertWire(tx, designId, built.payload, timestamp);
    return okResult(
      bumpRevision(tx, designId, revision, timestamp),
      built.payload.id,
    );
  }

  if (command.type === "create_wire_junction") {
    const sourcePin = resolvePinAny(tx, designId, command.sourcePinId);
    if (!sourcePin) return pinNotFound(command.sourcePinId);
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
    if (!wireRow) return entityNotFound(command.wireId, "wire");

    const wirePoints = parseWirePointsJson(wireRow.pointsJson);
    const insertion = insertVertexOnWire(wirePoints, command.targetPointNm);
    if (!insertion)
      return invalidWirePath("target wire has no routable segments");
    const junctionPoint = insertion.points[insertion.insertIndex];
    if (!junctionPoint) return invalidWirePath("junction insertion failed");

    const endpointSourcePin = resolvePinAny(tx, designId, wireRow.sourcePinId);
    const endpointTargetPin = resolvePinAny(tx, designId, wireRow.targetPinId);
    if (!endpointSourcePin) return pinNotFound(wireRow.sourcePinId);
    if (!endpointTargetPin) return pinNotFound(wireRow.targetPinId);

    const pseudoJunctionPin: DesignerPin = {
      id: `junction:${wireRow.id}`,
      originPinKey: `junction:${wireRow.id}`,
      number: null,
      name: "junction",
      electricalType: "passive",
      unit: 1,
      localPositionNm: { x: junctionPoint.x, y: junctionPoint.y },
      worldPositionNm: { x: junctionPoint.x, y: junctionPoint.y },
    };
    const toJunctionBuild = buildCreateWirePayload(
      sourcePin,
      pseudoJunctionPin,
      command.pointsNm,
    );
    if (!toJunctionBuild.payload)
      return invalidWirePath(
        toJunctionBuild.invalidReason ?? "wire path is invalid",
      );

    const pathToSourceEndpoint = insertion.points
      .slice(0, insertion.insertIndex + 1)
      .reverse();
    const pathToTargetEndpoint = insertion.points.slice(insertion.insertIndex);
    const useSourceEndpoint =
      pathLength(pathToSourceEndpoint) <= pathLength(pathToTargetEndpoint);
    const endpointPath = useSourceEndpoint
      ? pathToSourceEndpoint
      : pathToTargetEndpoint;
    const targetEndpointPin = useSourceEndpoint
      ? endpointSourcePin
      : endpointTargetPin;
    const finalBuild = buildCreateWirePayload(
      sourcePin,
      targetEndpointPin,
      sanitizePath([
        ...toJunctionBuild.payload.pointsNm,
        ...endpointPath.slice(1),
      ]),
    );
    if (!finalBuild.payload)
      return invalidWirePath(
        finalBuild.invalidReason ?? "wire path is invalid",
      );

    tx.update(schematicWires)
      .set({
        pointsJson: JSON.stringify(insertion.points),
        updatedAt: timestamp,
      })
      .where(eq(schematicWires.id, wireRow.id))
      .run();
    insertWire(tx, designId, finalBuild.payload, timestamp);
    return okResult(
      bumpRevision(tx, designId, revision, timestamp),
      finalBuild.payload.id,
    );
  }

  if (
    command.type === "move_part" ||
    command.type === "rotate_part" ||
    command.type === "mirror_part"
  ) {
    const partId = command.partId;
    const partRow = tx
      .select()
      .from(schematicParts)
      .where(
        and(
          eq(schematicParts.designId, designId),
          eq(schematicParts.id, partId),
        ),
      )
      .get();
    if (!partRow) return entityNotFound(partId, "part");
    const positionNm =
      command.type === "move_part"
        ? command.positionNm
        : { x: partRow.positionXNm, y: partRow.positionYNm };
    const rotationDeg =
      command.type === "rotate_part"
        ? normalizeRotationDeg(command.rotationDeg)
        : normalizeRotationDeg(partRow.rotationDeg);
    const mirrored =
      command.type === "mirror_part"
        ? command.mirrored
        : partRow.mirrored === 1;
    tx.update(schematicParts)
      .set({
        positionXNm: positionNm.x,
        positionYNm: positionNm.y,
        rotationDeg,
        mirrored: mirrored ? 1 : 0,
        updatedAt: timestamp,
      })
      .where(eq(schematicParts.id, partId))
      .run();
    updatePartPinsAndConnectedWires({
      tx,
      designId,
      partId,
      positionNm,
      rotationDeg,
      mirrored,
      timestamp,
    });
    return okResult(bumpRevision(tx, designId, revision, timestamp), partId);
  }

  if (command.type === "delete_entity") {
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
      if (!part) return entityNotFound(command.entityId, "part");
      const pinIds = tx
        .select({ id: schematicPins.id })
        .from(schematicPins)
        .where(eq(schematicPins.partId, command.entityId))
        .all()
        .map((pin) => pin.id);
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
      if (!wire) return entityNotFound(command.entityId, "wire");
      tx.delete(schematicWires)
        .where(eq(schematicWires.id, command.entityId))
        .run();
    } else if (command.entityKind === "primitive") {
      const primitive = tx
        .select({ id: schematicPrimitives.id })
        .from(schematicPrimitives)
        .where(
          and(
            eq(schematicPrimitives.designId, designId),
            eq(schematicPrimitives.id, command.entityId),
          ),
        )
        .get();
      if (!primitive) return entityNotFound(command.entityId, "primitive");
      const synthPinId = primitivePinId(command.entityId);
      tx.delete(schematicWires)
        .where(
          and(
            eq(schematicWires.designId, designId),
            or(
              eq(schematicWires.sourcePinId, synthPinId),
              eq(schematicWires.targetPinId, synthPinId),
            ),
          ),
        )
        .run();
      tx.delete(schematicPrimitives)
        .where(eq(schematicPrimitives.id, command.entityId))
        .run();
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
      if (!label) return entityNotFound(command.entityId, "label");
      tx.delete(schematicLabels)
        .where(eq(schematicLabels.id, command.entityId))
        .run();
    }
    return okResult(
      bumpRevision(tx, designId, revision, timestamp),
      command.entityId,
    );
  }

  const text = command.text.trim();
  if (text.length === 0) return invalidLabel("label text must not be empty");
  if (command.labelId) {
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
    if (!label) return entityNotFound(command.labelId, "label");
    tx.update(schematicLabels)
      .set({
        text,
        xNm: command.positionNm.x,
        yNm: command.positionNm.y,
        updatedAt: timestamp,
      })
      .where(eq(schematicLabels.id, command.labelId))
      .run();
    return okResult(
      bumpRevision(tx, designId, revision, timestamp),
      command.labelId,
    );
  }

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
  return okResult(bumpRevision(tx, designId, revision, timestamp), payload.id);
}
