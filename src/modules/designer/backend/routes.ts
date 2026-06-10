import type {
  CoreBackendModuleContext,
  ModuleRouterHandle,
} from "../../../core/contracts/modules/backend-module";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { NotFoundError, ValidationError } from "../../../core/contracts/errors";
import { buildExportBundle } from "./export";
import {
  buildBomCsv,
  buildBomTsv,
  buildJlcBomCsv,
  buildKicadBomCsv,
} from "./export/bom/writer";
import { buildPnpCsv } from "./export/pnp/writer";
import { packZip } from "./export/zip";
import type {
  BomOverridePatch,
  GerberExportOptions,
} from "../../../sdks/designer/types";
import type {
  DesignerAutoArrangeSchematicCommand,
  DesignerCommandEnvelope,
  DesignerCreateWireCommand,
  DesignerCreateWireJunctionCommand,
  DesignerDeleteEntityCommand,
  DesignerMirrorPartCommand,
  DesignerMovePartCommand,
  DesignerMovePrimitiveCommand,
  DesignerPcbAddTraceCommand,
  DesignerPcbAddTraceViaCommand,
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
  DesignerPcbSetBoardOutlineCommand,
  DesignerPcbSetViewStateCommand,
  DesignerPcbSetDesignRulesCommand,
  PcbDesignRules,
  PcbNetClass,
  DesignerPcbSetVisibleLayersCommand,
  DesignerPcbUpdateTraceGeometryCommand,
  DesignerPcbDeletePlacementCommand,
  DesignerPcbAddFreeHoleCommand,
  DesignerPcbUpdateFreeHoleCommand,
  DesignerPcbDeleteFreeHoleCommand,
  DesignerPcbAddFreePadCommand,
  DesignerPcbUpdateFreePadCommand,
  DesignerPcbDeleteFreePadCommand,
  DesignerPcbAddManualViaCommand,
  DesignerPcbAddOverlayShapeCommand,
  DesignerPcbAddOverlayTextCommand,
  DesignerPcbDeleteOverlayShapeCommand,
  DesignerPcbDeleteOverlayTextCommand,
  DesignerPcbUpdateOverlayShapeCommand,
  DesignerPcbUpdateOverlayTextCommand,
  PcbFreePadShape,
  PcbFreePadType,
  PcbOverlayLayer,
  PcbOverlayShapeKind,
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
  PcbBoardOutline,
  PcbBoardCutout,
  PcbBoardCutoutShape,
  PcbOutlineSegment,
  DesignerCommentCommandEnvelope,
  DesignerCommentSurface,
  DesignerCommentThread,
} from "../../../sdks/designer";
import { buildDesignerSdk } from "./sdk";
import { createDesignerStore } from "./store";
import { createCommentStore } from "./comments/comment-store";
import { runDrc } from "./drc/drc-engine";
import { runErc } from "./erc/erc-engine";
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

function parseCommentSurface(raw: string | undefined): DesignerCommentSurface | undefined {
  if (!raw) return undefined;
  if (raw === "schematic" || raw === "pcb" || raw === "design") return raw;
  throw new ValidationError("surface must be schematic, pcb, or design");
}

function parseCommentCommandEnvelope(raw: unknown): DesignerCommentCommandEnvelope {
  const rec = asRecord(raw);
  if (!rec) throw new ValidationError("Request body must be an object");
  const commandId = asString(rec.commandId);
  const sessionId = asString(rec.sessionId);
  const aggregateId = asString(rec.aggregateId);
  const issuedAt = asNumber(rec.issuedAt);
  const command = asRecord(rec.command);
  if (!commandId || !sessionId || !aggregateId || issuedAt === null || !command) {
    throw new ValidationError("Invalid comment command envelope");
  }
  const baseRevisionRaw = rec.baseRevision;
  const baseRevision =
    baseRevisionRaw === null || baseRevisionRaw === undefined
      ? null
      : asNumber(baseRevisionRaw);
  if (baseRevision !== null && !Number.isInteger(baseRevision)) {
    throw new ValidationError("baseRevision must be an integer or null");
  }
  const type = asString(command.type);
  const threadId = asString(command.threadId);
  if (!type || !threadId) throw new ValidationError("Invalid comment command");
  return {
    commandId,
    sessionId,
    aggregateId,
    baseRevision,
    issuedAt,
    command: command as DesignerCommentCommandEnvelope["command"],
  };
}

function parseScreenshotUpload(raw: unknown): {
  attachmentId?: string;
  threadId: string;
  messageId?: string | null;
  fileName: string;
  mimeType: string;
  base64: string;
} {
  const rec = asRecord(raw);
  if (!rec) throw new ValidationError("Request body must be an object");
  const threadId = asString(rec.threadId);
  const fileName = asString(rec.fileName);
  const mimeType = asString(rec.mimeType);
  const base64 = asString(rec.base64);
  if (!threadId || !fileName || !mimeType || !base64) {
    throw new ValidationError("threadId, fileName, mimeType, and base64 are required");
  }
  return {
    attachmentId: asString(rec.attachmentId) ?? undefined,
    threadId,
    messageId: rec.messageId === null ? null : (asString(rec.messageId) ?? undefined),
    fileName,
    mimeType,
    base64,
  };
}

