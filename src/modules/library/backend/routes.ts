import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import type {
  CoreBackendModuleContext,
  ModuleRouterHandle,
} from "../../../core/contracts/modules/backend-module";
import { eq, or, sql } from "drizzle-orm";
import { NotFoundError, ValidationError } from "../../../core/contracts/errors";
import {
  getDb,
  getComponentDetail,
  cloneComponent,
  deleteComponents,
  listTags,
  resolveComponent,
  assertFootprintNotBuiltinComponent,
  deleteFootprintModelRecord,
  getSymbol,
  getFootprint,
  getFootprintModelMetadata,
  getFootprintModelRecord,
  markFootprintModelConversionFailed,
  searchComponents,
  toFootprintModelMetadata,
  updateComponent,
  upsertFootprintModelRecord,
} from "./queries";
import {
  deleteModel,
  modelAssetRelativePath,
  readGlb,
  readSourceStep,
  writeGlb,
  writeSourceStep,
} from "./services/footprint-model-store";
import { components, footprintModels, footprints } from "./schema";
import {
  decodeTextEntry,
  extractZipEntries,
} from "./import/archive/extract-zip";
import { commitKicadImport } from "./import/commit-kicad";
import { commitKicadZipImport } from "./import/commit-kicad-zip";
import {
  commitGeneratedImport,
  type CommitGeneratedRequest,
} from "./import/commit-generated";
import {
  commitDrawnImport,
  type CommitDrawnRequest,
} from "./import/commit-drawn";
import { buildInspectResponse } from "./import/inspect-kicad";
import type { CommitKicadRequest, InspectKicadRequest } from "./import/types";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readStringField(
  record: Record<string, unknown>,
  key: string,
  fieldPath: string,
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldPath} must be a string`);
  }
  return value;
}

const GLB_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;
const STEP_SIZE_LIMIT_BYTES = 25 * 1024 * 1024;
const SHA256_HEX = /^[a-fA-F0-9]{64}$/;
const BUNDLE_MANIFEST_PATH = "manifest.json";
const ZIP_CRC32_TABLE = buildCrc32Table();

interface ModelBundleManifestEntry {
  footprintId: string;
  sourceStepSha256: string | null;
  glbSha256: string;
  sourceRelativePath: string | null;
  glbRelativePath: string;
  modelRefJson: string | null;
  tessellationParamsJson: string | null;
  converterVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ModelBundleManifest {
  version: 1;
  entries: ModelBundleManifestEntry[];
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (ZIP_CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUInt16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function writeUInt32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function createZipArchive(
  entries: Array<{ name: string; bytes: Uint8Array }>,
): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const compressed = new Uint8Array(deflateRawSync(entry.bytes));
    const checksum = crc32(entry.bytes);
    const localHeader = concatBytes([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0x0800),
      writeUInt16(8),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(checksum),
      writeUInt32(compressed.byteLength),
      writeUInt32(entry.bytes.byteLength),
      writeUInt16(nameBytes.byteLength),
      writeUInt16(0),
      nameBytes,
    ]);
    localParts.push(localHeader, compressed);

    centralParts.push(
      concatBytes([
        writeUInt32(0x02014b50),
        writeUInt16(20),
        writeUInt16(20),
        writeUInt16(0x0800),
        writeUInt16(8),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt32(checksum),
        writeUInt32(compressed.byteLength),
        writeUInt32(entry.bytes.byteLength),
        writeUInt16(nameBytes.byteLength),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt32(0),
        writeUInt32(offset),
        nameBytes,
      ]),
    );
    offset += localHeader.byteLength + compressed.byteLength;
  }

  const local = concatBytes(localParts);
  const central = concatBytes(centralParts);
  const end = concatBytes([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(entries.length),
    writeUInt16(entries.length),
    writeUInt32(central.byteLength),
    writeUInt32(local.byteLength),
    writeUInt16(0),
  ]);
  return concatBytes([local, central, end]);
}

function normalizeSha256(value: string, field: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!SHA256_HEX.test(trimmed)) {
    throw new ValidationError(
      `${field} must be a 64-character SHA-256 hex string`,
    );
  }
  return trimmed;
}

function validateHashMatches(
  bytes: Uint8Array,
  expectedSha256: string,
  field: string,
): void {
  const actual = hashBytes(bytes);
  if (actual !== expectedSha256) {
    throw new ValidationError(
      `${field} SHA-256 mismatch: expected ${expectedSha256}, received ${actual}`,
    );
  }
}

function readFormString(formData: FormData, field: string): string {
  const value = formData.get(field);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function readOptionalFormString(
  formData: FormData,
  field: string,
): string | null {
  const value = formData.get(field);
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readJsonFormString(formData: FormData, field: string): string | null {
  const value = readOptionalFormString(formData, field);
  if (value === null) {
    return null;
  }
  try {
    JSON.parse(value);
  } catch {
    throw new ValidationError(`${field} must be valid JSON`);
  }
  return value;
}

function validateSourceFilename(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed !== path.basename(trimmed) ||
    trimmed.includes("..")
  ) {
    throw new ValidationError("sourceFilename must be a filename, not a path");
  }
  return trimmed;
}

async function readFileBytes(
  formData: FormData,
  field: string,
  limitBytes: number,
): Promise<{ file: File; bytes: Uint8Array }> {
  const file = formData.get(field);
  if (!(file instanceof File)) {
    throw new ValidationError(`${field} must be a file upload`);
  }
  if (file.size > limitBytes) {
    throw new ValidationError(`${field} exceeds ${limitBytes} bytes`);
  }
  return { file, bytes: new Uint8Array(await file.arrayBuffer()) };
}

const GLB_MAGIC = new Uint8Array([0x67, 0x6c, 0x54, 0x46]); // "glTF"

function validateGlbMagic(bytes: Uint8Array, field: string): void {
  if (bytes.byteLength < GLB_MAGIC.length) {
    throw new ValidationError(`${field} is too small to be a GLB`);
  }
  for (let i = 0; i < GLB_MAGIC.length; i += 1) {
    if (bytes[i] !== GLB_MAGIC[i]) {
      throw new ValidationError(`${field} must start with glTF magic bytes`);
    }
  }
}

function validateStepMagic(bytes: Uint8Array, field: string): void {
  // STEP files (ISO 10303-21) start with the literal "ISO-10303-21" within the
  // first ~64 bytes. UTF-8/ASCII compatible decoding is fine here.
  const probe = bytes.subarray(0, Math.min(bytes.byteLength, 64));
  const text = new TextDecoder("utf-8", { fatal: false }).decode(probe);
  if (!text.includes("ISO-10303-21")) {
    throw new ValidationError(
      `${field} must be a STEP file (ISO-10303-21 marker not found)`,
    );
  }
}

function resolveUserDataRoot(): string {
  const explicitDbPath = process.env.OPENPCB_DB_PATH;
  if (explicitDbPath && explicitDbPath.length > 0) {
    return path.dirname(path.resolve(explicitDbPath));
  }
  if (process.env.NODE_ENV === "development") {
    return path.resolve(process.cwd(), "dev-data");
  }
  return path.join(os.homedir(), ".openpcb");
}

function resolveStoredModelPath(
  relativePath: string,
  expectedSuffix: string,
): string {
  const normalized = path.posix.normalize(relativePath);
  if (
    normalized !== relativePath ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    path.isAbsolute(relativePath) ||
    !normalized.endsWith(expectedSuffix)
  ) {
    throw new ValidationError("Stored model path is invalid");
  }

  const root = resolveUserDataRoot();
  const absolutePath = path.resolve(root, normalized);
  const modelRoot = path.resolve(root, "models");
  if (!absolutePath.startsWith(`${modelRoot}${path.sep}`)) {
    throw new ValidationError(
      "Stored model path must stay inside model storage",
    );
  }
  return absolutePath;
}

async function parseModelUploadBody(req: Request): Promise<{
  glbBytes: Uint8Array;
  glbSha256: string;
  sourceStepBytes: Uint8Array | null;
  sourceStepSha256: string | null;
  sourceFilename: string | null;
  modelRefJson: string | null;
  tessellationParamsJson: string | null;
  converterVersion: string | null;
}> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    throw new ValidationError("Request body must be multipart/form-data");
  }

  const { bytes: glbBytes } = await readFileBytes(
    formData,
    "glb",
    GLB_SIZE_LIMIT_BYTES,
  );
  validateGlbMagic(glbBytes, "glb");
  const glbSha256 = normalizeSha256(
    readFormString(formData, "sha256"),
    "sha256",
  );
  validateHashMatches(glbBytes, glbSha256, "glb");

  const sourceStepValue = formData.get("sourceStep");
  const sourceStepSha256Raw = readOptionalFormString(
    formData,
    "sourceStepSha256",
  );
  let sourceStepBytes: Uint8Array | null = null;
  let sourceStepSha256: string | null = null;
  let sourceFilename: string | null = null;

  if (sourceStepValue !== null && sourceStepValue !== undefined) {
    if (!(sourceStepValue instanceof File)) {
      throw new ValidationError("sourceStep must be a file upload");
    }
    if (sourceStepValue.size > STEP_SIZE_LIMIT_BYTES) {
      throw new ValidationError(
        `sourceStep exceeds ${STEP_SIZE_LIMIT_BYTES} bytes`,
      );
    }
    if (!sourceStepSha256Raw) {
      throw new ValidationError("sourceStepSha256 must be a non-empty string");
    }
    sourceStepSha256 = normalizeSha256(sourceStepSha256Raw, "sourceStepSha256");
    sourceStepBytes = new Uint8Array(await sourceStepValue.arrayBuffer());
    validateStepMagic(sourceStepBytes, "sourceStep");
    validateHashMatches(sourceStepBytes, sourceStepSha256, "sourceStep");
    sourceFilename = validateSourceFilename(
      readOptionalFormString(formData, "sourceFilename") ??
        sourceStepValue.name,
    );
  } else {
    sourceStepSha256 = sourceStepSha256Raw
      ? normalizeSha256(sourceStepSha256Raw, "sourceStepSha256")
      : null;
    const explicitFilename = readOptionalFormString(formData, "sourceFilename");
    sourceFilename = explicitFilename
      ? validateSourceFilename(explicitFilename)
      : null;
  }

  return {
    glbBytes,
    glbSha256,
    sourceStepBytes,
    sourceStepSha256,
    sourceFilename,
    modelRefJson: readJsonFormString(formData, "modelRefJson"),
    tessellationParamsJson: readJsonFormString(
      formData,
      "tessellationParamsJson",
    ),
    converterVersion: readOptionalFormString(formData, "converterVersion"),
  };
}

function parseDeleteIdsBody(value: unknown): string[] {
  if (!isRecord(value)) {
    throw new ValidationError("Request body must be an object");
  }
  const idsRaw = value.ids;
  if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
    throw new ValidationError("ids must be a non-empty array of strings");
  }

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of idsRaw) {
    if (typeof entry !== "string") {
      throw new ValidationError("All ids must be strings");
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      throw new ValidationError("Component ids must not be empty");
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    ids.push(trimmed);
  }

  if (ids.length === 0) {
    throw new ValidationError("ids must include at least one component id");
  }
  return ids;
}

function parseInspectRequestBody(value: unknown): InspectKicadRequest {
  if (!isRecord(value)) {
    throw new ValidationError("Request body must be an object");
  }

  const symbolLibraryRaw = value.symbolLibrary;
  // symbolLibrary is optional: when absent or null, only footprints are parsed.
  // When present, it must be an object with non-empty fileName + content.
  let symbolLibrary: InspectKicadRequest["symbolLibrary"] = null;
  if (symbolLibraryRaw !== undefined && symbolLibraryRaw !== null) {
    if (!isRecord(symbolLibraryRaw)) {
      throw new ValidationError("symbolLibrary must be an object");
    }
    symbolLibrary = {
      fileName: readStringField(
        symbolLibraryRaw,
        "fileName",
        "symbolLibrary.fileName",
      ),
      content: readStringField(
        symbolLibraryRaw,
        "content",
        "symbolLibrary.content",
      ),
    };
  }

  const footprintsRaw = value.footprints;
  if (!Array.isArray(footprintsRaw)) {
    throw new ValidationError("footprints must be an array");
  }

  const footprints = footprintsRaw.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new ValidationError(`footprints[${index}] must be an object`);
    }
    return {
      fileName: readStringField(
        entry,
        "fileName",
        `footprints[${index}].fileName`,
      ),
      content: readStringField(
        entry,
        "content",
        `footprints[${index}].content`,
      ),
    };
  });

  const model3dFilesRaw = value.model3dFiles;
  const model3dFiles = Array.isArray(model3dFilesRaw)
    ? model3dFilesRaw.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new ValidationError(`model3dFiles[${index}] must be an object`);
        }
        return {
          fileName: readStringField(
            entry,
            "fileName",
            `model3dFiles[${index}].fileName`,
          ),
        };
      })
    : undefined;

  return { symbolLibrary, footprints, model3dFiles };
}

function parseCommitRequestBody(value: unknown): CommitKicadRequest {
  const inspect = parseInspectRequestBody(value);
  if (!isRecord(value)) {
    throw new ValidationError("Request body must be an object");
  }

  const selectionRaw = value.selection;
  if (!isRecord(selectionRaw)) {
    throw new ValidationError("selection must be an object");
  }

  const componentRaw = value.component;
  if (!isRecord(componentRaw)) {
    throw new ValidationError("component must be an object");
  }

  const footprintIdRaw = selectionRaw.footprintId;
  if (
    footprintIdRaw !== undefined &&
    footprintIdRaw !== null &&
    typeof footprintIdRaw !== "string"
  ) {
    throw new ValidationError("selection.footprintId must be a string or null");
  }

  // /imports/kicad commit requires a real symbol library
  if (!inspect.symbolLibrary) {
    throw new ValidationError("symbolLibrary must be an object");
  }

  return {
    symbolLibrary: inspect.symbolLibrary,
    footprints: inspect.footprints,
    selection: {
      symbolId: readStringField(selectionRaw, "symbolId", "selection.symbolId"),
      footprintId:
        typeof footprintIdRaw === "string" || footprintIdRaw === null
          ? footprintIdRaw
          : undefined,
    },
    component: {
      name: readStringField(componentRaw, "name", "component.name"),
      description: readStringField(
        componentRaw,
        "description",
        "component.description",
      ),
      tags: readOptionalTagsField(componentRaw, "tags", "component.tags"),
    },
  };
}

async function parseZipImportBody(req: Request): Promise<{
  fileName: string;
  bytes: Uint8Array;
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
  return { fileName: file.name, bytes };
}

async function buildModelBundle(
  ctx: CoreBackendModuleContext,
): Promise<Uint8Array> {
  const db = getDb(ctx);
  const rows = db
    .select()
    .from(footprintModels)
    .where(eq(footprintModels.status, "ready"))
    .all()
    .filter((row) => row.glbSha256 && row.glbPath);

  const manifest: ModelBundleManifest = { version: 1, entries: [] };
  const files: Array<{ name: string; bytes: Uint8Array }> = [];
  const addedPaths = new Set<string>();

  for (const row of rows) {
    if (!row.glbSha256 || !row.glbPath) continue;
    const glbRelativePath = modelAssetRelativePath("glb", row.glbSha256);
    const sourceStepSha256 = row.sourceStepPath ? row.sourceStepSha256 : null;
    const sourceRelativePath =
      sourceStepSha256 && row.sourceStepPath ? row.sourceStepPath : null;

    manifest.entries.push({
      footprintId: row.footprintId,
      sourceStepSha256,
      glbSha256: row.glbSha256,
      sourceRelativePath,
      glbRelativePath,
      modelRefJson: row.modelRefJson,
      tessellationParamsJson: row.tessellationParamsJson,
      converterVersion: row.converterVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });

    if (!addedPaths.has(glbRelativePath)) {
      files.push({
        name: glbRelativePath,
        bytes: await readGlb(row.glbSha256),
      });
      addedPaths.add(glbRelativePath);
    }
    if (
      sourceStepSha256 &&
      sourceRelativePath &&
      !addedPaths.has(sourceRelativePath)
    ) {
      files.push({
        name: sourceRelativePath,
        bytes: await readSourceStep(sourceStepSha256),
      });
      addedPaths.add(sourceRelativePath);
    }
  }

  const encoder = new TextEncoder();
  return createZipArchive([
    {
      name: BUNDLE_MANIFEST_PATH,
      bytes: encoder.encode(JSON.stringify(manifest, null, 2)),
    },
    ...files,
  ]);
}

function countModelHashReferences(
  ctx: CoreBackendModuleContext,
  sha256: string,
): number {
  const row = getDb(ctx)
    .select({ count: sql<number>`count(*)` })
    .from(footprintModels)
    .where(
      or(
        eq(footprintModels.glbSha256, sha256),
        eq(footprintModels.sourceStepSha256, sha256),
      ),
    )
    .get();
  return Number(row?.count ?? 0);
}

async function deleteModelIfUnreferenced(
  ctx: CoreBackendModuleContext,
  sha256: string,
): Promise<void> {
  if (countModelHashReferences(ctx, sha256) > 0) return;
  await deleteModel(sha256);
}

function readNullableStringField(
  record: Record<string, unknown>,
  key: string,
  fieldPath: string,
): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldPath} must be a string or null`);
  }
  return value;
}

