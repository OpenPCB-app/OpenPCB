import type {
  CoreBackendModuleContext,
  ModuleRouterHandle,
} from "../../../core/contracts/modules/backend-module";
import { NotFoundError, ValidationError } from "../../../core/contracts/errors";
import type {
  DesignerCommandEnvelope,
  DesignerCreateWireCommand,
  DesignerCreateWireJunctionCommand,
  DesignerDeleteEntityCommand,
  DesignerMirrorPartCommand,
  DesignerMovePartCommand,
  DesignerMovePrimitiveCommand,
  DesignerPcbAddTraceCommand,
  DesignerPcbAddViaCommand,
  DesignerPcbDeleteTraceCommand,
  DesignerPcbDeleteViaCommand,
  DesignerPcbFlipPlacementCommand,
  DesignerPcbFlipPlacementsCommand,
  DesignerPcbMovePlacementCommand,
  DesignerPcbMovePlacementsCommand,
  DesignerPcbRotatePlacementCommand,
  DesignerPcbSetActiveLayerCommand,
  DesignerPcbSetBoardSettingsCommand,
  DesignerPcbSetVisibleLayersCommand,
  DesignerPcbUpdateTraceGeometryCommand,
  DesignerPlaceGndPortCommand,
  DesignerPlaceNetPortalCommand,
  DesignerPlacePartCommand,
  DesignerPlacePwrPortCommand,
  DesignerRotatePartCommand,
  DesignerRotatePrimitiveCommand,
  DesignerUpdatePartPropertiesCommand,
  DesignerUpdatePartsPropertiesCommand,
  DesignerUpdatePrimitiveTextCommand,
  DesignerUpsertLabelCommand,
  PcbCopperLayerId,
  PcbLayerId,
  PcbTraceSegmentMode,
} from "../../../sdks/designer";
import { createDesignerStore } from "./store";
import { asNumber, asRecord, asString } from "./value-guards";

function success<T>(data: T, status = 200): Response {
  return Response.json({ ok: true, data }, { status });
}

async function parseJsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}

function parsePointNm(value: unknown, field: string): { x: number; y: number } {
  const record = asRecord(value);
  if (!record) {
    throw new ValidationError(`${field} must be an object`);
  }
  const x = asNumber(record.x);
  const y = asNumber(record.y);
  if (x === null || y === null) {
    throw new ValidationError(
      `${field}.x and ${field}.y must be finite numbers`,
    );
  }
  return { x, y };
}

function parseCreateDesignBody(body: unknown): { name?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }

  const name = (body as { name?: unknown }).name;
  if (name === undefined) {
    return {};
  }
  if (typeof name !== "string") {
    throw new ValidationError("name must be a string");
  }
  return { name };
}

function parseHistoryBody(body: unknown): { sessionId: string } {
  const record = asRecord(body);
  if (!record) {
    throw new ValidationError("Request body must be an object");
  }
  const sessionId = asString(record.sessionId);
  if (!sessionId) {
    throw new ValidationError("sessionId must be a string");
  }
  return { sessionId };
}

function parsePlacePartCommand(
  raw: Record<string, unknown>,
): DesignerPlacePartCommand {
  const componentId = asString(raw.componentId);
  if (!componentId) {
    throw new ValidationError("command.componentId must be a string");
  }

  const positionNm = parsePointNm(raw.positionNm, "command.positionNm");
  const rotation = raw.rotationDeg;
  const mirrored = raw.mirrored;
  const rotationDeg = asNumber(rotation);
  if (
    rotation !== undefined &&
    (rotationDeg === null || ![0, 90, 180, 270].includes(rotationDeg))
  ) {
    throw new ValidationError(
      "command.rotationDeg must be one of 0/90/180/270",
    );
  }

  return {
    type: "place_part",
    componentId,
    positionNm,
    rotationDeg: rotationDeg ?? undefined,
    mirrored: mirrored === true,
  };
}

function parseMovePartCommand(
  raw: Record<string, unknown>,
): DesignerMovePartCommand {
  const partId = asString(raw.partId);
  if (!partId) {
    throw new ValidationError("command.partId must be a string");
  }
  return {
    type: "move_part",
    partId,
    positionNm: parsePointNm(raw.positionNm, "command.positionNm"),
  };
}

