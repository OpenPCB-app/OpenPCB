// Builds an `.opclib` package from the user's CUSTOM components (is_builtin=0)
// for upload to OpenPCB Cloud. This is the inverse of `sync/opclib-importer.ts`:
// symbol/footprint asset bytes are the stored `dataJson`; 3D model bytes come
// from the content-addressed model store. Reuses @openpcb/opclib-pack's
// `packOpclib` (which validates the manifest against the JSON schema).
//
// Local DB ids are arbitrary (often non-namespaced / UUID-like), but the opclib
// schema requires namespaced dotted lowercase ids. We therefore map every local
// id to a deterministic `user.custom.<kind>.<sha16(localId)>` id and rewrite all
// cross-references through that map. The mapping is one-way (pull imports under
// the synthetic ids) — round-trip id identity is not required.
import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  packOpclib,
  type OpclibAssetEntry,
  type OpclibComponentEntry,
  type OpclibFootprintEntry,
  type OpclibLibraryHeader,
  type OpclibModel3dEntry,
  type PackOpclibResult,
  type PackedModel3d,
} from "@openpcb/opclib-pack";
import {
  componentFootprints,
  components,
  footprintModels,
  footprints,
  symbols,
} from "./schema";
import { readGlb, readSourceStep } from "./services/footprint-model-store";

type Db = BetterSQLite3Database<Record<string, unknown>>;

export const USER_LIBRARY_ID = "user.custom";
const USER_LIBRARY_NAME = "My Custom Library";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha16(seed: string): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

/** Deterministic schema-valid opclib id for a local row. */
function opclibId(
  kind: "symbol" | "footprint" | "component" | "model",
  localId: string,
): string {
  return `${USER_LIBRARY_ID}.${kind}.${sha16(localId)}`;
}