function readManifestDate(
  record: Record<string, unknown>,
  key: string,
  fieldPath: string,
): string {
  const value = readStringField(record, key, fieldPath);
  if (!Number.isFinite(Date.parse(value))) {
    throw new ValidationError(`${fieldPath} must be an ISO date string`);
  }
  return value;
}

function readManifestJsonString(
  record: Record<string, unknown>,
  key: string,
  fieldPath: string,
): string | null {
  const value = readNullableStringField(record, key, fieldPath);
  if (value === null) return null;
  try {
    JSON.parse(value);
  } catch {
    throw new ValidationError(`${fieldPath} must be valid JSON or null`);
  }
  return value;
}

function readBundleEntry(
  value: unknown,
  index: number,
): ModelBundleManifestEntry {
  if (!isRecord(value)) {
    throw new ValidationError(`entries[${index}] must be an object`);
  }
  const fieldPath = (field: string) => `entries[${index}].${field}`;
  const sourceStepSha256 = readNullableStringField(
    value,
    "sourceStepSha256",
    fieldPath("sourceStepSha256"),
  );
  const glbSha256 = normalizeSha256(
    readStringField(value, "glbSha256", fieldPath("glbSha256")),
    fieldPath("glbSha256"),
  );
  const sourceRelativePath = readNullableStringField(
    value,
    "sourceRelativePath",
    fieldPath("sourceRelativePath"),
  );

  return {
    footprintId: readStringField(
      value,
      "footprintId",
      fieldPath("footprintId"),
    ),
    sourceStepSha256: sourceStepSha256
      ? normalizeSha256(sourceStepSha256, fieldPath("sourceStepSha256"))
      : null,
    glbSha256,
    sourceRelativePath,
    glbRelativePath: readStringField(
      value,
      "glbRelativePath",
      fieldPath("glbRelativePath"),
    ),
    modelRefJson: readManifestJsonString(
      value,
      "modelRefJson",
      fieldPath("modelRefJson"),
    ),
    tessellationParamsJson: readManifestJsonString(
      value,
      "tessellationParamsJson",
      fieldPath("tessellationParamsJson"),
    ),
    converterVersion: readNullableStringField(
      value,
      "converterVersion",
      fieldPath("converterVersion"),
    ),
    createdAt: readManifestDate(value, "createdAt", fieldPath("createdAt")),
    updatedAt: readManifestDate(value, "updatedAt", fieldPath("updatedAt")),
  };
}