function parseRotatePartCommand(
  raw: Record<string, unknown>,
): DesignerRotatePartCommand {
  const partId = asString(raw.partId);
  const rotationDeg = asNumber(raw.rotationDeg);
  if (!partId) {
    throw new ValidationError("command.partId must be a string");
  }
  if (rotationDeg === null || ![0, 90, 180, 270].includes(rotationDeg)) {
    throw new ValidationError(
      "command.rotationDeg must be one of 0/90/180/270",
    );
  }

  return {
    type: "rotate_part",
    partId,
    rotationDeg: rotationDeg as 0 | 90 | 180 | 270,
  };
}

function parseMirrorPartCommand(
  raw: Record<string, unknown>,
): DesignerMirrorPartCommand {
  const partId = asString(raw.partId);
  if (!partId) {
    throw new ValidationError("command.partId must be a string");
  }

  return {
    type: "mirror_part",
    partId,
    mirrored: raw.mirrored === true,
  };
}

function parseUpdatePartPropertiesCommand(
  raw: Record<string, unknown>,
): DesignerUpdatePartPropertiesCommand {
  const partId = asString(raw.partId);
  if (!partId) {
    throw new ValidationError("command.partId must be a string");
  }
  if (raw.reference !== undefined && asString(raw.reference) === null) {
    throw new ValidationError("command.reference must be a string");
  }
  if (raw.value !== undefined && asString(raw.value) === null) {
    throw new ValidationError("command.value must be a string");
  }
  if (raw.propertiesJson !== undefined && !asRecord(raw.propertiesJson)) {
    throw new ValidationError("command.propertiesJson must be an object");
  }
  const reference = asString(raw.reference) ?? undefined;
  const value = asString(raw.value) ?? undefined;
  const propertiesJson = asRecord(raw.propertiesJson) ?? undefined;

  return {
    type: "update_part_properties",
    partId,
    ...(reference !== undefined && { reference }),
    ...(value !== undefined && { value }),
    ...(propertiesJson !== undefined && {
      propertiesJson:
        propertiesJson as DesignerUpdatePartPropertiesCommand["propertiesJson"],
    }),
  };
}

function parseUpdatePartsPropertiesCommand(
  raw: Record<string, unknown>,
): DesignerUpdatePartsPropertiesCommand {
  const partIdsRaw = raw.partIds;
  if (
    !Array.isArray(partIdsRaw) ||
    partIdsRaw.length === 0 ||
    partIdsRaw.some((id) => typeof id !== "string")
  ) {
    throw new ValidationError(
      "command.partIds must be a non-empty array of strings",
    );
  }
  if (raw.value !== undefined && asString(raw.value) === null) {
    throw new ValidationError("command.value must be a string");
  }
  if (raw.propertiesJson !== undefined && !asRecord(raw.propertiesJson)) {
    throw new ValidationError("command.propertiesJson must be an object");
  }
  const value = asString(raw.value) ?? undefined;
  const propertiesJson = asRecord(raw.propertiesJson) ?? undefined;

  return {
    type: "update_parts_properties",
    partIds: partIdsRaw,
    ...(value !== undefined && { value }),
    ...(propertiesJson !== undefined && {
      propertiesJson:
        propertiesJson as DesignerUpdatePartsPropertiesCommand["propertiesJson"],
    }),
  };
}

function parseDeleteEntityCommand(
  raw: Record<string, unknown>,
): DesignerDeleteEntityCommand {
  const entityId = asString(raw.entityId);
  const entityKind = asString(raw.entityKind);
  if (!entityId) {
    throw new ValidationError("command.entityId must be a string");
  }
  if (
    entityKind !== "part" &&
    entityKind !== "wire" &&
    entityKind !== "label" &&
    entityKind !== "primitive"
  ) {
    throw new ValidationError(
      "command.entityKind must be one of part/wire/label/primitive",
    );
  }

  return {
    type: "delete_entity",
    entityId,
    entityKind,
  };
}