async function mirrorCommentCommandToCloud(
  store: ReturnType<typeof createDesignerStore>,
  designId: string,
  envelope: DesignerCommentCommandEnvelope,
  req: Request,
): Promise<void> {
  const bearer = req.headers.get("x-cloud-bearer");
  const apiUrl = req.headers.get("x-cloud-api-url");
  if (!bearer || !apiUrl) return;
  const link = await store.getCloudLink(designId);
  if (!link) return;
  const cloudEnvelope = {
    ...envelope,
    aggregateId: envelope.command.threadId,
  };
  void fetch(`${apiUrl}/v1/designs/${link.cloudDesignId}/comments/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(cloudEnvelope),
  }).catch(() => undefined);
}

async function pullCloudCommentsIntoLocal(
  store: ReturnType<typeof createDesignerStore>,
  commentStore: ReturnType<typeof createCommentStore>,
  designId: string,
  req: Request,
): Promise<void> {
  const bearer = req.headers.get("x-cloud-bearer");
  const apiUrl = req.headers.get("x-cloud-api-url");
  if (!bearer || !apiUrl) return;
  const link = await store.getCloudLink(designId);
  if (!link) return;
  const res = await fetch(`${apiUrl}/v1/designs/${link.cloudDesignId}/comments`, {
    headers: { authorization: `Bearer ${bearer}` },
  }).catch(() => null);
  if (!res?.ok) return;
  const body = (await res.json().catch(() => null)) as {
    threads?: DesignerCommentThread[];
  } | null;
  if (!body?.threads) return;
  const fullThreads: DesignerCommentThread[] = [];
  for (const thread of body.threads) {
    const detail = await fetch(
      `${apiUrl}/v1/designs/${link.cloudDesignId}/comments/${thread.id}`,
      { headers: { authorization: `Bearer ${bearer}` } },
    ).catch(() => null);
    if (!detail?.ok) {
      fullThreads.push(thread);
      continue;
    }
    const detailBody = (await detail.json().catch(() => null)) as {
      thread?: DesignerCommentThread;
    } | null;
    fullThreads.push(detailBody?.thread ?? thread);
  }
  commentStore.upsertRemoteThreads(designId, fullThreads);
}

function parseExportOptions(raw: unknown): GerberExportOptions {
  const rec = asRecord(raw);
  if (!rec) return {};
  const opts: GerberExportOptions = {};
  if (typeof rec.includeBom === "boolean") opts.includeBom = rec.includeBom;
  if (typeof rec.includePickAndPlace === "boolean") {
    opts.includePickAndPlace = rec.includePickAndPlace;
  }
  if (typeof rec.includeInnerLayers === "boolean") {
    opts.includeInnerLayers = rec.includeInnerLayers;
  }
  return opts;
}

function parseBomOverridePatch(raw: unknown): BomOverridePatch {
  const rec = asRecord(raw);
  if (!rec) throw new ValidationError("Request body must be an object");
  const patch: BomOverridePatch = {};
  parseOptionalString(rec, "manufacturer", (v) => (patch.manufacturer = v));
  parseOptionalString(rec, "manufacturerPartNumber", (v) => {
    patch.manufacturerPartNumber = v;
  });
  parseOptionalString(rec, "lcscPartNumber", (v) => (patch.lcscPartNumber = v));
  parseOptionalString(rec, "supplier", (v) => (patch.supplier = v));
  parseOptionalString(rec, "currency", (v) => (patch.currency = v));
  parseOptionalString(rec, "notes", (v) => (patch.notes = v));

  if ("unitPrice" in rec) {
    const rawPrice = rec.unitPrice;
    if (rawPrice === null) patch.unitPrice = null;
    else {
      const price = asNumber(rawPrice);
      if (price === null || price < 0) {
        throw new ValidationError(
          "unitPrice must be a non-negative number or null",
        );
      }
      patch.unitPrice = price;
    }
  }
  if ("dnp" in rec) {
    if (typeof rec.dnp !== "boolean") {
      throw new ValidationError("dnp must be a boolean");
    }
    patch.dnp = rec.dnp;
  }
  if ("assemblySide" in rec) {
    if (rec.assemblySide === null) patch.assemblySide = null;
    else if (rec.assemblySide === "top" || rec.assemblySide === "bottom") {
      patch.assemblySide = rec.assemblySide;
    } else {
      throw new ValidationError("assemblySide must be top, bottom, or null");
    }
  }
  return patch;
}

function parseOptionalString(
  rec: Record<string, unknown>,
  key: string,
  set: (value: string | null) => void,
): void {
  if (!(key in rec)) return;
  const value = rec[key];
  if (value === null) {
    set(null);
    return;
  }
  if (typeof value !== "string") {
    throw new ValidationError(`${key} must be a string or null`);
  }
  set(value);
}

function textResponse(
  text: string,
  contentType: string,
  fileName: string,
): Response {
  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}

async function parseZipUploadBody(req: Request): Promise<{
  fileName: string;
  bytes: Uint8Array;
  formData: FormData;
}> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    throw new ValidationError("Request body must be multipart/form-data");
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new ValidationError("file must be a ZIP upload");
  }
  if (!file.name.toLowerCase().endsWith(".zip")) {
    throw new ValidationError("file must have a .zip extension");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { fileName: file.name, bytes, formData };
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

function parseUpdateDesignBody(body: unknown): { name: string } {
  const record = asRecord(body);
  if (!record) {
    throw new ValidationError("Request body must be an object");
  }
  const raw = record.name;
  if (typeof raw !== "string") {
    throw new ValidationError("name must be a string");
  }
  const name = raw.trim();
  if (!name) {
    throw new ValidationError("name must not be empty");
  }
  if (name.length > 120) {
    throw new ValidationError("name must be 120 characters or fewer");
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

function parseAutoArrangeSchematicCommand(
  raw: Record<string, unknown>,
): DesignerAutoArrangeSchematicCommand {
  const command: DesignerAutoArrangeSchematicCommand = {
    type: "auto_arrange_schematic",
  };
  if (raw.originNm !== undefined) {
    command.originNm = parsePointNm(raw.originNm, "command.originNm");
  }
  if (raw.scope === "all") command.scope = "all";
  return command;
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
  const centerMm =
    raw.centerMm === undefined
      ? undefined
      : parsePointMm(raw.centerMm, "command.centerMm");
  return {
    type: "pcb_set_board_settings",
    widthMm,
    heightMm,
    ...(centerMm ? { centerMm } : {}),
  };
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

function parsePositiveDim(value: unknown, field: string): number {
  const n = asNumber(value);
  if (n === null || n <= 0) {
    throw new ValidationError(`${field} must be a positive number`);
  }
  return n;
}

function parseOutlineSegments(
  value: unknown,
  field: string,
): PcbOutlineSegment[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array`);
  }
  return value.map((entry, i): PcbOutlineSegment => {
    const rec = asRecord(entry);
    if (!rec) throw new ValidationError(`${field}[${i}] must be an object`);
    const to = parsePointMm(rec.to, `${field}[${i}].to`);
    if (rec.type === "arc") {
      return {
        type: "arc",
        to,
        centerMm: parsePointMm(rec.centerMm, `${field}[${i}].centerMm`),
        cw: rec.cw === true,
      };
    }
    if (rec.type === "line") {
      return { type: "line", to };
    }
    throw new ValidationError(`${field}[${i}].type must be "line" or "arc"`);
  });
}

/**
 * Parse any board-outline shape. ⚠️ HTTP-parser gotcha (see CLAUDE memory): the
 * POST /commands route reconstructs commands field-by-field, so every shape
 * field MUST be copied here or it is silently dropped over HTTP.
 */