function readBundleManifest(value: unknown): ModelBundleManifest {
  if (!isRecord(value)) {
    throw new ValidationError("manifest.json must contain an object");
  }
  if (value.version !== 1) {
    throw new ValidationError("manifest.json version must be 1");
  }
  if (!Array.isArray(value.entries)) {
    throw new ValidationError("manifest.json entries must be an array");
  }
  return { version: 1, entries: value.entries.map(readBundleEntry) };
}

function parseBundleManifest(text: string): ModelBundleManifest {
  try {
    return readBundleManifest(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("manifest.json must be valid JSON");
  }
}

function assertRelativeAssetPath(
  actual: string | null,
  expected: string | null,
  field: string,
): void {
  if (actual !== expected) {
    throw new ValidationError(`${field} must be ${expected ?? "null"}`);
  }
}

function findBundleEntry(
  entries: Map<string, Uint8Array>,
  relativePath: string,
): Uint8Array {
  const bytes = entries.get(relativePath);
  if (!bytes) {
    throw new ValidationError(`Bundle is missing ${relativePath}`);
  }
  return bytes;
}

function assertImportMayReplace(
  ctx: CoreBackendModuleContext,
  entry: ModelBundleManifestEntry,
): void {
  const db = getDb(ctx);
  const footprint = db
    .select({ id: footprints.id })
    .from(footprints)
    .where(eq(footprints.id, entry.footprintId))
    .get();
  if (!footprint) {
    throw new ValidationError(`Footprint ${entry.footprintId} does not exist`);
  }

  const existing = db
    .select()
    .from(footprintModels)
    .where(eq(footprintModels.footprintId, entry.footprintId))
    .get();
  if (!existing || existing.status !== "ready") return;

  const existingIsNewer =
    Date.parse(existing.updatedAt) > Date.parse(entry.updatedAt);
  const hashesMatch =
    existing.glbSha256 === entry.glbSha256 &&
    existing.sourceStepSha256 === entry.sourceStepSha256;
  if (existingIsNewer && !hashesMatch) {
    throw new ValidationError(
      `Refusing to overwrite newer ready model for footprint ${entry.footprintId}`,
    );
  }
}

function upsertImportedBundleEntry(
  ctx: CoreBackendModuleContext,
  entry: ModelBundleManifestEntry,
  glbByteSize: number,
  sourceByteSize: number | null,
): void {
  const db = getDb(ctx);
  db.transaction((tx) => {
    const txDb = tx as typeof db;
    txDb
      .delete(footprintModels)
      .where(eq(footprintModels.footprintId, entry.footprintId))
      .run();
    txDb
      .insert(footprintModels)
      .values({
        footprintId: entry.footprintId,
        status: "ready",
        glbPath: entry.glbRelativePath,
        glbSha256: entry.glbSha256,
        sourceStepPath: entry.sourceRelativePath,
        sourceStepSha256: entry.sourceStepSha256,
        sourceFilename: entry.sourceRelativePath
          ? path.posix.basename(entry.sourceRelativePath)
          : null,
        sourceByteSize,
        modelRefJson: entry.modelRefJson,
        tessellationParamsJson: entry.tessellationParamsJson,
        converterVersion: entry.converterVersion,
        byteSize: glbByteSize,
        errorMessage: null,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })
      .run();
  });
}

async function importModelBundle(
  ctx: CoreBackendModuleContext,
  bytes: Uint8Array,
): Promise<{ imported: number }> {
  const zipEntries = extractZipEntries(bytes);
  const entryMap = new Map(
    zipEntries.map((entry) => [entry.path, entry.bytes]),
  );
  const manifestEntry = zipEntries.find(
    (entry) => entry.path === BUNDLE_MANIFEST_PATH,
  );
  if (!manifestEntry) {
    throw new ValidationError("Bundle is missing manifest.json");
  }
  const manifest = parseBundleManifest(decodeTextEntry(manifestEntry));

  for (const entry of manifest.entries) {
    const expectedGlbPath = modelAssetRelativePath("glb", entry.glbSha256);
    const expectedSourcePath = entry.sourceStepSha256
      ? modelAssetRelativePath("source", entry.sourceStepSha256)
      : null;
    assertRelativeAssetPath(
      entry.glbRelativePath,
      expectedGlbPath,
      "glbRelativePath",
    );
    assertRelativeAssetPath(
      entry.sourceRelativePath,
      expectedSourcePath,
      "sourceRelativePath",
    );
    assertImportMayReplace(ctx, entry);
  }

  for (const entry of manifest.entries) {
    const glbBytes = findBundleEntry(entryMap, entry.glbRelativePath);
    validateHashMatches(glbBytes, entry.glbSha256, entry.glbRelativePath);
    const glb = await writeGlb(glbBytes, entry.glbSha256);
    let sourceByteSize: number | null = null;
    if (entry.sourceStepSha256 && entry.sourceRelativePath) {
      const sourceBytes = findBundleEntry(entryMap, entry.sourceRelativePath);
      validateHashMatches(
        sourceBytes,
        entry.sourceStepSha256,
        entry.sourceRelativePath,
      );
      sourceByteSize = (
        await writeSourceStep(sourceBytes, entry.sourceStepSha256)
      ).byteSize;
    }
    upsertImportedBundleEntry(ctx, entry, glb.byteSize, sourceByteSize);
  }

  return { imported: manifest.entries.length };
}

function parseCommitGeneratedBody(value: unknown): CommitGeneratedRequest {
  if (!isRecord(value)) {
    throw new ValidationError("Request body must be an object");
  }

  const symbolLibraryRaw = value.symbolLibrary;
  if (!isRecord(symbolLibraryRaw)) {
    throw new ValidationError("symbolLibrary must be an object");
  }

  const selectionRaw = value.selection;
  if (!isRecord(selectionRaw)) {
    throw new ValidationError("selection must be an object");
  }

  const generatedRaw = value.generatedFootprint;
  if (!isRecord(generatedRaw)) {
    throw new ValidationError("generatedFootprint must be an object");
  }

  const sourceRaw = generatedRaw.source;
  if (!isRecord(sourceRaw)) {
    throw new ValidationError("generatedFootprint.source must be an object");
  }

  const metadataRaw = generatedRaw.metadata;
  if (!isRecord(metadataRaw)) {
    throw new ValidationError("generatedFootprint.metadata must be an object");
  }

  const componentRaw = value.component;
  if (!isRecord(componentRaw)) {
    throw new ValidationError("component must be an object");
  }

  return {
    symbolLibrary: {
      fileName: readStringField(
        symbolLibraryRaw,
        "fileName",
        "symbolLibrary.fileName",
      ),
      content: readStringField(
        symbolLibraryRaw,
        "content",
        "symbolLibrary.content",
      ),
    },
    selection: {
      symbolId: readStringField(selectionRaw, "symbolId", "selection.symbolId"),
    },
    generatedFootprint: {
      source:
        sourceRaw as unknown as CommitGeneratedRequest["generatedFootprint"]["source"],
      metadata:
        metadataRaw as unknown as CommitGeneratedRequest["generatedFootprint"]["metadata"],
    },
    component: {
      name: readStringField(componentRaw, "name", "component.name"),
      description: readStringField(
        componentRaw,
        "description",
        "component.description",
      ),
      tags: readOptionalTagsField(componentRaw, "tags", "component.tags"),
    },
  };
}

function readOptionalTagsField(
  record: Record<string, unknown>,
  key: string,
  fieldPath: string,
): string[] | undefined {
  if (!(key in record)) return undefined;
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ValidationError(`${fieldPath} must be an array of strings`);
  }
  const tags: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== "string") {
      throw new ValidationError(`${fieldPath}[${index}] must be a string`);
    }
    tags.push(entry);
  }
  return tags;
}