function parseOptionalRotationDeg(value: unknown): 0 | 90 | 180 | 270 {
  if (value === undefined) return 0;
  const rotationDeg = asNumber(value);
  if (rotationDeg === null || ![0, 90, 180, 270].includes(rotationDeg)) {
    throw new ValidationError(
      "command.rotationDeg must be one of 0/90/180/270",
    );
  }
  return rotationDeg as 0 | 90 | 180 | 270;
}

function parsePlaceGndPortCommand(
  raw: Record<string, unknown>,
): DesignerPlaceGndPortCommand {
  return {
    type: "place_gnd_port",
    positionNm: parsePointNm(raw.positionNm, "command.positionNm"),
    rotationDeg: parseOptionalRotationDeg(raw.rotationDeg),
  };
}

function parsePlacePwrPortCommand(
  raw: Record<string, unknown>,
): DesignerPlacePwrPortCommand {
  const railText = asString(raw.railText);
  if (railText === null) {
    throw new ValidationError("command.railText must be a string");
  }
  return {
    type: "place_pwr_port",
    positionNm: parsePointNm(raw.positionNm, "command.positionNm"),
    rotationDeg: parseOptionalRotationDeg(raw.rotationDeg),
    railText,
  };
}

function parsePlaceNetPortalCommand(
  raw: Record<string, unknown>,
): DesignerPlaceNetPortalCommand {
  const portalText = asString(raw.portalText);
  if (portalText === null) {
    throw new ValidationError("command.portalText must be a string");
  }
  return {
    type: "place_net_portal",
    positionNm: parsePointNm(raw.positionNm, "command.positionNm"),
    rotationDeg: parseOptionalRotationDeg(raw.rotationDeg),
    portalText,
  };
}

function parseMovePrimitiveCommand(
  raw: Record<string, unknown>,
): DesignerMovePrimitiveCommand {
  const primitiveId = asString(raw.primitiveId);
  if (!primitiveId) {
    throw new ValidationError("command.primitiveId must be a string");
  }
  return {
    type: "move_primitive",
    primitiveId,
    positionNm: parsePointNm(raw.positionNm, "command.positionNm"),
  };
}

function parseRotatePrimitiveCommand(
  raw: Record<string, unknown>,
): DesignerRotatePrimitiveCommand {
  const primitiveId = asString(raw.primitiveId);
  if (!primitiveId) {
    throw new ValidationError("command.primitiveId must be a string");
  }
  const rotationDeg = asNumber(raw.rotationDeg);
  if (rotationDeg === null || ![0, 90, 180, 270].includes(rotationDeg)) {
    throw new ValidationError(
      "command.rotationDeg must be one of 0/90/180/270",
    );
  }
  return {
    type: "rotate_primitive",
    primitiveId,
    rotationDeg: rotationDeg as 0 | 90 | 180 | 270,
  };
}

function parseUpdatePrimitiveTextCommand(
  raw: Record<string, unknown>,
): DesignerUpdatePrimitiveTextCommand {
  const primitiveId = asString(raw.primitiveId);
  const text = asString(raw.text);
  if (!primitiveId) {
    throw new ValidationError("command.primitiveId must be a string");
  }
  if (text === null) {
    throw new ValidationError("command.text must be a string");
  }
  return { type: "update_primitive_text", primitiveId, text };
}

function parseUpsertLabelCommand(
  raw: Record<string, unknown>,
): DesignerUpsertLabelCommand {
  const labelIdValue = raw.labelId;
  if (
    labelIdValue !== undefined &&
    labelIdValue !== null &&
    typeof labelIdValue !== "string"
  ) {
    throw new ValidationError("command.labelId must be a string when provided");
  }
  const text = asString(raw.text);
  if (text === null) {
    throw new ValidationError("command.text must be a string");
  }
  return {
    type: "upsert_label",
    labelId: typeof labelIdValue === "string" ? labelIdValue : undefined,
    text,
    positionNm: parsePointNm(raw.positionNm, "command.positionNm"),
  };
}

function parsePcbSetBoardSettingsCommand(
  raw: Record<string, unknown>,
): DesignerPcbSetBoardSettingsCommand {
  const widthMm = asNumber(raw.widthMm);
  const heightMm = asNumber(raw.heightMm);
  if (widthMm === null || heightMm === null) {
    throw new ValidationError(
      "command.widthMm and command.heightMm must be finite numbers",
    );
  }
  if (widthMm <= 0 || heightMm <= 0) {
    throw new ValidationError(
      "command.widthMm and command.heightMm must be positive",
    );
  }
  return { type: "pcb_set_board_settings", widthMm, heightMm };
}

