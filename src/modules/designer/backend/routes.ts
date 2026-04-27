import type {
  CoreBackendModuleContext,
  ModuleRouterHandle,
} from "../../../core/contracts/modules/backend-module";
import { NotFoundError, ValidationError } from "../../../core/backend/contracts/errors";
import type {
  DesignerCommandEnvelope,
  DesignerCreateWireCommand,
  DesignerCreateWireJunctionCommand,
  DesignerDeleteEntityCommand,
  DesignerMirrorPartCommand,
  DesignerMovePartCommand,
  DesignerPlacePartCommand,
  DesignerRotatePartCommand,
  DesignerUpsertLabelCommand,
} from "../../../sdks/designer";
import { createDesignerStore } from "./store";

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

function parsePointNm(value: unknown, field: string): { x: number; y: number } {
  const record = asRecord(value);
  if (!record) {
    throw new ValidationError(`${field} must be an object`);
  }
  const x = asNumber(record.x);
  const y = asNumber(record.y);
  if (x === null || y === null) {
    throw new ValidationError(`${field}.x and ${field}.y must be finite numbers`);
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
    throw new ValidationError("command.rotationDeg must be one of 0/90/180/270");
  }

  return {
    type: "place_part",
    componentId,
    positionNm,
    rotationDeg: rotationDeg ?? undefined,
    mirrored: mirrored === true,
  };
}

function parseMovePartCommand(raw: Record<string, unknown>): DesignerMovePartCommand {
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
    throw new ValidationError("command.rotationDeg must be one of 0/90/180/270");
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

function parseDeleteEntityCommand(
  raw: Record<string, unknown>,
): DesignerDeleteEntityCommand {
  const entityId = asString(raw.entityId);
  const entityKind = asString(raw.entityKind);
  if (!entityId) {
    throw new ValidationError("command.entityId must be a string");
  }
  if (entityKind !== "part" && entityKind !== "wire" && entityKind !== "label") {
    throw new ValidationError("command.entityKind must be one of part/wire/label");
  }

  return {
    type: "delete_entity",
    entityId,
    entityKind,
  };
}

function parseUpsertLabelCommand(
  raw: Record<string, unknown>,
): DesignerUpsertLabelCommand {
  const labelIdValue = raw.labelId;
  if (labelIdValue !== undefined && labelIdValue !== null && typeof labelIdValue !== "string") {
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

  const targetPointNm = parsePointNm(raw.targetPointNm, "command.targetPointNm");
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
  if (baseRevisionRaw !== null && baseRevisionRaw !== undefined && baseRevision === null) {
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
    case "delete_entity":
      command = parseDeleteEntityCommand(commandRecord);
      break;
    case "upsert_label":
      command = parseUpsertLabelCommand(commandRecord);
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

  router.post("/designs/:designId/commands", async ({ params, req }) => {
    const designId = params.getOrThrow("designId");
    const envelope = parseCommandEnvelope(await parseJsonBody<unknown>(req));
    if (envelope.aggregateId !== designId) {
      throw new ValidationError("aggregateId must match :designId route param");
    }
    const result = await store.dispatchCommand(designId, envelope);
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

  router.get("/library/components/:componentId/placement", async ({ params }) => {
    const componentId = params.getOrThrow("componentId");
    const detail = await store.resolveLibraryComponentForPlacement(componentId);
    if (!detail) {
      throw new NotFoundError(`Library component '${componentId}' not found`);
    }
    return success({ detail });
  });
}
