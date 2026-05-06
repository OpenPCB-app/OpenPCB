import { and, eq, inArray, or } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type {
  DesignerCommand,
  DesignerDispatchResult,
  DesignerPin,
  DesignerSchematicProjection,
  LibraryComponentPlacementDetail,
} from "../../../sdks";
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
  invalidWirePath,
  okResult,
  pcbPlacementNotFound,
  pinNotFound,
} from "./results";
import {
  designHeads,
  schematicLabels,
  schematicParts,
  schematicPins,
  schematicWires,
} from "./schema";
import {
  movePcbPlacement,
  rotatePcbPlacement,
  updatePcbBoardSize,
} from "./pcb/pcb-store";
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

  if (command.type === "create_wire") {
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
    if (!sourcePinRow) return pinNotFound(command.sourcePinId);
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
    if (!targetPinRow) return pinNotFound(command.targetPinId);
    const built = buildCreateWirePayload(
      mapPinRow(sourcePinRow),
      mapPinRow(targetPinRow),
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
    if (!sourcePinRow) return pinNotFound(command.sourcePinId);
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
    if (!endpointSourcePinRow) return pinNotFound(wireRow.sourcePinId);
    if (!endpointTargetPinRow) return pinNotFound(wireRow.targetPinId);

    const sourcePin = mapPinRow(sourcePinRow);
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
      ? mapPinRow(endpointSourcePinRow)
      : mapPinRow(endpointTargetPinRow);
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