function parsePointMm(value: unknown, field: string): { x: number; y: number } {
  const record = asRecord(value);
  if (!record) {
    throw new ValidationError(`${field} must be an object`);
  }
  const x = asNumber(record.x);
  const y = asNumber(record.y);
  if (x === null || y === null) {
    throw new ValidationError(
      `${field}.x and ${field}.y must be finite numbers`,
    );
  }
  return { x, y };
}

function parsePcbMovePlacementCommand(
  raw: Record<string, unknown>,
): DesignerPcbMovePlacementCommand {
  const placementId = asString(raw.placementId);
  if (!placementId) {
    throw new ValidationError("command.placementId must be a string");
  }
  return {
    type: "pcb_move_placement",
    placementId,
    positionMm: parsePointMm(raw.positionMm, "command.positionMm"),
  };
}

function parsePcbMovePlacementsCommand(
  raw: Record<string, unknown>,
): DesignerPcbMovePlacementsCommand {
  const updatesRaw = raw.updates;
  if (!Array.isArray(updatesRaw)) {
    throw new ValidationError("command.updates must be an array");
  }
  const updates = updatesRaw.map((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      throw new ValidationError(`command.updates[${index}] must be an object`);
    }
    const placementId = asString(record.placementId);
    if (!placementId) {
      throw new ValidationError(
        `command.updates[${index}].placementId must be a string`,
      );
    }
    return {
      placementId,
      positionMm: parsePointMm(
        record.positionMm,
        `command.updates[${index}].positionMm`,
      ),
    };
  });
  if (updates.length === 0) {
    throw new ValidationError("command.updates must have at least 1 entry");
  }
  return { type: "pcb_move_placements", updates };
}

function parsePcbRotatePlacementCommand(
  raw: Record<string, unknown>,
): DesignerPcbRotatePlacementCommand {
  const placementId = asString(raw.placementId);
  const rotationDeg = asNumber(raw.rotationDeg);
  if (!placementId) {
    throw new ValidationError("command.placementId must be a string");
  }
  if (rotationDeg === null || ![0, 90, 180, 270].includes(rotationDeg)) {
    throw new ValidationError(
      "command.rotationDeg must be one of 0/90/180/270",
    );
  }
  return {
    type: "pcb_rotate_placement",
    placementId,
    rotationDeg: rotationDeg as 0 | 90 | 180 | 270,
  };
}

const PCB_LAYER_VALUES = new Set<string>([
  "F.Cu",
  "B.Cu",
  "F.SilkS",
  "B.SilkS",
  "Edge.Cuts",
]);

function parsePcbSetActiveLayerCommand(
  raw: Record<string, unknown>,
): DesignerPcbSetActiveLayerCommand {
  const layer = asString(raw.layer);
  if (!layer || !PCB_LAYER_VALUES.has(layer)) {
    throw new ValidationError(
      "command.layer must be one of F.Cu / B.Cu / F.SilkS / B.SilkS / Edge.Cuts",
    );
  }
  return {
    type: "pcb_set_active_layer",
    layer: layer as DesignerPcbSetActiveLayerCommand["layer"],
  };
}

function parsePcbSetVisibleLayersCommand(
  raw: Record<string, unknown>,
): DesignerPcbSetVisibleLayersCommand {
  const layersRaw = raw.visibleLayers;
  if (!Array.isArray(layersRaw)) {
    throw new ValidationError("command.visibleLayers must be an array");
  }
  const visibleLayers: PcbLayerId[] = [];
  for (let i = 0; i < layersRaw.length; i++) {
    const layer = asString(layersRaw[i]);
    if (!layer || !PCB_LAYER_VALUES.has(layer)) {
      throw new ValidationError(
        `command.visibleLayers[${i}] must be a valid PcbLayerId`,
      );
    }
    visibleLayers.push(layer as PcbLayerId);
  }
  return { type: "pcb_set_visible_layers", visibleLayers };
}

