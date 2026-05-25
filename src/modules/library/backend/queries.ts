import { and, asc, eq, inArray, like, or, sql } from "drizzle-orm";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import { ValidationError } from "../../../core/contracts/errors";
import type {
  LibraryComponent,
  LibraryComponentFootprintVariant,
  LibraryComponentPlacementDetail,
  LibraryComponentDetail,
  LibraryFacetBucket,
  LibraryFacetOption,
  LibraryFacetParams,
  LibraryFacets,
  LibraryFootprint,
  LibraryFootprintDetail,
  LibraryFootprintModelDescriptor,
  LibraryFootprintPlacementSnapshot,
  LibraryListTagsOptions,
  LibraryPreviewWarning,
  LibraryPinMapEntry,
  LibrarySearchParams,
  LibrarySourceProvenance,
  LibrarySDK,
  LibrarySymbol,
  LibrarySymbolPlacementSnapshot,
  LibrarySymbolDetail,
  LibraryTagStat,
  LibraryUpdateComponentInput,
} from "../../../sdks/library";
import { bucketTag } from "./tag-bucketing";
import type {
  BoundsMm,
  FootprintRenderModel,
  SymbolRenderModel,
} from "../../../shared/rendering";
import {
  boundsFromGraphics,
  isFiniteBoundsMm,
  normalizeBounds,
} from "../../../shared/rendering/geometry";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  componentFootprints,
  components,
  footprintModels,
  footprints,
  releases,
  sources,
  symbols,
} from "./schema";

export type ComponentRow = typeof components.$inferSelect;
export type SymbolRow = typeof symbols.$inferSelect;
export type FootprintRow = typeof footprints.$inferSelect;
export type FootprintModelRow = typeof footprintModels.$inferSelect;

export interface FootprintModelMetadata {
  status: string;
  hasModel: boolean;
  glbSha256: string | null;
  sourceStepSha256: string | null;
  sourceFilename: string | null;
  modelRef: unknown | null;
  byteSize: number | null;
  errorMessage: string | null;
}

export interface FootprintModelRecord extends FootprintModelMetadata {
  footprintId: string;
  glbPath: string | null;
  sourceStepPath: string | null;
  sourceByteSize: number | null;
  tessellationParams: unknown | null;
  converterVersion: string | null;
}

export interface UpsertFootprintModelInput {
  footprintId: string;
  glbPath: string;
  glbSha256: string;
  byteSize: number;
  sourceStepPath: string | null;
  sourceStepSha256: string | null;
  sourceFilename: string | null;
  sourceByteSize: number | null;
  modelRefJson: string | null;
  tessellationParamsJson: string | null;
  converterVersion: string | null;
}