/** Stable, schema-valid UUID derived from a seed (no DB mutation needed). */
function stableUuid(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function uuidFor(existing: string | null | undefined, seed: string): string {
  return existing && UUID_RE.test(existing) ? existing : stableUuid(seed);
}

function semverOr(v: string | null | undefined): string {
  return v && SEMVER_RE.test(v) ? v : "1.0.0";
}

function safeParseArray(json: string | null): unknown[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function parsePinMap(
  json: string | null,
):
  | Array<{ pinNumber: string; padNumber: string; pinName?: string }>
  | undefined {
  const rows = safeParseArray(json);
  if (rows.length === 0) return undefined;
  const mapped = rows
    .map((r) => r as Record<string, unknown>)
    .filter(
      (r) => typeof r.pinNumber === "string" && typeof r.padNumber === "string",
    )
    .map((r) => ({
      pinNumber: r.pinNumber as string,
      padNumber: r.padNumber as string,
      ...(typeof r.pinName === "string" && r.pinName
        ? { pinName: r.pinName }
        : {}),
    }));
  return mapped.length > 0 ? mapped : undefined;
}

export interface BuiltUserPack {
  result: PackOpclibResult;
  componentCount: number;
}

/**
 * Build an `.opclib` of every custom component. Returns null when the user has
 * no custom components. `generatedAt` is injected so callers control determinism.
 */
export async function buildUserLibraryPack(
  db: Db,
  generatedAt: string,
): Promise<BuiltUserPack | null> {
  const comps = db
    .select()
    .from(components)
    .where(eq(components.isBuiltin, 0))
    .all();
  if (comps.length === 0) return null;

  const symbolIds = new Set<string>();
  const footprintIds = new Set<string>();
  const variantsByComp = new Map<
    string,
    Array<{
      footprintId: string;
      variantLabel: string;
      pinMapJson: string | null;
      sortOrder: number;
    }>
  >();

  for (const c of comps) {
    symbolIds.add(c.symbolId);
    footprintIds.add(c.footprintId);
    const vrows = db
      .select()
      .from(componentFootprints)
      .where(eq(componentFootprints.componentId, c.id))
      .all();
    const normalized = vrows.map((v) => ({
      footprintId: v.footprintId,
      variantLabel: v.variantLabel,
      pinMapJson: v.pinMapJson ?? null,
      sortOrder: v.sortOrder,
    }));
    if (normalized.length === 0) {
      normalized.push({
        footprintId: c.footprintId,
        variantLabel: "default",
        pinMapJson: null,
        sortOrder: 0,
      });
    }
    variantsByComp.set(c.id, normalized);
    for (const v of normalized) footprintIds.add(v.footprintId);
  }

  // Symbols → entries + local→opclib id map.
  const symRows =
    symbolIds.size > 0
      ? db
          .select()
          .from(symbols)
          .where(inArray(symbols.id, [...symbolIds]))
          .all()
      : [];
  const symbolIdMap = new Map<string, string>();
  const symbolAssets = symRows.map((s) => {
    const mappedId = opclibId("symbol", s.id);
    symbolIdMap.set(s.id, mappedId);
    const bytes = new TextEncoder().encode(s.dataJson);
    const entry: OpclibAssetEntry = {
      id: mappedId,
      uuid: uuidFor(s.uuid, s.id),
      version: semverOr(s.version),
      name: s.name,
      path: `symbols/${mappedId}.symbol.json`,
      sha256: sha256Hex(bytes),
    };
    return { entry, bytes };
  });

  // Footprints (+ 3D models) → entries + id map.
  const fpRows =
    footprintIds.size > 0
      ? db
          .select()
          .from(footprints)
          .where(inArray(footprints.id, [...footprintIds]))
          .all()
      : [];
  const footprintIdMap = new Map<string, string>();
  const footprintAssets: Array<{
    entry: OpclibFootprintEntry;
    bytes: Uint8Array;
  }> = [];
  const packedModels: PackedModel3d[] = [];

  for (const f of fpRows) {
    const mappedId = opclibId("footprint", f.id);
    footprintIdMap.set(f.id, mappedId);
    const bytes = new TextEncoder().encode(f.dataJson);
    const fpEntry: OpclibFootprintEntry = {
      id: mappedId,
      uuid: uuidFor(f.uuid, f.id),
      version: semverOr(f.version),
      name: f.name,
      path: `footprints/${mappedId}.footprint.json`,
      sha256: sha256Hex(bytes),
    };

    const fm = db
      .select()
      .from(footprintModels)
      .where(eq(footprintModels.footprintId, f.id))
      .get();
    if (fm?.glbSha256) {
      try {
        const modelId = opclibId("model", f.id);
        const glbBytes = await readGlb(fm.glbSha256);
        const glbPath = `models/${fm.glbSha256}.glb`;
        const formats: OpclibModel3dEntry["formats"] = {
          glb: { path: glbPath, sha256: fm.glbSha256 },
        };
        const assets: PackedModel3d["assets"] = [
          { format: "glb", path: glbPath, bytes: glbBytes },
        ];
        if (fm.sourceStepSha256) {
          const stepBytes = await readSourceStep(fm.sourceStepSha256);
          const stepPath = `models/${fm.sourceStepSha256}.step`;
          formats.step = { path: stepPath, sha256: fm.sourceStepSha256 };
          assets.push({ format: "step", path: stepPath, bytes: stepBytes });
        }
        packedModels.push({
          entry: {
            id: modelId,
            uuid: stableUuid(modelId),
            version: "1.0.0",
            name: fm.sourceFilename ?? f.name,
            formats,
          },
          assets,
        });
        fpEntry.models3d = [modelId];
      } catch {
        // Model bytes missing on disk → ship the footprint without 3D.
      }
    }
    footprintAssets.push({ entry: fpEntry, bytes });
  }

  // Components — skip any whose symbol/footprints didn't resolve.
  const componentPacked: Array<{
    entry: OpclibComponentEntry;
    path: string;
    bytes: Uint8Array;
  }> = [];
  for (const c of comps) {
    const mappedSymbol = symbolIdMap.get(c.symbolId);
    const mappedDefaultFp = footprintIdMap.get(c.footprintId);
    if (!mappedSymbol || !mappedDefaultFp) continue;

    const variants = (variantsByComp.get(c.id) ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .filter((v) => footprintIdMap.has(v.footprintId));
    if (variants.length === 0) continue;

    const tags = safeParseArray(c.tagsJson).filter(
      (t): t is string => typeof t === "string",
    );
    const mappedId = opclibId("component", c.id);
    const entry: OpclibComponentEntry = {
      id: mappedId,
      uuid: uuidFor(c.uuid, c.id),
      version: semverOr(c.version),
      name: c.name,
      ...(c.description ? { description: c.description } : {}),
      category: tags[0] ?? "Uncategorized",
      tags,
      symbol: mappedSymbol,
      defaultFootprint: mappedDefaultFp,
      footprints: variants.map((v) => {
        const pinMap = parsePinMap(v.pinMapJson);
        return {
          footprint: footprintIdMap.get(v.footprintId)!,
          label: v.variantLabel || "default",
          ...(pinMap ? { pinMap } : {}),
        };
      }),
      ...(c.manufacturer && c.manufacturerPartNumber
        ? {
            manufacturerParts: [
              { manufacturer: c.manufacturer, mpn: c.manufacturerPartNumber },
            ],
          }
        : {}),
      // The schema's provenance.source is an enum of provenance *types*; a
      // user-authored custom component is "openpcb-original".
      provenance: { source: "openpcb-original", license: "proprietary" },
    };
    componentPacked.push({
      entry,
      path: `components/${mappedId}.component.json`,
      bytes: new TextEncoder().encode(JSON.stringify(entry)),
    });
  }

  if (componentPacked.length === 0) return null;

  const library: OpclibLibraryHeader = {
    id: USER_LIBRARY_ID,
    name: USER_LIBRARY_NAME,
    kind: "user",
    channel: "stable",
    version: "1.0.0",
    license: "proprietary",
    generatedAt,
  };

  const result = packOpclib({
    library,
    symbols: symbolAssets,
    footprints: footprintAssets,
    models3d: packedModels,
    components: componentPacked,
  });
  return { result, componentCount: componentPacked.length };
}