function parsePcbFlipPlacementCommand(
  raw: Record<string, unknown>,
): DesignerPcbFlipPlacementCommand {
  const placementId = asString(raw.placementId);
  if (!placementId) {
    throw new ValidationError("command.placementId must be a string");
  }
  return { type: "pcb_flip_placement", placementId };
}

function parsePcbFlipPlacementsCommand(
  raw: Record<string, unknown>,
): DesignerPcbFlipPlacementsCommand {
  const idsRaw = raw.placementIds;
  if (!Array.isArray(idsRaw)) {
    throw new ValidationError("command.placementIds must be an array");
  }
  const placementIds: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < idsRaw.length; i++) {
    const placementId = asString(idsRaw[i]);
    if (!placementId) {
      throw new ValidationError(`command.placementIds[${i}] must be a string`);
    }
    if (!seen.has(placementId)) {
      seen.add(placementId);
      placementIds.push(placementId);
    }
  }
  if (placementIds.length === 0) {
    throw new ValidationError(
      "command.placementIds must have at least 1 entry",
    );
  }
  return { type: "pcb_flip_placements", placementIds };
}

function parseCreateWireCommand(
  raw: Record<string, unknown>,
): DesignerCreateWireCommand {
  const sourcePinId = asString(raw.sourcePinId);
  const targetPinId = asString(raw.targetPinId);
  if (!sourcePinId || !targetPinId) {
    throw new ValidationError(
      "command.sourcePinId and command.targetPinId must be strings",
    );
  }

  const pointsRaw = Array.isArray(raw.pointsNm) ? raw.pointsNm : [];
  const pointsNm = pointsRaw.map((point, index) =>
    parsePointNm(point, `command.pointsNm[${index}]`),
  );

  return {
    type: "create_wire",
    sourcePinId,
    targetPinId,
    pointsNm: pointsNm.length > 0 ? pointsNm : undefined,
  };
}

function parseCreateWireJunctionCommand(
  raw: Record<string, unknown>,
): DesignerCreateWireJunctionCommand {
  const sourcePinId = asString(raw.sourcePinId);
  const wireId = asString(raw.wireId);
  if (!sourcePinId || !wireId) {
    throw new ValidationError(
      "command.sourcePinId and command.wireId must be strings",
    );
  }

  const targetPointNm = parsePointNm(
    raw.targetPointNm,
    "command.targetPointNm",
  );
  const pointsRaw = Array.isArray(raw.pointsNm) ? raw.pointsNm : [];
  const pointsNm = pointsRaw.map((point, index) =>
    parsePointNm(point, `command.pointsNm[${index}]`),
  );

  return {
    type: "create_wire_junction",
    sourcePinId,
    wireId,
    targetPointNm,
    pointsNm: pointsNm.length > 0 ? pointsNm : undefined,
  };
}

const PCB_COPPER_LAYERS = new Set<string>(["F.Cu", "B.Cu"]);
const PCB_TRACE_SEGMENT_MODES = new Set<string>([
  "manhattan-90",
  "manhattan-45",
]);

function parsePcbAddTraceCommand(
  raw: Record<string, unknown>,
): DesignerPcbAddTraceCommand {
  const layer = asString(raw.layer);
  if (!layer || !PCB_COPPER_LAYERS.has(layer)) {
    throw new ValidationError("command.layer must be 'F.Cu' or 'B.Cu'");
  }
  const widthMm = asNumber(raw.widthMm);
  if (widthMm === null || widthMm <= 0) {
    throw new ValidationError("command.widthMm must be a positive number");
  }
  const netClassId = asString(raw.netClassId);
  if (!netClassId) {
    throw new ValidationError("command.netClassId must be a string");
  }
  const segmentMode = asString(raw.segmentMode);
  if (!segmentMode || !PCB_TRACE_SEGMENT_MODES.has(segmentMode)) {
    throw new ValidationError(
      "command.segmentMode must be 'manhattan-90' or 'manhattan-45'",
    );
  }
  if (!Array.isArray(raw.pointsNm) || raw.pointsNm.length < 2) {
    throw new ValidationError("command.pointsNm must have at least 2 points");
  }
  const pointsNm = raw.pointsNm.map((point, i) =>
    parsePointNm(point, `command.pointsNm[${i}]`),
  );
  const netIdRaw = raw.netId;
  const netId =
    netIdRaw === null || netIdRaw === undefined ? null : asString(netIdRaw);
  if (netIdRaw !== null && netIdRaw !== undefined && netId === null) {
    throw new ValidationError("command.netId must be a string or null");
  }
  return {
    type: "pcb_add_trace",
    layer: layer as PcbCopperLayerId,
    pointsNm,
    widthMm,
    netId,
    netClassId,
    segmentMode: segmentMode as PcbTraceSegmentMode,
  };
}