export function getDb(
  ctx: CoreBackendModuleContext,
): BetterSQLite3Database<Record<string, unknown>> {
  return (ctx.db as { db: BetterSQLite3Database<Record<string, unknown>> }).db;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function parseJsonStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function parseOptionalJson(value: string | null): unknown | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parsePinMapJson(value: string | null): LibraryPinMapEntry[] | null {
  const parsed = parseOptionalJson(value);
  if (!Array.isArray(parsed)) {
    return null;
  }
  const entries: LibraryPinMapEntry[] = [];
  for (const item of parsed) {
    const record = asRecord(item);
    const pinNumber = asString(record?.pinNumber)?.trim();
    const padNumber = asString(record?.padNumber)?.trim();
    if (!pinNumber || !padNumber) {
      continue;
    }
    entries.push({
      pinNumber,
      padNumber,
      pinName: asString(record?.pinName),
    });
  }
  return entries.length > 0 ? entries : null;
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

function isSymbolRenderModel(value: unknown): value is SymbolRenderModel {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (value as { kind?: unknown }).kind === "symbol";
}

function isFootprintRenderModel(value: unknown): value is FootprintRenderModel {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (value as { kind?: unknown }).kind === "footprint";
}

function translatePreviewGraphic(
  graphic: SymbolRenderModel["graphics"][number],
  dx: number,
  dy: number,
): SymbolRenderModel["graphics"][number] {
  switch (graphic.kind) {
    case "line":
      return {
        ...graphic,
        a: { x: graphic.a.x + dx, y: graphic.a.y + dy },
        b: { x: graphic.b.x + dx, y: graphic.b.y + dy },
      };
    case "rect":
      return {
        ...graphic,
        x: graphic.x + dx,
        y: graphic.y + dy,
      };
    case "circle":
      return {
        ...graphic,
        center: {
          x: graphic.center.x + dx,
          y: graphic.center.y + dy,
        },
      };
    case "arc3":
      return {
        ...graphic,
        start: { x: graphic.start.x + dx, y: graphic.start.y + dy },
        mid: { x: graphic.mid.x + dx, y: graphic.mid.y + dy },
        end: { x: graphic.end.x + dx, y: graphic.end.y + dy },
      };
    case "polyline":
      return {
        ...graphic,
        points: graphic.points.map((point) => ({
          x: point.x + dx,
          y: point.y + dy,
        })),
      };
    case "bezier":
      return {
        ...graphic,
        points: [
          { x: graphic.points[0].x + dx, y: graphic.points[0].y + dy },
          { x: graphic.points[1].x + dx, y: graphic.points[1].y + dy },
          { x: graphic.points[2].x + dx, y: graphic.points[2].y + dy },
          { x: graphic.points[3].x + dx, y: graphic.points[3].y + dy },
        ],
      };
  }
}

function alignPreviewToPinSnapshot(
  preview: SymbolRenderModel,
  pins: LibrarySymbolPlacementSnapshot["pins"],
): SymbolRenderModel {
  if (preview.pins.length === 0 || pins.length === 0) {
    return preview;
  }

  const pinsByKey = new Map<
    string,
    LibrarySymbolPlacementSnapshot["pins"][number]
  >();
  for (const pin of pins) {
    pinsByKey.set(pin.originPinKey, pin);
    const number = pin.number?.trim();
    if (number) {
      pinsByKey.set(`u${pin.unit}:${number}`, pin);
    }
  }

  const deltas: Array<{ dx: number; dy: number }> = [];
  for (const previewPin of preview.pins) {
    const number = previewPin.number?.trim();
    const localPin =
      pinsByKey.get(previewPin.id) ??
      (number ? pinsByKey.get(`u${previewPin.unit}:${number}`) : undefined) ??
      pinsByKey.get(`u${previewPin.unit}:${previewPin.id}`);

    if (!localPin) {
      continue;
    }
    deltas.push({
      dx: previewPin.anchor.x - localPin.localPositionMm.x,
      dy: previewPin.anchor.y - localPin.localPositionMm.y,
    });
  }

  if (deltas.length === 0) {
    return preview;
  }

  let deltaX = 0;
  let deltaY = 0;
  for (const delta of deltas) {
    deltaX += delta.dx;
    deltaY += delta.dy;
  }

  const dx = deltaX / deltas.length;
  const dy = deltaY / deltas.length;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    return preview;
  }

  const maxDeviation = Math.max(
    ...deltas.map((delta) =>
      Math.max(Math.abs(delta.dx - dx), Math.abs(delta.dy - dy)),
    ),
  );
  if (maxDeviation > 1e-3) {
    return preview;
  }

  return {
    ...preview,
    graphics: preview.graphics.map((graphic) =>
      translatePreviewGraphic(graphic, -dx, -dy),
    ),
    pins: preview.pins.map((pin) => ({
      ...pin,
      anchor: { x: pin.anchor.x - dx, y: pin.anchor.y - dy },
      bodyEnd: { x: pin.bodyEnd.x - dx, y: pin.bodyEnd.y - dy },
    })),
    labels: preview.labels.map((label) => ({
      ...label,
      at: { x: label.at.x - dx, y: label.at.y - dy },
    })),
    bounds: preview.bounds
      ? {
          minX: preview.bounds.minX - dx,
          minY: preview.bounds.minY - dy,
          maxX: preview.bounds.maxX - dx,
          maxY: preview.bounds.maxY - dy,
        }
      : null,
  };
}

function parseSymbolPlacementSnapshot(
  row: SymbolRow,
): LibrarySymbolPlacementSnapshot {
  const data = parseJsonObject(row.dataJson);
  const normalized = asRecord(data.normalized);

  // Require normalized data only - no legacy fallback
  if (!normalized) {
    throw new Error(
      `Symbol ${row.id} (${row.name}) missing normalized data. ` +
        `Only normalized-format symbols are supported for schematic placement.`,
    );
  }

  const pinsRaw = Array.isArray(normalized.pins) ? normalized.pins : [];
  const previewRaw = normalized.preview;
  const provenance = asRecord(data.provenance);

  // Require valid preview for schematic rendering
  if (!isSymbolRenderModel(previewRaw)) {
    throw new Error(
      `Symbol ${row.id} (${row.name}) missing valid preview model. ` +
        `Symbol must have a renderable preview for schematic placement.`,
    );
  }

  const pins = pinsRaw
    .map((entry) => {
      const pin = asRecord(entry);
      if (!pin) {
        return null;
      }
      const local = asRecord(pin.localPosition);
      const x = asNumber(local?.x);
      const y = asNumber(local?.y);
      if (x === null || y === null) {
        return null;
      }

      const originPinKey = asString(pin.originPinKey);
      if (!originPinKey) {
        return null;
      }
      // Empty pin names are valid (KiCad convention for unlabeled pins on
      // generic passives like R/C). Only require originPinKey + position.
      const name = asString(pin.name) ?? "";

      return {
        originPinKey,
        number: asString(pin.number),
        name,
        localPositionMm: { x, y },
        electricalType: asString(pin.electricalType) ?? "passive",
        unit: asNumber(pin.unit) ?? 1,
      };
    })
    .filter(
      (pin): pin is LibrarySymbolPlacementSnapshot["pins"][number] =>
        pin !== null,
    );

  return {
    symbolId: row.id,
    name: row.name,
    referencePrefix: asString(normalized.referencePrefix) ?? "",
    sourceHash: asString(provenance?.sourceHash),
    pins,
    preview: alignPreviewToPinSnapshot(previewRaw, pins),
  };
}

function parseFootprintPlacementSnapshot(
  row: FootprintRow,
  modelRow?: FootprintModelRow | null,
  pinMap: LibraryPinMapEntry[] | null = null,
): LibraryFootprintPlacementSnapshot {
  // Footprint preview is optional (null allowed) while schematic-only workflows remain supported.
  const data = parseJsonObject(row.dataJson);
  const normalized = asRecord(data.normalized);
  const provenance = asRecord(data.provenance);
  const previewRaw = normalized?.preview;

  const preview = isFootprintRenderModel(previewRaw)
    ? rederivedFootprintPreview(previewRaw)
    : null;

  const snapshot: LibraryFootprintPlacementSnapshot = {
    footprintId: row.id,
    name: row.name,
    mountType: asString(normalized?.mountType) ?? asString(data.mountType),
    sourceHash: asString(provenance?.sourceHash),
    preview,
    pinMap,
  };
  if (modelRow) {
    snapshot.model3d = mapFootprintModelDescriptor(modelRow);
  }
  return snapshot;
}

/**
 * Recompute geometry-only bounds for previews loaded from the DB. Older
 * imports baked label text (often KiCad value/reference anchored far outside
 * the body) into `bounds`, which inflated PCB selection and hit regions. New
 * imports already exclude labels; this guards round-tripping for legacy data.
 */
function rederivedFootprintPreview(
  preview: FootprintRenderModel,
): FootprintRenderModel {
  const raw = boundsFromPadsAndGraphicsOnce(preview);
  const bounds = isFiniteBoundsMm(raw) ? normalizeBounds(raw, 2.0) : null;
  return { ...preview, bounds };
}

function boundsFromPadsAndGraphicsOnce(
  preview: FootprintRenderModel,
): BoundsMm {
  let bounds: BoundsMm = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  for (const graphic of preview.graphics) {
    const graphicBounds = boundsFromGraphics([graphic]);
    if (graphicBounds) bounds = includeBounds(bounds, graphicBounds);
  }

  for (const pad of preview.pads) {
    const half = rotatedPadHalfExtents(
      pad.widthMm,
      pad.heightMm,
      pad.rotationDeg,
    );
    bounds = includePointBounds(
      bounds,
      pad.centerMm.x - half.x,
      pad.centerMm.y - half.y,
    );
    bounds = includePointBounds(
      bounds,
      pad.centerMm.x + half.x,
      pad.centerMm.y + half.y,
    );
  }

  return bounds;
}

function rotatedPadHalfExtents(
  widthMm: number,
  heightMm: number,
  rotationDeg: number,
): { x: number; y: number } {
  const halfWidth = Math.abs(widthMm) / 2;
  const halfHeight = Math.abs(heightMm) / 2;
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    x: cos * halfWidth + sin * halfHeight,
    y: sin * halfWidth + cos * halfHeight,
  };
}

function includeBounds(bounds: BoundsMm, next: BoundsMm): BoundsMm {
  return {
    minX: Math.min(bounds.minX, next.minX),
    minY: Math.min(bounds.minY, next.minY),
    maxX: Math.max(bounds.maxX, next.maxX),
    maxY: Math.max(bounds.maxY, next.maxY),
  };
}

function includePointBounds(bounds: BoundsMm, x: number, y: number): BoundsMm {
  return includeBounds(bounds, { minX: x, minY: y, maxX: x, maxY: y });
}