function parseLimit(limitRaw: string | null): number | undefined {
  if (!limitRaw) {
    return undefined;
  }
  const parsed = Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function parseTags(tagsRaw: string | null): string[] | undefined {
  if (!tagsRaw) {
    return undefined;
  }
  const seen = new Set<string>();
  const tags = tagsRaw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0)
    .filter((value) => {
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
  return tags.length > 0 ? tags : undefined;
}

export function registerRoutes(
  router: ModuleRouterHandle,
  ctx: CoreBackendModuleContext,
): void {
  router.get("/status", async () => {
    const db = getDb(ctx);
    const row = await db
      .select({ count: sql<number>`count(*)` })
      .from(components)
      .get();
    return success({
      moduleId: ctx.moduleId,
      namespace: ctx.manifest.namespace,
      status: "ready",
      componentCount: row?.count ?? 0,
    });
  });

  router.get("/components", async (routeCtx) => {
    const query = routeCtx.query.get("q") ?? undefined;
    const limit = parseLimit(routeCtx.query.get("limit"));
    const tags = parseTags(routeCtx.query.get("tags"));
    const result = await searchComponents(ctx, { query, limit, tags });
    return success({ components: result });
  });

  router.get("/tags", async (routeCtx) => {
    const excludeSystem = routeCtx.query.get("excludeSystem") === "true";
    const tags = await listTags(ctx, { excludeSystem });
    return success({ tags });
  });

  router.patch("/components/:componentId", async (routeCtx) => {
    const componentId = routeCtx.params.getOrThrow("componentId");
    const body = await parseJsonBody<unknown>(routeCtx.req);
    if (!isRecord(body)) {
      throw new ValidationError("Request body must be an object");
    }
    const patch: {
      name?: string;
      description?: string;
      tags?: string[];
    } = {};
    if ("name" in body) {
      if (typeof body.name !== "string") {
        throw new ValidationError("name must be a string");
      }
      patch.name = body.name;
    }
    if ("description" in body) {
      if (typeof body.description !== "string") {
        throw new ValidationError("description must be a string");
      }
      patch.description = body.description;
    }
    if ("tags" in body) {
      if (!Array.isArray(body.tags)) {
        throw new ValidationError("tags must be an array of strings");
      }
      const tags: string[] = [];
      for (let index = 0; index < body.tags.length; index += 1) {
        const entry = body.tags[index];
        if (typeof entry !== "string") {
          throw new ValidationError(`tags[${index}] must be a string`);
        }
        tags.push(entry);
      }
      patch.tags = tags;
    }
    const component = await updateComponent(ctx, componentId, patch);
    if (!component) {
      throw new NotFoundError("Component not found");
    }
    return success({ component });
  });

  router.get("/models/export", async () => {
    const archive = await buildModelBundle(ctx);
    return new Response(archive, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="openpcb-3d-models.zip"',
      },
    });
  });

  router.post("/models/import", async (routeCtx) => {
    const body = await parseZipImportBody(routeCtx.req);
    const result = await importModelBundle(ctx, body.bytes);
    return success(result, 201);
  });

  router.post("/components/delete", async (routeCtx) => {
    const body = await parseJsonBody<unknown>(routeCtx.req);
    const ids = parseDeleteIdsBody(body);
    const result = deleteComponents(ctx, ids);
    return success(result);
  });

  router.post("/imports/kicad/inspect", async (routeCtx) => {
    const body = parseInspectRequestBody(
      await parseJsonBody<unknown>(routeCtx.req),
    );
    return success(buildInspectResponse(body));
  });

  router.post("/imports/kicad", async (routeCtx) => {
    const body = parseCommitRequestBody(
      await parseJsonBody<unknown>(routeCtx.req),
    );
    const result = commitKicadImport(ctx, body);
    return success(result, result.reused ? 200 : 201);
  });

  router.post("/imports/kicad/zip", async (routeCtx) => {
    const body = await parseZipImportBody(routeCtx.req);
    const result = await commitKicadZipImport(ctx, body.fileName, body.bytes);
    return success(result, result.reused ? 200 : 201);
  });

  router.post("/imports/generated", async (routeCtx) => {
    const body = parseCommitGeneratedBody(
      await parseJsonBody<unknown>(routeCtx.req),
    );
    const result = commitGeneratedImport(ctx, body);
    return success(result, 201);
  });

  router.post("/imports/drawn", async (routeCtx) => {
    const body = (await parseJsonBody<unknown>(
      routeCtx.req,
    )) as CommitDrawnRequest;
    if (!body || typeof body !== "object") {
      throw new ValidationError("Request body must be an object");
    }
    const result = commitDrawnImport(ctx, body);
    return success(result, 201);
  });

  router.get("/components/:componentId", async (routeCtx) => {
    const component = await resolveComponent(
      ctx,
      routeCtx.params.getOrThrow("componentId"),
    );
    if (!component) {
      throw new NotFoundError("Component not found");
    }
    return success({ component });
  });

  router.post("/components/:componentId/clone", async (routeCtx) => {
    const sourceId = routeCtx.params.getOrThrow("componentId");
    const result = cloneComponent(ctx, sourceId);
    if (!result) {
      throw new NotFoundError("Component not found");
    }
    return success(result, 201);
  });

  router.get("/components/:componentId/detail", async (routeCtx) => {
    const detail = await getComponentDetail(
      ctx,
      routeCtx.params.getOrThrow("componentId"),
    );
    if (!detail) {
      throw new NotFoundError("Component detail not found");
    }
    return success({ detail });
  });

  router.get("/symbols/:symbolId", async (routeCtx) => {
    const symbol = await getSymbol(ctx, routeCtx.params.getOrThrow("symbolId"));
    if (!symbol) {
      throw new NotFoundError("Symbol not found");
    }
    return success({ symbol });
  });

  router.get("/footprints/:footprintId", async (routeCtx) => {
    const footprint = await getFootprint(
      ctx,
      routeCtx.params.getOrThrow("footprintId"),
    );
    if (!footprint) {
      throw new NotFoundError("Footprint not found");
    }
    return success({ footprint });
  });

  router.get("/footprints/:footprintId/model/meta", async (routeCtx) => {
    const footprintId = routeCtx.params.getOrThrow("footprintId");
    const footprint = await getFootprint(ctx, footprintId);
    if (!footprint) {
      throw new ValidationError("Footprint not found");
    }
    const metadata = await getFootprintModelMetadata(ctx, footprintId);
    return success(metadata);
  });

  router.get("/footprints/:footprintId/model", async (routeCtx) => {
    const footprintId = routeCtx.params.getOrThrow("footprintId");
    const footprint = await getFootprint(ctx, footprintId);
    if (!footprint) {
      throw new ValidationError("Footprint not found");
    }
    const model = await getFootprintModelRecord(ctx, footprintId);
    if (!model?.glbPath || !model.glbSha256) {
      throw new NotFoundError("Footprint model not found");
    }
    const absolutePath = resolveStoredModelPath(model.glbPath, ".glb");
    return new Response(Bun.file(absolutePath), {
      headers: {
        "content-type": "model/gltf-binary",
        etag: `"${model.glbSha256}"`,
        "cache-control": "private, immutable, max-age=31536000",
      },
    });
  });

  router.get("/footprints/:footprintId/model/source", async (routeCtx) => {
    const footprintId = routeCtx.params.getOrThrow("footprintId");
    const footprint = await getFootprint(ctx, footprintId);
    if (!footprint) {
      throw new ValidationError("Footprint not found");
    }
    const model = await getFootprintModelRecord(ctx, footprintId);
    if (!model?.sourceStepPath || !model.sourceStepSha256) {
      throw new NotFoundError("Footprint source model not found");
    }
    const absolutePath = resolveStoredModelPath(model.sourceStepPath, ".step");
    return new Response(Bun.file(absolutePath), {
      headers: {
        "content-type": "model/step",
        "cache-control": "private, no-store",
      },
    });
  });

  router.post("/footprints/:footprintId/model", async (routeCtx) => {
    const footprintId = routeCtx.params.getOrThrow("footprintId");
    const footprint = await getFootprint(ctx, footprintId);
    if (!footprint) {
      throw new ValidationError("Footprint not found");
    }
    assertFootprintNotBuiltinComponent(ctx, footprintId, "update");

    const existingModel = await getFootprintModelRecord(ctx, footprintId);
    const body = await parseModelUploadBody(routeCtx.req);
    const glb = await writeGlb(body.glbBytes, body.glbSha256);
    let source: Awaited<ReturnType<typeof writeSourceStep>> | null = null;
    try {
      source = body.sourceStepBytes
        ? await writeSourceStep(body.sourceStepBytes, body.sourceStepSha256!)
        : null;
      const preservedSource =
        !source &&
        body.sourceStepSha256 &&
        existingModel?.sourceStepSha256 === body.sourceStepSha256 &&
        existingModel.sourceStepPath
          ? existingModel
          : null;
      if (!source && body.sourceStepSha256 && !preservedSource) {
        throw new ValidationError(
          "sourceStepSha256 requires a matching stored sourceStep",
        );
      }

      const metadata = upsertFootprintModelRecord(ctx, {
        footprintId,
        glbPath: glb.relativePath,
        glbSha256: glb.sha256,
        byteSize: glb.byteSize,
        sourceStepPath:
          source?.relativePath ?? preservedSource?.sourceStepPath ?? null,
        sourceStepSha256:
          source?.sha256 ?? preservedSource?.sourceStepSha256 ?? null,
        sourceFilename: body.sourceFilename,
        sourceByteSize:
          source?.byteSize ?? preservedSource?.sourceByteSize ?? null,
        modelRefJson: body.modelRefJson,
        tessellationParamsJson: body.tessellationParamsJson,
        converterVersion: body.converterVersion,
      });
      const oldHashes = [
        existingModel?.glbSha256,
        existingModel?.sourceStepSha256,
      ].filter((value): value is string => Boolean(value));
      await Promise.all(
        oldHashes.map((sha256) => deleteModelIfUnreferenced(ctx, sha256)),
      );
      return success(metadata, 201);
    } catch (error) {
      // Roll back any newly-written assets so the filesystem doesn't accumulate
      // orphans referenced by no DB row. Skip deduped writes — those files
      // pre-existed and may be referenced by other footprints (content-addressed).
      const cleanups: Promise<void>[] = [];
      if (!glb.deduped)
        cleanups.push(
          deleteModelIfUnreferenced(ctx, glb.sha256).catch(() => undefined),
        );
      if (source && !source.deduped) {
        cleanups.push(
          deleteModelIfUnreferenced(ctx, source.sha256).catch(() => undefined),
        );
      }
      await Promise.all(cleanups);
      throw error;
    }
  });

  router.patch("/footprints/:footprintId/model", async (routeCtx) => {
    const footprintId = routeCtx.params.getOrThrow("footprintId");
    const footprint = await getFootprint(ctx, footprintId);
    if (!footprint) {
      throw new ValidationError("Footprint not found");
    }
    assertFootprintNotBuiltinComponent(ctx, footprintId, "update");
    const body = await parseJsonBody<{
      status?: unknown;
      errorMessage?: unknown;
    }>(routeCtx.req);
    if (body.status !== "failed") {
      throw new ValidationError("status must be failed");
    }
    if (
      typeof body.errorMessage !== "string" ||
      body.errorMessage.trim().length === 0
    ) {
      throw new ValidationError("errorMessage must be a non-empty string");
    }
    const metadata = await markFootprintModelConversionFailed(
      ctx,
      footprintId,
      body.errorMessage.trim().slice(0, 500),
    );
    return success(metadata);
  });

  router.delete("/footprints/:footprintId/model", async (routeCtx) => {
    const footprintId = routeCtx.params.getOrThrow("footprintId");
    const footprint = await getFootprint(ctx, footprintId);
    if (!footprint) {
      throw new ValidationError("Footprint not found");
    }
    assertFootprintNotBuiltinComponent(ctx, footprintId, "delete");

    const existing = await getFootprintModelRecord(ctx, footprintId);
    deleteFootprintModelRecord(ctx, footprintId);
    const hashes = [existing?.glbSha256, existing?.sourceStepSha256].filter(
      (value): value is string => Boolean(value),
    );
    await Promise.all(
      hashes.map((sha256) => deleteModelIfUnreferenced(ctx, sha256)),
    );
    return success(toFootprintModelMetadata(null));
  });
}