function parseBoardOutline(value: unknown, field: string): PcbBoardOutline {
  const rec = asRecord(value);
  if (!rec) throw new ValidationError(`${field} must be an object`);
  const widthMm = parsePositiveDim(rec.widthMm, `${field}.widthMm`);
  const heightMm = parsePositiveDim(rec.heightMm, `${field}.heightMm`);
  const centerMm = parsePointMm(rec.centerMm, `${field}.centerMm`);
  switch (rec.kind) {
    case "rect":
      return { kind: "rect", widthMm, heightMm, centerMm };
    case "roundrect": {
      const cornerRadiusMm = asNumber(rec.cornerRadiusMm);
      if (cornerRadiusMm === null || cornerRadiusMm < 0) {
        throw new ValidationError(
          `${field}.cornerRadiusMm must be a non-negative number`,
        );
      }
      return { kind: "roundrect", widthMm, heightMm, centerMm, cornerRadiusMm };
    }
    case "circle":
      return { kind: "circle", widthMm, heightMm, centerMm };
    case "polygon": {
      if (!Array.isArray(rec.pointsMm) || rec.pointsMm.length < 3) {
        throw new ValidationError(
          `${field}.pointsMm must have at least 3 points`,
        );
      }
      const pointsMm = rec.pointsMm.map((p, i) =>
        parsePointMm(p, `${field}.pointsMm[${i}]`),
      );
      return { kind: "polygon", widthMm, heightMm, centerMm, pointsMm };
    }
    case "contour": {
      const start = parsePointMm(rec.start, `${field}.start`);
      const segments = parseOutlineSegments(rec.segments, `${field}.segments`);
      if (segments.length < 3) {
        throw new ValidationError(
          `${field}.segments must have at least 3 segments`,
        );
      }
      return { kind: "contour", widthMm, heightMm, centerMm, start, segments };
    }
    default:
      throw new ValidationError(
        `${field}.kind must be rect|roundrect|circle|polygon|contour`,
      );
  }
}