function mapFootprintModelDescriptor(
  row: FootprintModelRow,
): LibraryFootprintModelDescriptor {
  return {
    status: row.status,
    glbUrl:
      row.glbPath && row.glbSha256
        ? `/api/modules/library/footprints/${row.footprintId}/model`
        : null,
    glbSha256: row.glbSha256,
    sourceStepSha256: row.sourceStepSha256,
    sourceFilename: row.sourceFilename,
    modelRef: parseOptionalJson(row.modelRefJson),
    converterVersion: row.converterVersion,
  };
}

function parseWarnings(value: unknown): LibraryPreviewWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const warnings: LibraryPreviewWarning[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const code = asString(record.code);
    const message = asString(record.message);
    if (!code || !message) {
      continue;
    }
    warnings.push({ code, message });
  }
  return warnings;
}

function parseSourceProvenance(
  data: Record<string, unknown>,
): LibrarySourceProvenance | null {
  const provenance = asRecord(data.provenance);
  if (!provenance) {
    return null;
  }
  return {
    sourceKind: asString(provenance.sourceKind),
    sourceFormat: asString(provenance.sourceFormat),
    fileName: asString(provenance.fileName),
    importedAt: asString(provenance.importedAt),
    sourceHash: asString(provenance.sourceHash),
  };
}

function parsePackageCode(value: unknown): {
  imperial: string | null;
  metric: string | null;
} {
  const record = asRecord(value);
  if (!record) {
    return {
      imperial: null,
      metric: null,
    };
  }
  return {
    imperial: asString(record.imperial),
    metric: asString(record.metric),
  };
}

export function mapComponent(row: ComponentRow): LibraryComponent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    symbolId: row.symbolId,
    footprintId: row.footprintId,
    tags: parseJsonStringArray(row.tagsJson),
    isBuiltin: Boolean(row.isBuiltin),
  };
}

export function mapSymbol(row: SymbolRow): LibrarySymbol {
  return {
    id: row.id,
    name: row.name,
    data: parseJsonObject(row.dataJson),
  };
}

export function mapFootprint(row: FootprintRow): LibraryFootprint {
  return {
    id: row.id,
    name: row.name,
    data: parseJsonObject(row.dataJson),
  };
}

export function mapSymbolDetail(row: SymbolRow): LibrarySymbolDetail {
  const data = parseJsonObject(row.dataJson);
  const normalized = asRecord(data.normalized);

  // Only use normalized data - no legacy fallback
  const normalizedPins =
    normalized && Array.isArray(normalized.pins) ? normalized.pins : null;

  const preview = asRecord(normalized?.preview);

  return {
    id: row.id,
    name: row.name,
    referencePrefix: asString(normalized?.referencePrefix) ?? "",
    pinCount: normalizedPins ? normalizedPins.length : 0,
    warnings: parseWarnings(normalized?.warnings),
    preview,
    provenance: parseSourceProvenance(data),
  };
}

export function mapFootprintDetail(row: FootprintRow): LibraryFootprintDetail {
  const data = parseJsonObject(row.dataJson);
  const normalized = asRecord(data.normalized);
  const normalizedPads =
    normalized && Array.isArray(normalized.pads) ? normalized.pads : null;
  const previewCandidate = normalized?.preview ?? data.preview;
  const preview = isFootprintRenderModel(previewCandidate)
    ? (rederivedFootprintPreview(previewCandidate) as unknown as Record<
        string,
        unknown
      >)
    : asRecord(previewCandidate);

  const padCountFromNormalized = asNumber(normalized?.padCount);
  const mountType = asString(normalized?.mountType) ?? asString(data.mountType);

  return {
    id: row.id,
    name: row.name,
    mountType,
    padCount:
      padCountFromNormalized ?? (normalizedPads ? normalizedPads.length : 0),
    packageCode: parsePackageCode(normalized?.packageCode ?? data.packageCode),
    warnings: parseWarnings(normalized?.warnings ?? data.warnings),
    preview,
    provenance: parseSourceProvenance(data),
  };
}

export async function searchComponents(
  ctx: CoreBackendModuleContext,
  params: LibrarySearchParams,
): Promise<LibraryComponent[]> {
  const db = getDb(ctx);
  const query = params.query?.trim().toLowerCase() ?? "";
  const queryTokens = tokenizeSearchQuery(query);
  const limit = Math.max(1, Math.min(100, params.limit ?? 25));
  const allTags = (params.tags ?? [])
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag, index, all) => tag.length > 0 && all.indexOf(tag) === index);
  // Source filters (`source:<id>`) match component.sourceId / isBuiltin; the
  // rest are matched against the freeform component.tags array.
  const sourceFilters = new Set<string>();
  const expectedTags = new Set<string>();
  for (const t of allTags) {
    if (t.startsWith(SOURCE_TAG_PREFIX)) {
      sourceFilters.add(t.slice(SOURCE_TAG_PREFIX.length));
    } else {
      expectedTags.add(t);
    }
  }
  const hasFilter = sourceFilters.size > 0 || expectedTags.size > 0;

  let rows: ComponentRow[];
  if (query.length > 0) {
    const phraseNeedle = `%${escapeLikeNeedle(query)}%`;
    const tokenNeedles = queryTokens.map((token) => `%${escapeLikeNeedle(token)}%`);
    const searchableText = sql<string>`lower(${components.name} || ' ' || ${components.description} || ' ' || ${components.tagsJson} || ' ' || coalesce(${components.sourceId}, ''))`;
    const tokenPredicate = tokenNeedles.length > 0
      ? and(...tokenNeedles.map((needle) => like(searchableText, needle)))
      : undefined;
    const baseQuery = db
      .select()
      .from(components)
      .where(
        or(
          like(sql`lower(${components.name})`, phraseNeedle),
          like(sql`lower(${components.description})`, phraseNeedle),
          like(sql`lower(${components.tagsJson})`, phraseNeedle),
          tokenPredicate,
        ),
      )
      .orderBy(components.name);
    rows = hasFilter ? await baseQuery.all() : await baseQuery.limit(limit);
  } else {
    const baseQuery = db.select().from(components).orderBy(components.name);
    rows = hasFilter ? await baseQuery.all() : await baseQuery.limit(limit);
  }

  if (!hasFilter) {
    return rows.map(mapComponent);
  }
  const filteredRows = rows.filter((row) => {
    if (sourceFilters.size > 0) {
      const sourceKey = row.sourceId ?? (row.isBuiltin === 1 ? "core" : "user");
      if (!sourceFilters.has(sourceKey)) return false;
    }
    if (expectedTags.size > 0) {
      const tagSet = new Set(
        parseJsonStringArray(row.tagsJson).map((t) => t.toLowerCase()),
      );
      for (const tag of expectedTags) {
        if (!tagSet.has(tag)) return false;
      }
    }
    return true;
  });
  return filteredRows.slice(0, limit).map(mapComponent);
}

function tokenizeSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9.+-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token, index, all) => token.length > 0 && all.indexOf(token) === index);
}

function escapeLikeNeedle(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export async function resolveComponent(
  ctx: CoreBackendModuleContext,
  componentId: string,
): Promise<LibraryComponent | null> {
  const db = getDb(ctx);
  const row = await db
    .select()
    .from(components)
    .where(eq(components.id, componentId))
    .get();
  return row ? mapComponent(row) : null;
}

/**
 * Load the full footprint variant list for a component, joined with each
 * footprint's name/mountType/padCount/packageCode for picker UIs. Returns at
 * least one entry (the component's default) for resolvable components; older
 * components migrated before the join table existed get a synthetic single
 * entry derived from their cached `footprintId`.
 */
async function loadComponentFootprintVariants(
  ctx: CoreBackendModuleContext,
  componentRow: ComponentRow,
): Promise<LibraryComponentFootprintVariant[]> {
  const db = getDb(ctx);
  const joinRows = await db
    .select({
      footprintId: componentFootprints.footprintId,
      isDefault: componentFootprints.isDefault,
      variantLabel: componentFootprints.variantLabel,
      sortOrder: componentFootprints.sortOrder,
      pinMapJson: componentFootprints.pinMapJson,
    })
    .from(componentFootprints)
    .where(eq(componentFootprints.componentId, componentRow.id))
    .orderBy(asc(componentFootprints.sortOrder))
    .all();

  if (joinRows.length === 0) {
    // Fallback: synthesize a single-entry list from the cached default so
    // callers always receive a non-empty array. Older user-imported components
    // without join rows still resolve.
    const fpRow = await db
      .select()
      .from(footprints)
      .where(eq(footprints.id, componentRow.footprintId))
      .get();
    if (!fpRow) return [];
    const detail = mapFootprintDetail(fpRow);
    return [
      {
        footprintId: fpRow.id,
        variantLabel: detail.name,
        isDefault: true,
        sortOrder: 0,
        name: detail.name,
        mountType: detail.mountType,
        padCount: detail.padCount,
        packageCode: detail.packageCode,
        pinMap: null,
      },
    ];
  }

  const fpRows = await db
    .select()
    .from(footprints)
    .where(
      inArray(
        footprints.id,
        joinRows.map((row) => row.footprintId),
      ),
    )
    .all();
  const fpById = new Map(fpRows.map((row) => [row.id, row]));

  const variants: LibraryComponentFootprintVariant[] = [];
  for (const row of joinRows) {
    const fp = fpById.get(row.footprintId);
    if (!fp) continue; // referential integrity is enforced via FK + ON DELETE CASCADE; this is defensive
    const detail = mapFootprintDetail(fp);
    variants.push({
      footprintId: row.footprintId,
      variantLabel: row.variantLabel,
      isDefault: row.isDefault === 1,
      sortOrder: row.sortOrder,
      name: detail.name,
      mountType: detail.mountType,
      padCount: detail.padCount,
      packageCode: detail.packageCode,
      pinMap: parsePinMapJson(row.pinMapJson),
    });
  }
  return variants;
}

async function loadDefaultFootprintPinMap(
  ctx: CoreBackendModuleContext,
  componentRow: ComponentRow,
): Promise<LibraryPinMapEntry[] | null> {
  const db = getDb(ctx);
  const row = await db
    .select({ pinMapJson: componentFootprints.pinMapJson })
    .from(componentFootprints)
    .where(
      and(
        eq(componentFootprints.componentId, componentRow.id),
        eq(componentFootprints.footprintId, componentRow.footprintId),
      ),
    )
    .get();
  return parsePinMapJson(row?.pinMapJson ?? null);
}

// Component symbolId/footprintId store canonical IDs from the package.
export async function getComponentDetail(
  ctx: CoreBackendModuleContext,
  componentId: string,
): Promise<LibraryComponentDetail | null> {
  const db = getDb(ctx);
  const componentRow = await db
    .select()
    .from(components)
    .where(eq(components.id, componentId))
    .get();
  if (!componentRow) return null;

  const symbolRow = await db
    .select()
    .from(symbols)
    .where(eq(symbols.id, componentRow.symbolId))
    .get();
  const footprintRow = await db
    .select()
    .from(footprints)
    .where(eq(footprints.id, componentRow.footprintId))
    .get();
  if (!symbolRow || !footprintRow) {
    return null;
  }

  const footprintVariants = await loadComponentFootprintVariants(
    ctx,
    componentRow,
  );

  return {
    component: mapComponent(componentRow),
    symbol: mapSymbolDetail(symbolRow),
    footprint: mapFootprintDetail(footprintRow),
    footprintVariants,
  };
}

export async function resolveComponentForPlacement(
  ctx: CoreBackendModuleContext,
  componentId: string,
): Promise<LibraryComponentPlacementDetail | null> {
  const db = getDb(ctx);
  const componentRow = await db
    .select()
    .from(components)
    .where(eq(components.id, componentId))
    .get();
  if (!componentRow) return null;

  const symbolRow = await db
    .select()
    .from(symbols)
    .where(eq(symbols.id, componentRow.symbolId))
    .get();
  const footprintRow = await db
    .select()
    .from(footprints)
    .where(eq(footprints.id, componentRow.footprintId))
    .get();
  if (!symbolRow || !footprintRow) {
    return null;
  }

  const footprintModelRow = await db
    .select()
    .from(footprintModels)
    .where(eq(footprintModels.footprintId, footprintRow.id))
    .get();

  const footprintVariants = await loadComponentFootprintVariants(
    ctx,
    componentRow,
  );

  const pinMap = await loadDefaultFootprintPinMap(ctx, componentRow);

  return {
    component: mapComponent(componentRow),
    symbol: parseSymbolPlacementSnapshot(symbolRow),
    footprint: parseFootprintPlacementSnapshot(
      footprintRow,
      footprintModelRow,
      pinMap,
    ),
    footprintVariants,
    resolvedAt: new Date().toISOString(),
  };
}

export async function getSymbol(
  ctx: CoreBackendModuleContext,
  symbolId: string,
): Promise<LibrarySymbol | null> {
  const db = getDb(ctx);
  const row = await db
    .select()
    .from(symbols)
    .where(eq(symbols.id, symbolId))
    .get();
  return row ? mapSymbol(row) : null;
}

/**
 * Load just the data needed to render a symbol preview: the parsed
 * {@link SymbolRenderModel} and the row's content_sha256 (for caching).
 * Returns null when the symbol doesn't exist or lacks a renderable preview.
 */
export async function loadSymbolPreviewModel(
  ctx: CoreBackendModuleContext,
  symbolId: string,
): Promise<{
  model: SymbolRenderModel;
  contentSha256: string | null;
  name: string;
} | null> {
  const db = getDb(ctx);
  const row = await db
    .select()
    .from(symbols)
    .where(eq(symbols.id, symbolId))
    .get();
  if (!row) return null;
  const data = parseJsonObject(row.dataJson);
  const normalized = asRecord(data.normalized);
  const previewRaw = normalized?.preview;
  if (!isSymbolRenderModel(previewRaw)) return null;
  return {
    model: previewRaw,
    contentSha256: row.contentSha256 ?? null,
    name: row.name,
  };
}

/**
 * Load the {@link FootprintRenderModel} for a footprint by id. Returns null
 * when the footprint doesn't exist or lacks a renderable preview (symbol-only
 * components have placeholder footprints without geometry).
 */
export async function loadFootprintPreviewModel(
  ctx: CoreBackendModuleContext,
  footprintId: string,
): Promise<{
  model: FootprintRenderModel;
  contentSha256: string | null;
  name: string;
} | null> {
  const db = getDb(ctx);
  const row = await db
    .select()
    .from(footprints)
    .where(eq(footprints.id, footprintId))
    .get();
  if (!row) return null;
  const data = parseJsonObject(row.dataJson);
  const normalized = asRecord(data.normalized);
  const previewRaw = normalized?.preview;
  if (!isFootprintRenderModel(previewRaw)) return null;
  return {
    model: previewRaw,
    contentSha256: row.contentSha256 ?? null,
    name: row.name,
  };
}

export async function getFootprint(
  ctx: CoreBackendModuleContext,
  footprintId: string,
): Promise<LibraryFootprint | null> {
  const db = getDb(ctx);
  const row = await db
    .select()
    .from(footprints)
    .where(eq(footprints.id, footprintId))
    .get();
  return row ? mapFootprint(row) : null;
}

function mapFootprintModelRecord(row: FootprintModelRow): FootprintModelRecord {
  return {
    footprintId: row.footprintId,
    status: row.status,
    hasModel: Boolean(row.glbPath && row.glbSha256),
    glbSha256: row.glbSha256,
    sourceStepSha256: row.sourceStepSha256,
    sourceFilename: row.sourceFilename,
    modelRef: parseOptionalJson(row.modelRefJson),
    byteSize: row.byteSize,
    errorMessage: row.errorMessage,
    glbPath: row.glbPath,
    sourceStepPath: row.sourceStepPath,
    sourceByteSize: row.sourceByteSize,
    tessellationParams: parseOptionalJson(row.tessellationParamsJson),
    converterVersion: row.converterVersion,
  };
}

export function toFootprintModelMetadata(
  record: FootprintModelRecord | null,
): FootprintModelMetadata {
  if (!record) {
    return {
      status: "missing",
      hasModel: false,
      glbSha256: null,
      sourceStepSha256: null,
      sourceFilename: null,
      modelRef: null,
      byteSize: null,
      errorMessage: null,
    };
  }

  return {
    status: record.status,
    hasModel: record.hasModel,
    glbSha256: record.glbSha256,
    sourceStepSha256: record.sourceStepSha256,
    sourceFilename: record.sourceFilename,
    modelRef: record.modelRef,
    byteSize: record.byteSize,
    errorMessage: record.errorMessage,
  };
}

export async function getFootprintModelRecord(
  ctx: CoreBackendModuleContext,
  footprintId: string,
): Promise<FootprintModelRecord | null> {
  const db = getDb(ctx);
  const row = await db
    .select()
    .from(footprintModels)
    .where(eq(footprintModels.footprintId, footprintId))
    .get();
  return row ? mapFootprintModelRecord(row) : null;
}

export async function getFootprintModelMetadata(
  ctx: CoreBackendModuleContext,
  footprintId: string,
): Promise<FootprintModelMetadata> {
  return toFootprintModelMetadata(
    await getFootprintModelRecord(ctx, footprintId),
  );
}

export function upsertFootprintModelRecord(
  ctx: CoreBackendModuleContext,
  input: UpsertFootprintModelInput,
): FootprintModelMetadata {
  const db = getDb(ctx);
  const now = new Date().toISOString();

  db.transaction((tx) => {
    const txDb = tx as typeof db;
    const existing = txDb
      .select({ createdAt: footprintModels.createdAt })
      .from(footprintModels)
      .where(eq(footprintModels.footprintId, input.footprintId))
      .get();

    txDb
      .delete(footprintModels)
      .where(eq(footprintModels.footprintId, input.footprintId))
      .run();
    txDb
      .insert(footprintModels)
      .values({
        footprintId: input.footprintId,
        status: "ready",
        glbPath: input.glbPath,
        glbSha256: input.glbSha256,
        sourceStepPath: input.sourceStepPath,
        sourceStepSha256: input.sourceStepSha256,
        sourceFilename: input.sourceFilename,
        sourceByteSize: input.sourceByteSize,
        modelRefJson: input.modelRefJson,
        tessellationParamsJson: input.tessellationParamsJson,
        converterVersion: input.converterVersion,
        byteSize: input.byteSize,
        errorMessage: null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      .run();
  });

  return {
    status: "ready",
    hasModel: true,
    glbSha256: input.glbSha256,
    sourceStepSha256: input.sourceStepSha256,
    sourceFilename: input.sourceFilename,
    modelRef: parseOptionalJson(input.modelRefJson),
    byteSize: input.byteSize,
    errorMessage: null,
  };
}

export async function markFootprintModelConversionFailed(
  ctx: CoreBackendModuleContext,
  footprintId: string,
  errorMessage: string,
): Promise<FootprintModelMetadata> {
  const db = getDb(ctx);
  const existing = await getFootprintModelRecord(ctx, footprintId);
  if (!existing) {
    throw new ValidationError("Footprint model record not found");
  }

  db.update(footprintModels)
    .set({
      status: "failed",
      glbPath: null,
      glbSha256: null,
      byteSize: null,
      errorMessage,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(footprintModels.footprintId, footprintId))
    .run();

  return toFootprintModelMetadata({
    ...existing,
    status: "failed",
    glbPath: null,
    glbSha256: null,
    byteSize: null,
    errorMessage,
  });
}

export function deleteFootprintModelRecord(
  ctx: CoreBackendModuleContext,
  footprintId: string,
): void {
  const db = getDb(ctx);
  db.delete(footprintModels)
    .where(eq(footprintModels.footprintId, footprintId))
    .run();
}

export interface DeleteComponentsResult {
  deletedComponents: number;
  deletedSymbols: number;
  deletedFootprints: number;
}

/**
 * Read-only invariant for built-in components: any PATCH/PUT/DELETE on a row
 * with `is_builtin = 1` MUST be rejected. Clients clone via the dedicated
 * clone path before mutating. Call this from every library route that mutates
 * an existing `library_components` row by id.
 */
export function assertNotBuiltinComponents(
  ctx: CoreBackendModuleContext,
  ids: string[],
  action: "delete" | "update" | "modify" = "modify",
): void {
  if (ids.length === 0) return;
  const db = getDb(ctx);
  const hits = db
    .select({
      id: components.id,
      name: components.name,
      isBuiltin: components.isBuiltin,
    })
    .from(components)
    .where(inArray(components.id, ids))
    .all()
    .filter((row) => Boolean(row.isBuiltin));
  if (hits.length === 0) return;
  const names = hits.map((row) => row.name).join(", ");
  throw new ValidationError(
    `Cannot ${action} built-in components (${names}). Use "Duplicate to my library" to create an editable copy.`,
  );
}

export function assertFootprintNotBuiltinComponent(
  ctx: CoreBackendModuleContext,
  footprintId: string,
  action: "delete" | "update" | "modify" = "modify",
): void {
  const db = getDb(ctx);
  const variantRows = db
    .select({ componentId: componentFootprints.componentId })
    .from(componentFootprints)
    .where(eq(componentFootprints.footprintId, footprintId))
    .all();
  const ids = [
    ...new Set([
      ...variantRows.map((row) => row.componentId),
      ...db
        .select({ id: components.id })
        .from(components)
        .where(eq(components.footprintId, footprintId))
        .all()
        .map((row) => row.id),
    ]),
  ];
  assertNotBuiltinComponents(ctx, ids, action);
}

export interface CloneComponentResult {
  componentId: string;
  componentName: string;
}

/**
 * Clones a component into an editable user-owned copy. Reuses the source
 * symbol/footprint rows (clone-on-edit is deferred — the user can re-import or
 * use the symbol editor later to materialize an own copy). Strips the
 * `builtin`/`system` tags and adds `user`. Always sets `is_builtin = 0`.
 */
export function cloneComponent(
  ctx: CoreBackendModuleContext,
  sourceId: string,
): CloneComponentResult | null {
  const db = getDb(ctx);
  const source = db
    .select()
    .from(components)
    .where(eq(components.id, sourceId))
    .get();
  if (!source) {
    return null;
  }

  const sourceTags = parseJsonStringArray(source.tagsJson);
  const cleanedTags = sourceTags
    .map((tag) => tag.trim())
    .filter((tag) => {
      const lowered = tag.toLowerCase();
      return tag.length > 0 && lowered !== "builtin" && lowered !== "system";
    });
  if (!cleanedTags.some((tag) => tag.toLowerCase() === "user")) {
    cleanedTags.push("user");
  }

  const now = new Date().toISOString();
  const newComponentId = crypto.randomUUID();
  const newComponentName = `${source.name} (Copy)`;
  const originJson =
    source.sourceId && source.version
      ? JSON.stringify({
          libraryId: source.sourceId,
          componentId: source.id,
          componentVersion: source.version,
        })
      : null;

  db.insert(components)
    .values({
      id: newComponentId,
      name: newComponentName,
      description: source.description,
      symbolId: source.symbolId,
      footprintId: source.footprintId,
      tagsJson: JSON.stringify(cleanedTags),
      createdAt: now,
      isBuiltin: 0,
      sourceId: "user.local",
      version: "1.0.0",
      uuid: newComponentId,
      contentSha256: null,
      originJson,
    })
    .run();

  return { componentId: newComponentId, componentName: newComponentName };
}

export function deleteComponents(
  ctx: CoreBackendModuleContext,
  ids: string[],
): DeleteComponentsResult {
  if (ids.length === 0) {
    return { deletedComponents: 0, deletedSymbols: 0, deletedFootprints: 0 };
  }

  const db = getDb(ctx);

  assertNotBuiltinComponents(ctx, ids, "delete");

  let summary: DeleteComponentsResult = {
    deletedComponents: 0,
    deletedSymbols: 0,
    deletedFootprints: 0,
  };

  db.transaction((tx) => {
    const transactionalDb = tx as typeof db;

    // Collect symbol/footprint IDs referenced by the components to delete
    const toDelete = transactionalDb
      .select({
        symbolId: components.symbolId,
        footprintId: components.footprintId,
      })
      .from(components)
      .where(inArray(components.id, ids))
      .all();

    const symbolIds = [...new Set(toDelete.map((r) => r.symbolId))];
    const footprintIds = [...new Set(toDelete.map((r) => r.footprintId))];

    // Delete the components
    transactionalDb.delete(components).where(inArray(components.id, ids)).run();

    // Delete orphaned symbols (not referenced by any remaining component)
    let deletedSymbols = 0;
    for (const symbolId of symbolIds) {
      const still = transactionalDb
        .select({ id: components.id })
        .from(components)
        .where(eq(components.symbolId, symbolId))
        .get();
      if (!still) {
        transactionalDb.delete(symbols).where(eq(symbols.id, symbolId)).run();
        deletedSymbols++;
      }
    }

    // Delete orphaned footprints
    let deletedFootprints = 0;
    for (const footprintId of footprintIds) {
      const still = transactionalDb
        .select({ id: components.id })
        .from(components)
        .where(eq(components.footprintId, footprintId))
        .get();
      if (!still) {
        transactionalDb
          .delete(footprints)
          .where(eq(footprints.id, footprintId))
          .run();
        deletedFootprints++;
      }
    }

    summary = {
      deletedComponents: toDelete.length,
      deletedSymbols,
      deletedFootprints,
    };
  });

  return summary;
}

const SYSTEM_TAGS = new Set([
  "builtin",
  "system",
  "core",
  "drawn-footprint",
  "placeholder-footprint",
]);

function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeTagList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const tag = normalizeTag(raw);
    if (tag.length === 0 || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

export async function listTags(
  ctx: CoreBackendModuleContext,
  options: LibraryListTagsOptions = {},
): Promise<LibraryTagStat[]> {
  const db = getDb(ctx);
  const rows = await db
    .select({ tagsJson: components.tagsJson })
    .from(components)
    .all();
  const counts = new Map<string, number>();
  for (const row of rows) {
    const tags = parseJsonStringArray(row.tagsJson);
    const dedup = new Set<string>();
    for (const tag of tags) {
      const normalized = normalizeTag(tag);
      if (!normalized) continue;
      if (options.excludeSystem && SYSTEM_TAGS.has(normalized)) continue;
      if (dedup.has(normalized)) continue;
      dedup.add(normalized);
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }
  const out: LibraryTagStat[] = Array.from(counts.entries()).map(
    ([tag, count]) => ({ tag, count }),
  );
  out.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.tag.localeCompare(b.tag);
  });
  return out;
}

/**
 * Tag filters prefixed with `source:` target the Source facet (e.g.
 * `source:openpcb.core`). This keeps the wire format a single `tags` list
 * without proliferating bucket-specific query params.
 */
const SOURCE_TAG_PREFIX = "source:";

interface NormalizedComponentForFacets {
  id: string;
  nameLc: string;
  descriptionLc: string;
  family: Set<string>;
  package: Set<string>;
  mount: Set<string>;
  other: Set<string>;
  sourceKey: string;
  sourceLabel: string;
}

/**
 * Extract `mountType` from a footprint's `dataJson` blob. The canonical
 * location is `normalized.mountType`; the legacy fallback is the top-level
 * `mountType` field. Returns null if neither path resolves to a recognised
 * mount value.
 */
function extractMountType(footprintDataJson: string | null): string | null {
  if (!footprintDataJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(footprintDataJson);
  } catch {
    return null;
  }
  const root = asRecord(parsed);
  if (!root) return null;
  const normalized = asRecord(root.normalized);
  const mount =
    asString(normalized?.mountType) ?? asString(root.mountType) ?? null;
  if (!mount) return null;
  const lc = mount.trim().toLowerCase();
  return lc.length > 0 ? lc : null;
}

function normalizeForFacets(
  row: {
    tagsJson: string;
    name: string;
    description: string;
    isBuiltin: number;
    sourceId: string | null;
    id: string;
  },
  sourceName: string | null,
  footprintMountType: string | null,
): NormalizedComponentForFacets {
  const family = new Set<string>();
  const pkg = new Set<string>();
  const mount = new Set<string>();
  const other = new Set<string>();
  for (const raw of parseJsonStringArray(row.tagsJson)) {
    const tag = raw.trim().toLowerCase();
    if (!tag) continue;
    switch (bucketTag(tag)) {
      case "family":
        family.add(tag);
        break;
      case "package":
        pkg.add(tag);
        break;
      case "mount":
        mount.add(tag);
        break;
      case "other":
        other.add(tag);
        break;
      // "system" tags ignored — they don't appear in facets.
    }
  }
  // Default-footprint mountType is the canonical signal even when the
  // component carries no explicit "smd"/"tht" tag.
  if (footprintMountType) {
    mount.add(footprintMountType);
  }
  const isBuiltin = row.isBuiltin === 1;
  const sourceKey = row.sourceId ?? (isBuiltin ? "core" : "user");
  const sourceLabel =
    sourceName ?? (isBuiltin ? "Core" : (row.sourceId ?? "User"));
  return {
    id: row.id,
    nameLc: row.name.toLowerCase(),
    descriptionLc: row.description.toLowerCase(),
    family,
    package: pkg,
    mount,
    other,
    sourceKey,
    sourceLabel,
  };
}

export async function computeFacets(
  ctx: CoreBackendModuleContext,
  params: LibraryFacetParams = {},
): Promise<LibraryFacets> {
  const db = getDb(ctx);
  const rows = await db
    .select({
      id: components.id,
      name: components.name,
      description: components.description,
      tagsJson: components.tagsJson,
      isBuiltin: components.isBuiltin,
      sourceId: components.sourceId,
      footprintId: components.footprintId,
      sourceName: sources.name,
      footprintDataJson: footprints.dataJson,
    })
    .from(components)
    .leftJoin(sources, eq(components.sourceId, sources.id))
    .leftJoin(footprints, eq(components.footprintId, footprints.id))
    .all();

  const normalized = rows.map((row) =>
    normalizeForFacets(
      row,
      row.sourceName,
      extractMountType(row.footprintDataJson),
    ),
  );

  const query = params.query?.trim().toLowerCase() ?? "";
  const activeBySource = new Set<string>();
  const activeByFamily = new Set<string>();
  const activeByPackage = new Set<string>();
  const activeByMount = new Set<string>();
  const activeByOther = new Set<string>();
  for (const raw of params.tags ?? []) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if (t.startsWith(SOURCE_TAG_PREFIX)) {
      activeBySource.add(t.slice(SOURCE_TAG_PREFIX.length));
      continue;
    }
    switch (bucketTag(t)) {
      case "family":
        activeByFamily.add(t);
        break;
      case "package":
        activeByPackage.add(t);
        break;
      case "mount":
        activeByMount.add(t);
        break;
      case "other":
        activeByOther.add(t);
        break;
    }
  }

  const matchesQuery = (c: NormalizedComponentForFacets): boolean =>
    !query || c.nameLc.includes(query) || c.descriptionLc.includes(query);

  // Intersection-aware: counts within bucket B are computed against the
  // candidate set filtered by every OTHER bucket's selections.
  const matchesOtherFacets = (
    c: NormalizedComponentForFacets,
    skip: LibraryFacetBucket | null,
  ): boolean => {
    if (
      skip !== "source" &&
      activeBySource.size > 0 &&
      !activeBySource.has(c.sourceKey)
    ) {
      return false;
    }
    if (skip !== "family") {
      for (const t of activeByFamily) if (!c.family.has(t)) return false;
    }
    if (skip !== "package") {
      for (const t of activeByPackage) if (!c.package.has(t)) return false;
    }
    if (skip !== "mount") {
      for (const t of activeByMount) if (!c.mount.has(t)) return false;
    }
    if (skip !== "other") {
      for (const t of activeByOther) if (!c.other.has(t)) return false;
    }
    return true;
  };

  const toSortedList = (
    m: Map<string, { label: string; count: number }>,
  ): LibraryFacetOption[] =>
    Array.from(m.entries())
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const bucketSource = new Map<string, { label: string; count: number }>();
  const bucketFamily = new Map<string, { label: string; count: number }>();
  const bucketPackage = new Map<string, { label: string; count: number }>();
  const bucketMount = new Map<string, { label: string; count: number }>();
  const bucketOther = new Map<string, { label: string; count: number }>();
  let total = 0;

  for (const c of normalized) {
    if (!matchesQuery(c)) continue;

    if (matchesOtherFacets(c, "source")) {
      const cur = bucketSource.get(c.sourceKey) ?? {
        label: c.sourceLabel,
        count: 0,
      };
      cur.count++;
      bucketSource.set(c.sourceKey, cur);
    }
    if (matchesOtherFacets(c, "family")) {
      for (const t of c.family) {
        const cur = bucketFamily.get(t) ?? { label: t, count: 0 };
        cur.count++;
        bucketFamily.set(t, cur);
      }
    }
    if (matchesOtherFacets(c, "package")) {
      for (const t of c.package) {
        const cur = bucketPackage.get(t) ?? { label: t, count: 0 };
        cur.count++;
        bucketPackage.set(t, cur);
      }
    }
    if (matchesOtherFacets(c, "mount")) {
      for (const t of c.mount) {
        const cur = bucketMount.get(t) ?? { label: t, count: 0 };
        cur.count++;
        bucketMount.set(t, cur);
      }
    }
    if (matchesOtherFacets(c, "other")) {
      for (const t of c.other) {
        const cur = bucketOther.get(t) ?? { label: t, count: 0 };
        cur.count++;
        bucketOther.set(t, cur);
      }
    }
    if (matchesOtherFacets(c, null)) {
      total++;
    }
  }

  return {
    source: toSortedList(bucketSource),
    family: toSortedList(bucketFamily),
    package: toSortedList(bucketPackage),
    mount: toSortedList(bucketMount),
    other: toSortedList(bucketOther),
    total,
  };
}

export async function updateComponent(
  ctx: CoreBackendModuleContext,
  componentId: string,
  patch: LibraryUpdateComponentInput,
): Promise<LibraryComponent | null> {
  const db = getDb(ctx);
  const existing = await db
    .select()
    .from(components)
    .where(eq(components.id, componentId))
    .get();
  if (!existing) return null;
  if (existing.isBuiltin) {
    throw new ValidationError(
      `Cannot edit built-in component "${existing.name}". Use "Duplicate to my library" to create an editable copy.`,
    );
  }

  const updates: Partial<typeof components.$inferInsert> = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (trimmed.length === 0) {
      throw new ValidationError("name must be a non-empty string");
    }
    if (trimmed.length > 200) {
      throw new ValidationError("name must be 200 characters or fewer");
    }
    updates.name = trimmed;
  }
  if (patch.description !== undefined) {
    if (typeof patch.description !== "string") {
      throw new ValidationError("description must be a string");
    }
    if (patch.description.length > 2000) {
      throw new ValidationError("description must be 2000 characters or fewer");
    }
    updates.description = patch.description;
  }
  if (patch.tags !== undefined) {
    if (!Array.isArray(patch.tags)) {
      throw new ValidationError("tags must be an array of strings");
    }
    updates.tagsJson = JSON.stringify(normalizeTagList(patch.tags));
  }

  if (Object.keys(updates).length === 0) {
    return mapComponent(existing);
  }

  db.update(components)
    .set(updates)
    .where(eq(components.id, componentId))
    .run();

  const refreshed = await db
    .select()
    .from(components)
    .where(eq(components.id, componentId))
    .get();
  return refreshed ? mapComponent(refreshed) : null;
}

export interface LibrarySourceSummary {
  id: string;
  name: string;
  kind: string;
  isReadOnly: boolean;
  license: string | null;
  homepage: string | null;
  createdAt: string;
  latestVersion: string | null;
  latestChannel: string | null;
  latestInstalledAt: string | null;
  latestSignatureValid: boolean;
  latestInstallOrigin: string | null;
  componentCount: number;
}

export function listSourcesWithReleases(
  ctx: CoreBackendModuleContext,
): LibrarySourceSummary[] {
  const db = getDb(ctx);
  const sourceRows = db.select().from(sources).all();
  const releaseRows = db.select().from(releases).all();
  const counts = db
    .select({
      sourceId: components.sourceId,
      isBuiltin: components.isBuiltin,
      count: sql<number>`count(*)`,
    })
    .from(components)
    .groupBy(components.sourceId, components.isBuiltin)
    .all();
  const countBySource = new Map<string, number>();
  for (const row of counts) {
    const sourceId =
      row.sourceId ?? (row.isBuiltin === 1 ? "openpcb.core" : "user.local");
    countBySource.set(sourceId, (countBySource.get(sourceId) ?? 0) + row.count);
  }

  const releasesBySource = new Map<string, typeof releaseRows>();
  for (const r of releaseRows) {
    const list = releasesBySource.get(r.sourceId) ?? [];
    list.push(r);
    releasesBySource.set(r.sourceId, list);
  }

  return sourceRows.map((s) => {
    const list = releasesBySource.get(s.id) ?? [];
    list.sort((a, b) => b.installedAt.localeCompare(a.installedAt));
    const latest = list[0];
    return {
      id: s.id,
      name: s.name,
      kind: s.kind,
      isReadOnly: s.isReadOnly === 1,
      license: s.license,
      homepage: s.homepage,
      createdAt: s.createdAt,
      latestVersion: latest?.version ?? null,
      latestChannel: latest?.channel ?? null,
      latestInstalledAt: latest?.installedAt ?? null,
      latestSignatureValid: latest?.signatureValid === 1,
      latestInstallOrigin: latest?.installOrigin ?? null,
      componentCount: countBySource.get(s.id) ?? 0,
    };
  });
}

export function deleteSource(
  ctx: CoreBackendModuleContext,
  sourceId: string,
): { removed: number } {
  const db = getDb(ctx);
  const source = db
    .select()
    .from(sources)
    .where(eq(sources.id, sourceId))
    .get();
  if (!source) {
    throw new ValidationError(`source not found: ${sourceId}`);
  }
  if (source.kind === "core") {
    throw new ValidationError(
      `cannot delete core source ${sourceId}; ship a new bundled package to replace it`,
    );
  }

  let removed = 0;
  db.transaction((tx) => {
    const txDb = tx as typeof db;
    const componentIds = txDb
      .select({ id: components.id })
      .from(components)
      .where(eq(components.sourceId, sourceId))
      .all()
      .map((r) => r.id);
    if (componentIds.length > 0) {
      txDb
        .delete(componentFootprints)
        .where(inArray(componentFootprints.componentId, componentIds))
        .run();
      const del = txDb
        .delete(components)
        .where(inArray(components.id, componentIds))
        .run();
      removed =
        (del as unknown as { changes?: number }).changes ?? componentIds.length;
    }
    txDb.delete(symbols).where(eq(symbols.sourceId, sourceId)).run();
    txDb.delete(footprints).where(eq(footprints.sourceId, sourceId)).run();
    txDb.delete(releases).where(eq(releases.sourceId, sourceId)).run();
    txDb.delete(sources).where(eq(sources.id, sourceId)).run();
  });
  return { removed };
}

export function buildSdk(ctx: CoreBackendModuleContext): LibrarySDK {
  return {
    resolveComponent: (componentId) => resolveComponent(ctx, componentId),
    getSymbol: (symbolId) => getSymbol(ctx, symbolId),
    getFootprint: (footprintId) => getFootprint(ctx, footprintId),
    getComponentDetail: (componentId) => getComponentDetail(ctx, componentId),
    searchComponents: (params) => searchComponents(ctx, params),
    resolveComponentForPlacement: (componentId) =>
      resolveComponentForPlacement(ctx, componentId),
    listTags: (options) => listTags(ctx, options),
    updateComponent: (componentId, patch) =>
      updateComponent(ctx, componentId, patch),
  };
}