function parsePcbAddViaCommand(
  raw: Record<string, unknown>,
): DesignerPcbAddViaCommand {
  const netClassId = asString(raw.netClassId);
  if (!netClassId) {
    throw new ValidationError("command.netClassId must be a string");
  }
  const netIdRaw = raw.netId;
  const netId =
    netIdRaw === null || netIdRaw === undefined ? null : asString(netIdRaw);
  if (netIdRaw !== null && netIdRaw !== undefined && netId === null) {
    throw new ValidationError("command.netId must be a string or null");
  }
  const diameterRaw = raw.diameterMmOverride;
  let diameterMmOverride: number | undefined;
  if (diameterRaw !== undefined && diameterRaw !== null) {
    const value = asNumber(diameterRaw);
    if (value === null || value <= 0) {
      throw new ValidationError(
        "command.diameterMmOverride must be a positive number",
      );
    }
    diameterMmOverride = value;
  }
  const drillRaw = raw.drillMmOverride;
  let drillMmOverride: number | undefined;
  if (drillRaw !== undefined && drillRaw !== null) {
    const value = asNumber(drillRaw);
    if (value === null || value <= 0) {
      throw new ValidationError(
        "command.drillMmOverride must be a positive number",
      );
    }
    drillMmOverride = value;
  }
  return {
    type: "pcb_add_via",
    centerMm: parsePointMm(raw.centerMm, "command.centerMm"),
    netId,
    netClassId,
    ...(diameterMmOverride !== undefined ? { diameterMmOverride } : {}),
    ...(drillMmOverride !== undefined ? { drillMmOverride } : {}),
  };
}

function parsePcbDeleteTraceCommand(
  raw: Record<string, unknown>,
): DesignerPcbDeleteTraceCommand {
  const traceId = asString(raw.traceId);
  if (!traceId) {
    throw new ValidationError("command.traceId must be a string");
  }
  return { type: "pcb_delete_trace", traceId };
}

function parsePcbDeleteViaCommand(
  raw: Record<string, unknown>,
): DesignerPcbDeleteViaCommand {
  const viaId = asString(raw.viaId);
  if (!viaId) {
    throw new ValidationError("command.viaId must be a string");
  }
  return { type: "pcb_delete_via", viaId };
}

function parsePcbUpdateTraceGeometryCommand(
  raw: Record<string, unknown>,
): DesignerPcbUpdateTraceGeometryCommand {
  const traceId = asString(raw.traceId);
  if (!traceId) {
    throw new ValidationError("command.traceId must be a string");
  }
  if (!Array.isArray(raw.pointsNm) || raw.pointsNm.length < 2) {
    throw new ValidationError("command.pointsNm must have at least 2 points");
  }
  const pointsNm = raw.pointsNm.map((point, i) =>
    parsePointNm(point, `command.pointsNm[${i}]`),
  );
  return { type: "pcb_update_trace_geometry", traceId, pointsNm };
}