function parseBoardCutouts(value: unknown, field: string): PcbBoardCutout[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array`);
  }
  return value.map((entry, i): PcbBoardCutout => {
    const rec = asRecord(entry);
    if (!rec) throw new ValidationError(`${field}[${i}] must be an object`);
    const id = asString(rec.id);
    if (!id) throw new ValidationError(`${field}[${i}].id must be a string`);
    const shape = parseBoardOutline(rec.shape, `${field}[${i}].shape`);
    if (shape.kind === "rect" || shape.kind === "polygon") {
      throw new ValidationError(
        `${field}[${i}].shape must be roundrect|circle|contour`,
      );
    }
    return { id, shape: shape as PcbBoardCutoutShape };
  });
}

function parsePcbSetBoardOutlineCommand(
  raw: Record<string, unknown>,
): DesignerPcbSetBoardOutlineCommand {
  const outline = parseBoardOutline(raw.outline, "command.outline");
  const cutouts =
    raw.cutouts === undefined
      ? undefined
      : parseBoardCutouts(raw.cutouts, "command.cutouts");
  return {
    type: "pcb_set_board_outline",
    outline,
    ...(cutouts ? { cutouts } : {}),
  };
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
  "In1.Cu",
  "In2.Cu",
  "B.Cu",
  "F.Mask",
  "B.Mask",
  "F.Paste",
  "B.Paste",
  "F.SilkS",
  "B.SilkS",
  "F.CrtYd",
  "B.CrtYd",
  "F.Fab",
  "B.Fab",
  "Edge.Cuts",
  "Drill",
  "Metadata",
]);

function parsePcbSetActiveLayerCommand(
  raw: Record<string, unknown>,
): DesignerPcbSetActiveLayerCommand {
  const layer = asString(raw.layer);
  if (!layer || !PCB_LAYER_VALUES.has(layer)) {
    throw new ValidationError(
      `command.layer must be a valid PcbLayerId (got ${JSON.stringify(layer)})`,
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

const PCB_COPPER_LAYERS = new Set<string>(["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"]);
const PCB_TRACE_SEGMENT_MODES = new Set<string>([
  "manhattan-90",
  "manhattan-45",
]);

function parsePcbAddTraceCommand(
  raw: Record<string, unknown>,
): DesignerPcbAddTraceCommand {
  const layer = asString(raw.layer);
  if (!layer || !PCB_COPPER_LAYERS.has(layer)) {
    throw new ValidationError(
      "command.layer must be a copper layer (F.Cu / In1.Cu / In2.Cu / B.Cu)",
    );
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

function parsePcbAddTraceViaCommand(
  raw: Record<string, unknown>,
): DesignerPcbAddTraceViaCommand {
  const traceRecord = asRecord(raw.trace);
  if (!traceRecord) {
    throw new ValidationError("command.trace must be an object");
  }
  const viaRecord = asRecord(raw.via);
  if (!viaRecord) {
    throw new ValidationError("command.via must be an object");
  }
  const parsedTrace = parsePcbAddTraceCommand(traceRecord);
  const parsedVia = parsePcbAddViaCommand(viaRecord);
  const trace = {
    layer: parsedTrace.layer,
    pointsNm: parsedTrace.pointsNm,
    widthMm: parsedTrace.widthMm,
    netId: parsedTrace.netId,
    netClassId: parsedTrace.netClassId,
    segmentMode: parsedTrace.segmentMode,
  };
  const via = {
    centerMm: parsedVia.centerMm,
    netId: parsedVia.netId,
    netClassId: parsedVia.netClassId,
    ...(parsedVia.diameterMmOverride !== undefined
      ? { diameterMmOverride: parsedVia.diameterMmOverride }
      : {}),
    ...(parsedVia.drillMmOverride !== undefined
      ? { drillMmOverride: parsedVia.drillMmOverride }
      : {}),
  };
  return { type: "pcb_add_trace_via", trace, via };
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

function parsePcbSetViewStateCommand(
  raw: Record<string, unknown>,
): DesignerPcbSetViewStateCommand {
  const patch = asRecord(raw.patch);
  if (!patch) {
    throw new ValidationError("command.patch must be an object");
  }
  // The backend store (`pcb-store.ts`) re-validates every viewState field
  // before persisting. The route layer accepts the raw patch verbatim and
  // forwards it; unknown fields are dropped at parse time downstream.
  return {
    type: "pcb_set_view_state",
    patch: patch as DesignerPcbSetViewStateCommand["patch"],
  };
}

function parsePcbSetDesignRulesCommand(
  raw: Record<string, unknown>,
): DesignerPcbSetDesignRulesCommand {
  // Values are re-validated field-by-field in `updatePcbDesignRules`
  // (parseDesignRules / parseNetClasses) before persisting, so here we only
  // shape-check and forward. Omitted fields leave that part of the rules
  // unchanged.
  const command: DesignerPcbSetDesignRulesCommand = {
    type: "pcb_set_design_rules",
  };
  if (raw.designRules !== undefined) {
    if (!asRecord(raw.designRules)) {
      throw new ValidationError("command.designRules must be an object");
    }
    command.designRules = raw.designRules as PcbDesignRules;
  }
  if (raw.netClasses !== undefined) {
    if (!Array.isArray(raw.netClasses)) {
      throw new ValidationError("command.netClasses must be an array");
    }
    command.netClasses = raw.netClasses as PcbNetClass[];
  }
  if (raw.perNetClassAssignments !== undefined) {
    if (!asRecord(raw.perNetClassAssignments)) {
      throw new ValidationError(
        "command.perNetClassAssignments must be an object",
      );
    }
    // Shape-only forward; updatePcbDesignRules re-validates each entry against
    // the known class ids before persisting.
    command.perNetClassAssignments = raw.perNetClassAssignments as Record<
      string,
      string
    >;
  }
  const thickness = asNumber(raw.boardThicknessMm);
  if (thickness !== null) command.boardThicknessMm = thickness;
  return command;
}

function parsePcbDeletePlacementCommand(
  raw: Record<string, unknown>,
): DesignerPcbDeletePlacementCommand {
  const placementId = asString(raw.placementId);
  if (!placementId) {
    throw new ValidationError("command.placementId must be a string");
  }
  return { type: "pcb_delete_placement", placementId };
}

function parsePcbAddFreeHoleCommand(
  raw: Record<string, unknown>,
): DesignerPcbAddFreeHoleCommand {
  const drillMm = asNumber(raw.drillMm);
  if (drillMm === null || drillMm <= 0) {
    throw new ValidationError("command.drillMm must be a positive number");
  }
  return {
    type: "pcb_add_free_hole",
    centerMm: parsePointMm(raw.centerMm, "command.centerMm"),
    drillMm,
  };
}

function parsePcbUpdateFreeHoleCommand(
  raw: Record<string, unknown>,
): DesignerPcbUpdateFreeHoleCommand {
  const freeHoleId = asString(raw.freeHoleId);
  if (!freeHoleId) {
    throw new ValidationError("command.freeHoleId must be a string");
  }
  const out: DesignerPcbUpdateFreeHoleCommand = {
    type: "pcb_update_free_hole",
    freeHoleId,
  };
  if (raw.centerMm !== undefined) {
    out.centerMm = parsePointMm(raw.centerMm, "command.centerMm");
  }
  if (raw.drillMm !== undefined) {
    const drillMm = asNumber(raw.drillMm);
    if (drillMm === null || drillMm <= 0) {
      throw new ValidationError("command.drillMm must be a positive number");
    }
    out.drillMm = drillMm;
  }
  if (raw.locked !== undefined) {
    if (typeof raw.locked !== "boolean") {
      throw new ValidationError("command.locked must be a boolean");
    }
    out.locked = raw.locked;
  }
  return out;
}

function parsePcbDeleteFreeHoleCommand(
  raw: Record<string, unknown>,
): DesignerPcbDeleteFreeHoleCommand {
  const freeHoleId = asString(raw.freeHoleId);
  if (!freeHoleId) {
    throw new ValidationError("command.freeHoleId must be a string");
  }
  return { type: "pcb_delete_free_hole", freeHoleId };
}

const FREE_PAD_TYPES = new Set<PcbFreePadType>(["smd", "hole", "std", "conn"]);
const FREE_PAD_SHAPES = new Set<PcbFreePadShape>([
  "rect",
  "circle",
  "oval",
  "roundrect",
]);

function parseFreePadType(raw: unknown, field: string): PcbFreePadType {
  const s = asString(raw);
  if (s && FREE_PAD_TYPES.has(s as PcbFreePadType)) return s as PcbFreePadType;
  throw new ValidationError(`${field} must be one of: smd, hole, std, conn`);
}

function parseFreePadShape(raw: unknown, field: string): PcbFreePadShape {
  const s = asString(raw);
  if (s && FREE_PAD_SHAPES.has(s as PcbFreePadShape)) {
    return s as PcbFreePadShape;
  }
  throw new ValidationError(
    `${field} must be one of: rect, circle, oval, roundrect`,
  );
}

function parseCopperLayerOrThrow(
  raw: unknown,
  field: string,
): PcbCopperLayerId {
  const s = asString(raw);
  if (s === "F.Cu" || s === "In1.Cu" || s === "In2.Cu" || s === "B.Cu") {
    return s;
  }
  throw new ValidationError(`${field} must be a copper layer id`);
}

function parsePositiveNumber(raw: unknown, field: string): number {
  const n = asNumber(raw);
  if (n === null || !(n > 0)) {
    throw new ValidationError(`${field} must be a positive number`);
  }
  return n;
}

function parsePcbAddFreePadCommand(
  raw: Record<string, unknown>,
): DesignerPcbAddFreePadCommand {
  const padType = parseFreePadType(raw.padType, "command.padType");
  const shape = parseFreePadShape(raw.shape, "command.shape");
  const widthMm = parsePositiveNumber(raw.widthMm, "command.widthMm");
  const heightMm = parsePositiveNumber(raw.heightMm, "command.heightMm");
  const rotationRaw =
    raw.rotationDeg === undefined ? 0 : asNumber(raw.rotationDeg);
  if (rotationRaw === null) {
    throw new ValidationError("command.rotationDeg must be a number");
  }
  const layer = parseCopperLayerOrThrow(raw.layer, "command.layer");
  const out: DesignerPcbAddFreePadCommand = {
    type: "pcb_add_free_pad",
    centerMm: parsePointMm(raw.centerMm, "command.centerMm"),
    rotationDeg: rotationRaw,
    padType,
    shape,
    widthMm,
    heightMm,
    layer,
  };
  if (raw.roundrectRatio !== undefined) {
    const r = asNumber(raw.roundrectRatio);
    if (r === null || r < 0 || r > 0.5) {
      throw new ValidationError(
        "command.roundrectRatio must be between 0 and 0.5",
      );
    }
    out.roundrectRatio = r;
  }
  if (raw.drillMm !== undefined && raw.drillMm !== null) {
    out.drillMm = parsePositiveNumber(raw.drillMm, "command.drillMm");
  }
  if (raw.netId !== undefined) {
    out.netId = raw.netId === null ? null : asString(raw.netId);
  }
  if (raw.solderMaskExpansionMm !== undefined) {
    const v = asNumber(raw.solderMaskExpansionMm);
    if (v === null) {
      throw new ValidationError(
        "command.solderMaskExpansionMm must be a number",
      );
    }
    out.solderMaskExpansionMm = v;
  }
  if (raw.solderPasteExpansionMm !== undefined) {
    const v = asNumber(raw.solderPasteExpansionMm);
    if (v === null) {
      throw new ValidationError(
        "command.solderPasteExpansionMm must be a number",
      );
    }
    out.solderPasteExpansionMm = v;
  }
  return out;
}

function parsePcbUpdateFreePadCommand(
  raw: Record<string, unknown>,
): DesignerPcbUpdateFreePadCommand {
  const freePadId = asString(raw.freePadId);
  if (!freePadId) {
    throw new ValidationError("command.freePadId must be a string");
  }
  const out: DesignerPcbUpdateFreePadCommand = {
    type: "pcb_update_free_pad",
    freePadId,
  };
  if (raw.centerMm !== undefined) {
    out.centerMm = parsePointMm(raw.centerMm, "command.centerMm");
  }
  if (raw.rotationDeg !== undefined) {
    const n = asNumber(raw.rotationDeg);
    if (n === null) {
      throw new ValidationError("command.rotationDeg must be a number");
    }
    out.rotationDeg = n;
  }
  if (raw.padType !== undefined) {
    out.padType = parseFreePadType(raw.padType, "command.padType");
  }
  if (raw.shape !== undefined) {
    out.shape = parseFreePadShape(raw.shape, "command.shape");
  }
  if (raw.widthMm !== undefined) {
    out.widthMm = parsePositiveNumber(raw.widthMm, "command.widthMm");
  }
  if (raw.heightMm !== undefined) {
    out.heightMm = parsePositiveNumber(raw.heightMm, "command.heightMm");
  }
  if (raw.roundrectRatio !== undefined) {
    const r = asNumber(raw.roundrectRatio);
    if (r === null || r < 0 || r > 0.5) {
      throw new ValidationError(
        "command.roundrectRatio must be between 0 and 0.5",
      );
    }
    out.roundrectRatio = r;
  }
  if (raw.drillMm !== undefined) {
    if (raw.drillMm === null) {
      out.drillMm = null;
    } else {
      out.drillMm = parsePositiveNumber(raw.drillMm, "command.drillMm");
    }
  }
  if (raw.layer !== undefined) {
    out.layer = parseCopperLayerOrThrow(raw.layer, "command.layer");
  }
  if (raw.netId !== undefined) {
    out.netId = raw.netId === null ? null : asString(raw.netId);
  }
  if (raw.solderMaskExpansionMm !== undefined) {
    out.solderMaskExpansionMm =
      raw.solderMaskExpansionMm === null
        ? null
        : asNumber(raw.solderMaskExpansionMm);
  }
  if (raw.solderPasteExpansionMm !== undefined) {
    out.solderPasteExpansionMm =
      raw.solderPasteExpansionMm === null
        ? null
        : asNumber(raw.solderPasteExpansionMm);
  }
  if (raw.locked !== undefined) {
    if (typeof raw.locked !== "boolean") {
      throw new ValidationError("command.locked must be a boolean");
    }
    out.locked = raw.locked;
  }
  return out;
}

function parsePcbDeleteFreePadCommand(
  raw: Record<string, unknown>,
): DesignerPcbDeleteFreePadCommand {
  const freePadId = asString(raw.freePadId);
  if (!freePadId) {
    throw new ValidationError("command.freePadId must be a string");
  }
  return { type: "pcb_delete_free_pad", freePadId };
}

const OVERLAY_LAYERS = new Set<PcbOverlayLayer>([
  "F.SilkS",
  "B.SilkS",
  "F.Fab",
  "B.Fab",
  "F.CrtYd",
  "B.CrtYd",
  "Edge.Cuts",
]);

const OVERLAY_SHAPE_KINDS = new Set<PcbOverlayShapeKind>([
  "rect",
  "circle",
  "line",
  "polyline",
  "polygon",
]);

function parseOverlayLayerOrThrow(
  raw: unknown,
  field: string,
): PcbOverlayLayer {
  const s = asString(raw);
  if (s && OVERLAY_LAYERS.has(s as PcbOverlayLayer)) {
    return s as PcbOverlayLayer;
  }
  throw new ValidationError(
    `${field} must be one of: F.SilkS, B.SilkS, F.Fab, B.Fab, F.CrtYd, B.CrtYd, Edge.Cuts`,
  );
}

function parseOverlayShapeKindOrThrow(
  raw: unknown,
  field: string,
): PcbOverlayShapeKind {
  const s = asString(raw);
  if (s && OVERLAY_SHAPE_KINDS.has(s as PcbOverlayShapeKind)) {
    return s as PcbOverlayShapeKind;
  }
  throw new ValidationError(
    `${field} must be one of: rect, circle, line, polyline, polygon`,
  );
}

function parseJustify(raw: unknown): "left" | "center" | "right" {
  const s = asString(raw);
  if (s === "left" || s === "right" || s === "center") return s;
  throw new ValidationError(
    "command.justify must be one of: left, center, right",
  );
}

function parseFill(raw: unknown): "none" | "solid" {
  const s = asString(raw);
  if (s === "none" || s === "solid") return s;
  throw new ValidationError("command.fill must be 'none' or 'solid'");
}

function parsePointMmArray(
  raw: unknown,
  field: string,
): Array<{ x: number; y: number }> {
  if (!Array.isArray(raw)) {
    throw new ValidationError(`${field} must be an array`);
  }
  return raw.map((p, i) => parsePointMm(p, `${field}[${i}]`));
}

function parsePcbAddOverlayTextCommand(
  raw: Record<string, unknown>,
): DesignerPcbAddOverlayTextCommand {
  const text = asString(raw.text);
  if (text === null || text.length === 0) {
    throw new ValidationError("command.text must be a non-empty string");
  }
  const fontSizeMm = parsePositiveNumber(raw.fontSizeMm, "command.fontSizeMm");
  const rotationDeg = asNumber(raw.rotationDeg) ?? 0;
  const out: DesignerPcbAddOverlayTextCommand = {
    type: "pcb_add_overlay_text",
    layer: parseOverlayLayerOrThrow(raw.layer, "command.layer"),
    positionMm: parsePointMm(raw.positionMm, "command.positionMm"),
    text,
    fontSizeMm,
    rotationDeg,
  };
  if (raw.mirror !== undefined) {
    if (typeof raw.mirror !== "boolean") {
      throw new ValidationError("command.mirror must be a boolean");
    }
    out.mirror = raw.mirror;
  }
  if (raw.justify !== undefined) {
    out.justify = parseJustify(raw.justify);
  }
  return out;
}

function parsePcbUpdateOverlayTextCommand(
  raw: Record<string, unknown>,
): DesignerPcbUpdateOverlayTextCommand {
  const overlayTextId = asString(raw.overlayTextId);
  if (!overlayTextId) {
    throw new ValidationError("command.overlayTextId must be a string");
  }
  const out: DesignerPcbUpdateOverlayTextCommand = {
    type: "pcb_update_overlay_text",
    overlayTextId,
  };
  if (raw.layer !== undefined) {
    out.layer = parseOverlayLayerOrThrow(raw.layer, "command.layer");
  }
  if (raw.positionMm !== undefined) {
    out.positionMm = parsePointMm(raw.positionMm, "command.positionMm");
  }
  if (raw.text !== undefined) {
    const text = asString(raw.text);
    if (text === null || text.length === 0) {
      throw new ValidationError("command.text must be a non-empty string");
    }
    out.text = text;
  }
  if (raw.fontSizeMm !== undefined) {
    out.fontSizeMm = parsePositiveNumber(raw.fontSizeMm, "command.fontSizeMm");
  }
  if (raw.rotationDeg !== undefined) {
    const n = asNumber(raw.rotationDeg);
    if (n === null) {
      throw new ValidationError("command.rotationDeg must be a number");
    }
    out.rotationDeg = n;
  }
  if (raw.mirror !== undefined) {
    if (typeof raw.mirror !== "boolean") {
      throw new ValidationError("command.mirror must be a boolean");
    }
    out.mirror = raw.mirror;
  }
  if (raw.justify !== undefined) {
    out.justify = parseJustify(raw.justify);
  }
  if (raw.locked !== undefined) {
    if (typeof raw.locked !== "boolean") {
      throw new ValidationError("command.locked must be a boolean");
    }
    out.locked = raw.locked;
  }
  return out;
}

function parsePcbDeleteOverlayTextCommand(
  raw: Record<string, unknown>,
): DesignerPcbDeleteOverlayTextCommand {
  const overlayTextId = asString(raw.overlayTextId);
  if (!overlayTextId) {
    throw new ValidationError("command.overlayTextId must be a string");
  }
  return { type: "pcb_delete_overlay_text", overlayTextId };
}

function parsePcbAddOverlayShapeCommand(
  raw: Record<string, unknown>,
): DesignerPcbAddOverlayShapeCommand {
  const strokeWidthMm = parsePositiveNumber(
    raw.strokeWidthMm,
    "command.strokeWidthMm",
  );
  const out: DesignerPcbAddOverlayShapeCommand = {
    type: "pcb_add_overlay_shape",
    layer: parseOverlayLayerOrThrow(raw.layer, "command.layer"),
    kind: parseOverlayShapeKindOrThrow(raw.kind, "command.kind"),
    pointsMm: parsePointMmArray(raw.pointsMm, "command.pointsMm"),
    strokeWidthMm,
  };
  if (raw.fill !== undefined) {
    out.fill = parseFill(raw.fill);
  }
  return out;
}

function parsePcbUpdateOverlayShapeCommand(
  raw: Record<string, unknown>,
): DesignerPcbUpdateOverlayShapeCommand {
  const overlayShapeId = asString(raw.overlayShapeId);
  if (!overlayShapeId) {
    throw new ValidationError("command.overlayShapeId must be a string");
  }
  const out: DesignerPcbUpdateOverlayShapeCommand = {
    type: "pcb_update_overlay_shape",
    overlayShapeId,
  };
  if (raw.layer !== undefined) {
    out.layer = parseOverlayLayerOrThrow(raw.layer, "command.layer");
  }
  if (raw.kind !== undefined) {
    out.kind = parseOverlayShapeKindOrThrow(raw.kind, "command.kind");
  }
  if (raw.pointsMm !== undefined) {
    out.pointsMm = parsePointMmArray(raw.pointsMm, "command.pointsMm");
  }
  if (raw.strokeWidthMm !== undefined) {
    out.strokeWidthMm = parsePositiveNumber(
      raw.strokeWidthMm,
      "command.strokeWidthMm",
    );
  }
  if (raw.fill !== undefined) {
    out.fill = parseFill(raw.fill);
  }
  if (raw.locked !== undefined) {
    if (typeof raw.locked !== "boolean") {
      throw new ValidationError("command.locked must be a boolean");
    }
    out.locked = raw.locked;
  }
  return out;
}

function parsePcbDeleteOverlayShapeCommand(
  raw: Record<string, unknown>,
): DesignerPcbDeleteOverlayShapeCommand {
  const overlayShapeId = asString(raw.overlayShapeId);
  if (!overlayShapeId) {
    throw new ValidationError("command.overlayShapeId must be a string");
  }
  return { type: "pcb_delete_overlay_shape", overlayShapeId };
}

function parsePcbAddManualViaCommand(
  raw: Record<string, unknown>,
): DesignerPcbAddManualViaCommand {
  const base = parsePcbAddViaCommand(raw);
  return {
    type: "pcb_add_manual_via",
    centerMm: base.centerMm,
    netId: base.netId,
    netClassId: base.netClassId,
    ...(base.diameterMmOverride !== undefined
      ? { diameterMmOverride: base.diameterMmOverride }
      : {}),
    ...(base.drillMmOverride !== undefined
      ? { drillMmOverride: base.drillMmOverride }
      : {}),
  };
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
    case "auto_arrange_schematic":
      command = parseAutoArrangeSchematicCommand(commandRecord);
      break;
    case "pcb_set_board_settings":
      command = parsePcbSetBoardSettingsCommand(commandRecord);
      break;
    case "pcb_set_board_outline":
      command = parsePcbSetBoardOutlineCommand(commandRecord);
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
    case "pcb_add_trace_via":
      command = parsePcbAddTraceViaCommand(commandRecord);
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
    case "pcb_set_view_state":
      command = parsePcbSetViewStateCommand(commandRecord);
      break;
    case "pcb_set_design_rules":
      command = parsePcbSetDesignRulesCommand(commandRecord);
      break;
    case "pcb_delete_placement":
      command = parsePcbDeletePlacementCommand(commandRecord);
      break;
    case "pcb_add_free_hole":
      command = parsePcbAddFreeHoleCommand(commandRecord);
      break;
    case "pcb_update_free_hole":
      command = parsePcbUpdateFreeHoleCommand(commandRecord);
      break;
    case "pcb_delete_free_hole":
      command = parsePcbDeleteFreeHoleCommand(commandRecord);
      break;
    case "pcb_add_free_pad":
      command = parsePcbAddFreePadCommand(commandRecord);
      break;
    case "pcb_update_free_pad":
      command = parsePcbUpdateFreePadCommand(commandRecord);
      break;
    case "pcb_delete_free_pad":
      command = parsePcbDeleteFreePadCommand(commandRecord);
      break;
    case "pcb_add_manual_via":
      command = parsePcbAddManualViaCommand(commandRecord);
      break;
    case "pcb_add_overlay_text":
      command = parsePcbAddOverlayTextCommand(commandRecord);
      break;
    case "pcb_update_overlay_text":
      command = parsePcbUpdateOverlayTextCommand(commandRecord);
      break;
    case "pcb_delete_overlay_text":
      command = parsePcbDeleteOverlayTextCommand(commandRecord);
      break;
    case "pcb_add_overlay_shape":
      command = parsePcbAddOverlayShapeCommand(commandRecord);
      break;
    case "pcb_update_overlay_shape":
      command = parsePcbUpdateOverlayShapeCommand(commandRecord);
      break;
    case "pcb_delete_overlay_shape":
      command = parsePcbDeleteOverlayShapeCommand(commandRecord);
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
  const commentStore = createCommentStore({
    db: (ctx.db as { db: BetterSQLite3Database<Record<string, unknown>> }).db,
  });
  const designerSdk = buildDesignerSdk(ctx);

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

  router.patch("/designs/:designId", async ({ params, req }) => {
    const designId = params.getOrThrow("designId");
    const input = parseUpdateDesignBody(await parseJsonBody<unknown>(req));
    const design = await store.updateDesign(designId, input);
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

  router.get("/designs/:designId/comments", async ({ params, query, req }) => {
    const designId = params.getOrThrow("designId");
    await pullCloudCommentsIntoLocal(store, commentStore, designId, req);
    const surface = parseCommentSurface(query.get("surface") ?? undefined);
    const threads = commentStore.listThreads(designId, surface);
    if (!threads) throw new NotFoundError(`Design '${designId}' not found`);
    return success({ threads });
  });

  router.get("/designs/:designId/comments/:threadId", async ({ params, req }) => {
    const designId = params.getOrThrow("designId");
    await pullCloudCommentsIntoLocal(store, commentStore, designId, req);
    const threadId = params.getOrThrow("threadId");
    const thread = commentStore.getThread(designId, threadId);
    if (!thread) throw new NotFoundError(`Comment thread '${threadId}' not found`);
    return success({ thread });
  });

  router.post("/designs/:designId/comments/commands", async ({ params, req }) => {
    const designId = params.getOrThrow("designId");
    const envelope = parseCommentCommandEnvelope(await parseJsonBody<unknown>(req));
    const result = commentStore.dispatch(designId, envelope);
    if (result.ok) void mirrorCommentCommandToCloud(store, designId, envelope, req);
    const status = !result.ok && result.code === "COMMENT_CONFLICT" ? 409 : 200;
    return success({ result }, status);
  });

  router.post("/designs/:designId/comments/attachments", async ({ params, req }) => {
    const designId = params.getOrThrow("designId");
    const input = parseScreenshotUpload(await parseJsonBody<unknown>(req));
    const attachment = await commentStore.addScreenshot(designId, input);
    if (!attachment) throw new ValidationError("Invalid screenshot attachment");
    const bearer = req.headers.get("x-cloud-bearer");
    const apiUrl = req.headers.get("x-cloud-api-url");
    if (bearer && apiUrl) {
      const link = await store.getCloudLink(designId);
      if (link) {
        void fetch(`${apiUrl}/v1/designs/${link.cloudDesignId}/comments/attachments`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${bearer}`,
          },
          body: JSON.stringify({ ...input, attachmentId: attachment.id }),
        }).catch(() => undefined);
      }
    }
    return success({ attachment }, 201);
  });

  router.get("/designs/:designId/bom", async ({ params }) => {
    const designId = params.getOrThrow("designId");
    const bom = await store.getBomProjection(designId);
    if (!bom) {
      throw new NotFoundError(`Design '${designId}' not found`);
    }
    return success({ bom });
  });

  router.patch(
    "/designs/:designId/bom/refs/:refdes",
    async ({ params, req }) => {
      const designId = params.getOrThrow("designId");
      const refdes = params.getOrThrow("refdes");
      const patch = parseBomOverridePatch(await parseJsonBody<unknown>(req));
      const override = await store.updateBomOverride(designId, refdes, patch);
      if (!override) {
        throw new NotFoundError(`Design '${designId}' not found`);
      }
      const bom = await store.getBomProjection(designId);
      return success({ override, bom });
    },
  );

  router.get("/designs/:designId/exports/bom.csv", async ({ params }) => {
    const designId = params.getOrThrow("designId");
    const pcb = await store.getPcbProjection(designId);
    if (!pcb) throw new NotFoundError(`Design '${designId}' not found`);
    const schematic = await store.getSchematicProjection(designId);
    const overrides = await store.listBomOverrides(designId);
    return textResponse(
      buildBomCsv(pcb, schematic, overrides),
      "text/csv; charset=utf-8",
      `openpcb-${designId}-BOM.csv`,
    );
  });

  router.get("/designs/:designId/exports/bom.tsv", async ({ params }) => {
    const designId = params.getOrThrow("designId");
    const bom = await store.getBomProjection(designId);
    if (!bom) throw new NotFoundError(`Design '${designId}' not found`);
    return textResponse(
      buildBomTsv(bom.rows),
      "text/tab-separated-values; charset=utf-8",
      `openpcb-${designId}-BOM.tsv`,
    );
  });

  router.get("/designs/:designId/exports/bom-jlc.csv", async ({ params }) => {
    const designId = params.getOrThrow("designId");
    const bom = await store.getBomProjection(designId);
    if (!bom) throw new NotFoundError(`Design '${designId}' not found`);
    return textResponse(
      buildJlcBomCsv(bom.rows),
      "text/csv; charset=utf-8",
      `openpcb-${designId}-JLC-BOM.csv`,
    );
  });

  router.get("/designs/:designId/exports/kicad-bom.csv", async ({ params }) => {
    const designId = params.getOrThrow("designId");
    const bom = await store.getBomProjection(designId);
    if (!bom) throw new NotFoundError(`Design '${designId}' not found`);
    return textResponse(
      buildKicadBomCsv(bom.rows),
      "text/csv; charset=utf-8",
      `openpcb-${designId}-KiCad-BOM.csv`,
    );
  });

  router.get("/designs/:designId/exports/pnp.csv", async ({ params }) => {
    const designId = params.getOrThrow("designId");
    const pcb = await store.getPcbProjection(designId);
    if (!pcb) throw new NotFoundError(`Design '${designId}' not found`);
    const schematic = await store.getSchematicProjection(designId);
    const overrides = await store.listBomOverrides(designId);
    return textResponse(
      buildPnpCsv(pcb, schematic, overrides),
      "text/csv; charset=utf-8",
      `openpcb-${designId}-PnP.csv`,
    );
  });

  router.post(
    "/designs/:designId/exports/gerber",
    async ({ params, req, query }) => {
      const designId = params.getOrThrow("designId");
      const pcb = await store.getPcbProjection(designId);
      if (!pcb) throw new NotFoundError(`Design '${designId}' not found`);
      const schematic = await store.getSchematicProjection(designId);
      const overrides = await store.listBomOverrides(designId);

      const rawBody = req.headers.get("content-length")
        ? await parseJsonBody<unknown>(req).catch(() => ({}))
        : {};
      const options = parseExportOptions(rawBody);

      const bundle = buildExportBundle(pcb, schematic, options, overrides);

      // `?format=zip` returns ZIP bytes; `?format=summary` returns a light
      // manifest (names + sizes + preflight warnings, no file text) for the
      // export dialog's preview; default JSON manifest carries full text so
      // E2E can inspect contents without re-parsing the archive.
      const format = (query.get("format") ?? "json").toLowerCase();
      if (format === "zip") {
        const zip = packZip(bundle.artifacts);
        return new Response(zip, {
          status: 200,
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${bundle.bundleName}.zip"`,
            "X-OpenPCB-Bundle-Name": bundle.bundleName,
            "X-OpenPCB-Warnings": bundle.warnings.length.toString(),
          },
        });
      }
      if (format === "summary") {
        return success({
          bundleName: bundle.bundleName,
          warnings: bundle.warnings,
          files: bundle.artifacts.map((artifact) => ({
            kind: artifact.kind,
            fileName: artifact.fileName,
            bytes: artifact.text.length,
          })),
        });
      }
      return success({ bundle });
    },
  );

  router.get("/designs/:designId/erc", async ({ params }) => {
    const designId = params.getOrThrow("designId");
    const projection = await store.getSchematicProjection(designId);
    if (!projection) {
      throw new NotFoundError(`Design '${designId}' not found`);
    }
    return success({ report: runErc(projection) });
  });

  // Compute DRC over the current PCB projection AND persist the result, so the
  // design card + a later reopen reflect it. Returns the fresh report.
  router.post("/designs/:designId/drc/run", async ({ params }) => {
    const designId = params.getOrThrow("designId");
    const projection = await store.getPcbProjection(designId);
    if (!projection) {
      throw new NotFoundError(`Design '${designId}' not found`);
    }
    const view = projection.board.viewState;
    const options = {
      ignoredRuleClasses: view?.drcIgnoredRuleClasses ?? [],
      waivedIds: view?.drcWaivedViolationIds ?? [],
    };
    const report = runDrc(projection, options);
    await store.saveDrcResult(designId, report, options);
    return success({ report });
  });

  // Return the latest *persisted* DRC report (or null if never run). The
  // report's `revision` is the revision it ran against; the client compares it
  // to the live projection revision to detect staleness.
  router.get("/designs/:designId/drc", async ({ params }) => {
    const designId = params.getOrThrow("designId");
    const stored = await store.getDrcResult(designId);
    return success({ report: stored?.report ?? null });
  });

  router.post("/designs/:designId/commands", async ({ params, req }) => {
    const designId = params.getOrThrow("designId");
    const envelope = parseCommandEnvelope(await parseJsonBody<unknown>(req));
    if (envelope.aggregateId !== designId) {
      throw new ValidationError("aggregateId must match :designId route param");
    }
    const bearer = req.headers.get("x-cloud-bearer") ?? undefined;
    const apiUrl = req.headers.get("x-cloud-api-url") ?? undefined;
    const result = await store.dispatchCommand(designId, envelope, {
      bearer,
      apiUrl,
    });
    return success({ result });
  });

  router.post("/designs/:designId/cloud-link", async ({ params, req }) => {
    const designId = params.getOrThrow("designId");
    const bearer = req.headers.get("x-cloud-bearer");
    const apiUrl = req.headers.get("x-cloud-api-url");
    if (!bearer || !apiUrl) {
      throw new ValidationError(
        "x-cloud-bearer and x-cloud-api-url headers required",
      );
    }
    const bodyRaw = (await parseJsonBody<unknown>(req).catch(() => null)) as {
      existingCloudDesignId?: unknown;
      lastSyncedRevision?: unknown;
    } | null;
    const existing =
      bodyRaw && typeof bodyRaw.existingCloudDesignId === "string"
        ? bodyRaw.existingCloudDesignId
        : undefined;
    const lastRev =
      bodyRaw && typeof bodyRaw.lastSyncedRevision === "number"
        ? bodyRaw.lastSyncedRevision
        : undefined;
    const link = await store.linkDesignToCloud(designId, {
      bearer,
      apiUrl,
      existingCloudDesignId: existing,
      lastSyncedRevision: lastRev,
    });
    return success({ link });
  });

  router.get("/designs/:designId/cloud-link", async ({ params }) => {
    const designId = params.getOrThrow("designId");
    const link = await store.getCloudLink(designId);
    return success({ link });
  });

  // Sever the local→cloud association (stops mirroring). Leaves the remote
  // cloud design intact.
  router.delete("/designs/:designId/cloud-link", async ({ params }) => {
    const designId = params.getOrThrow("designId");
    await store.unlinkDesignFromCloud(designId);
    return success({ ok: true });
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

  router.post("/imports/kicad-project/inspect", async (routeCtx) => {
    const body = await parseZipUploadBody(routeCtx.req);
    const report = await designerSdk.inspectKicadProject(
      body.fileName,
      body.bytes,
    );
    return success({ report });
  });

  router.post("/imports/kicad-project", async (routeCtx) => {
    const body = await parseZipUploadBody(routeCtx.req);
    const formData = body.formData;
    const overrideName =
      typeof formData.get("designName") === "string"
        ? (formData.get("designName") as string).trim() || undefined
        : undefined;
    const result = await designerSdk.commitKicadProject({
      designName: overrideName,
      archiveFileName: body.fileName,
      archiveBytes: body.bytes,
    });
    return success({ result }, 201);
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

  router.get("/library/tags", async ({ query }) => {
    const excludeSystem = query.get("excludeSystem") === "true";
    const tags = await store.listLibraryTags({ excludeSystem });
    return success({ tags });
  });
}