function parseCommandEnvelope(body: unknown): DesignerCommandEnvelope {
  const record = asRecord(body);
  if (!record) {
    throw new ValidationError("Request body must be an object");
  }

  const commandId = asString(record.commandId);
  const sessionId = asString(record.sessionId);
  const aggregateId = asString(record.aggregateId);
  const issuedAt = asNumber(record.issuedAt);
  if (!commandId || !sessionId || !aggregateId || issuedAt === null) {
    throw new ValidationError(
      "commandId, sessionId, aggregateId and issuedAt are required",
    );
  }

  const baseRevisionRaw = record.baseRevision;
  const baseRevision =
    baseRevisionRaw === null || baseRevisionRaw === undefined
      ? null
      : asNumber(baseRevisionRaw);
  if (
    baseRevisionRaw !== null &&
    baseRevisionRaw !== undefined &&
    baseRevision === null
  ) {
    throw new ValidationError("baseRevision must be a number or null");
  }

  const commandRecord = asRecord(record.command);
  if (!commandRecord) {
    throw new ValidationError("command must be an object");
  }

  const type = asString(commandRecord.type);
  if (!type) {
    throw new ValidationError("command.type must be a string");
  }

  let command: DesignerCommandEnvelope["command"];
  switch (type) {
    case "place_part":
      command = parsePlacePartCommand(commandRecord);
      break;
    case "create_wire":
      command = parseCreateWireCommand(commandRecord);
      break;
    case "create_wire_junction":
      command = parseCreateWireJunctionCommand(commandRecord);
      break;
    case "move_part":
      command = parseMovePartCommand(commandRecord);
      break;
    case "rotate_part":
      command = parseRotatePartCommand(commandRecord);
      break;
    case "mirror_part":
      command = parseMirrorPartCommand(commandRecord);
      break;
    case "update_part_properties":
      command = parseUpdatePartPropertiesCommand(commandRecord);
      break;
    case "update_parts_properties":
      command = parseUpdatePartsPropertiesCommand(commandRecord);
      break;
    case "delete_entity":
      command = parseDeleteEntityCommand(commandRecord);
      break;
    case "upsert_label":
      command = parseUpsertLabelCommand(commandRecord);
      break;
    case "place_gnd_port":
      command = parsePlaceGndPortCommand(commandRecord);
      break;
    case "place_pwr_port":
      command = parsePlacePwrPortCommand(commandRecord);
      break;
    case "place_net_portal":
      command = parsePlaceNetPortalCommand(commandRecord);
      break;
    case "move_primitive":
      command = parseMovePrimitiveCommand(commandRecord);
      break;
    case "rotate_primitive":
      command = parseRotatePrimitiveCommand(commandRecord);
      break;
    case "update_primitive_text":
      command = parseUpdatePrimitiveTextCommand(commandRecord);
      break;
    case "pcb_set_board_settings":
      command = parsePcbSetBoardSettingsCommand(commandRecord);
      break;
    case "pcb_move_placement":
      command = parsePcbMovePlacementCommand(commandRecord);
      break;
    case "pcb_move_placements":
      command = parsePcbMovePlacementsCommand(commandRecord);
      break;
    case "pcb_rotate_placement":
      command = parsePcbRotatePlacementCommand(commandRecord);
      break;
    case "pcb_flip_placement":
      command = parsePcbFlipPlacementCommand(commandRecord);
      break;
    case "pcb_flip_placements":
      command = parsePcbFlipPlacementsCommand(commandRecord);
      break;
    case "pcb_set_active_layer":
      command = parsePcbSetActiveLayerCommand(commandRecord);
      break;
    case "pcb_set_visible_layers":
      command = parsePcbSetVisibleLayersCommand(commandRecord);
      break;
    case "pcb_add_trace":
      command = parsePcbAddTraceCommand(commandRecord);
      break;
    case "pcb_add_via":
      command = parsePcbAddViaCommand(commandRecord);
      break;
    case "pcb_delete_trace":
      command = parsePcbDeleteTraceCommand(commandRecord);
      break;
    case "pcb_delete_via":
      command = parsePcbDeleteViaCommand(commandRecord);
      break;
    case "pcb_update_trace_geometry":
      command = parsePcbUpdateTraceGeometryCommand(commandRecord);
      break;
    default:
      throw new ValidationError(`Unsupported command type '${type}'`);
  }

  return {
    commandId,
    sessionId,
    aggregateId,
    baseRevision,
    issuedAt,
    command,
  };
}

export function registerRoutes(
  router: ModuleRouterHandle,
  ctx: CoreBackendModuleContext,
): void {
  const store = createDesignerStore(ctx);

  router.get("/status", async () => {
    const designs = await store.listDesigns();
    return success({
      module: "designer",
      designCount: designs.length,
      commandPattern: "phase2-envelope",
    });
  });

  router.post("/designs", async ({ req }) => {
    const body = await parseJsonBody<unknown>(req);
    const input = parseCreateDesignBody(body);
    const created = await store.createDesign(input);
    return success({ design: created }, 201);
  });

  router.get("/designs", async () => {
    const designs = await store.listDesigns();
    return success({ designs });
  });

  router.get("/designs/:designId", async ({ params }) => {
    const designId = params.getOrThrow("designId");
    const design = await store.getDesign(designId);
    if (!design) {
      throw new NotFoundError(`Design '${designId}' not found`);
    }
    return success({ design });
  });

  router.delete("/designs/:designId", async ({ params }) => {
    const designId = params.getOrThrow("designId");
    await store.deleteDesign(designId);
    return new Response(null, { status: 204 });
  });

  router.get("/designs/:designId/projection/schematic", async ({ params }) => {
    const designId = params.getOrThrow("designId");
    const projection = await store.getSchematicProjection(designId);
    if (!projection) {
      throw new NotFoundError(`Design '${designId}' not found`);
    }
    return success({ projection });
  });

  router.get("/designs/:designId/projection/pcb", async ({ params }) => {
    const designId = params.getOrThrow("designId");
    const projection = await store.getPcbProjection(designId);
    if (!projection) {
      throw new NotFoundError(`Design '${designId}' not found`);
    }
    return success({ projection });
  });

  router.post("/designs/:designId/commands", async ({ params, req }) => {
    const designId = params.getOrThrow("designId");
    const envelope = parseCommandEnvelope(await parseJsonBody<unknown>(req));
    if (envelope.aggregateId !== designId) {
      throw new ValidationError("aggregateId must match :designId route param");
    }
    const result = await store.dispatchCommand(designId, envelope);
    return success({ result });
  });

  router.get("/designs/:designId/history", async ({ params, query }) => {
    const designId = params.getOrThrow("designId");
    const sessionId = query.get("sessionId")?.trim();
    if (!sessionId) {
      throw new ValidationError("sessionId query parameter is required");
    }
    const projection = await store.getSchematicProjection(designId);
    if (!projection) {
      throw new NotFoundError(`Design '${designId}' not found`);
    }
    const history = await store.getHistory(designId, sessionId);
    return success({ history });
  });

  router.post("/designs/:designId/history/undo", async ({ params, req }) => {
    const designId = params.getOrThrow("designId");
    const projection = await store.getSchematicProjection(designId);
    if (!projection) {
      throw new NotFoundError(`Design '${designId}' not found`);
    }
    const { sessionId } = parseHistoryBody(await parseJsonBody<unknown>(req));
    const result = await store.undo(designId, sessionId);
    return success({ result });
  });

  router.post("/designs/:designId/history/redo", async ({ params, req }) => {
    const designId = params.getOrThrow("designId");
    const projection = await store.getSchematicProjection(designId);
    if (!projection) {
      throw new NotFoundError(`Design '${designId}' not found`);
    }
    const { sessionId } = parseHistoryBody(await parseJsonBody<unknown>(req));
    const result = await store.redo(designId, sessionId);
    return success({ result });
  });

  router.get("/library/components", async ({ query }) => {
    const q = query.get("q")?.trim();
    const tagsRaw = query.get("tags")?.trim();
    const limitRaw = query.get("limit")?.trim();
    const limit = limitRaw ? Number(limitRaw) : undefined;
    if (limitRaw && (!Number.isFinite(limit) || !Number.isInteger(limit))) {
      throw new ValidationError("limit must be an integer");
    }

    const tags = tagsRaw
      ? tagsRaw
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0)
      : [];

    const components = await store.searchLibraryComponents({
      query: q,
      tags,
      limit: limit ?? undefined,
    });
    return success({ components });
  });

  router.get(
    "/library/components/:componentId/placement",
    async ({ params }) => {
      const componentId = params.getOrThrow("componentId");
      const detail =
        await store.resolveLibraryComponentForPlacement(componentId);
      if (!detail) {
        throw new NotFoundError(`Library component '${componentId}' not found`);
      }
      return success({ detail });
    },
  );
}
