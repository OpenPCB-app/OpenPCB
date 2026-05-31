import { and, eq, inArray } from "drizzle-orm";
import path from "node:path";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { getDb } from "../queries";
import {
  componentFootprints,
  components,
  footprintModels,
  footprints,
  releases,
  sources,
  symbols,
} from "../schema";
import { writeGlb, writeSourceStep } from "../services/footprint-model-store";
import { readAssetBytes, readAssetJson, verifyManifest } from "./opclib-reader";
import { makeResolver } from "./trusted-keys";
import type {
  ImportResult,
  InstallOrigin,
  OpclibComponentEntry,
  OpclibFootprintEntry,
  OpclibPackage,
} from "./types";

interface ImporterOptions {
  installOrigin: InstallOrigin;
  /** When true (default in production), reject if the manifest signature is
   * missing or invalid. When false, log a warning and continue with
   * signature_valid = 0. */
  requireSignature?: boolean;
}

interface StoredAssetInfo {
  relativePath: string;
  byteSize: number;
  deduped: boolean;
}

const PASSIVE_PIN_MAP_FALLBACK = JSON.stringify([
  { pinNumber: "1", padNumber: "1", pinName: "1" },
  { pinNumber: "2", padNumber: "2", pinName: "2" },
]);

/**
 * Runtime shape consumed by `applyPlacementTransform` in
 * `src/modules/designer/frontend/three-d/transform-helpers.ts`. The keys
 * match the renderer's parser (`parseModelRef`): `offset` / `rotation` /
 * `scale`, each `{x,y,z}` in mm / degrees / dimensionless.
 *
 * We accept the manifest's `offsetMm` / `rotationDeg` / `scaleMm` names from
 * the opclib (and from CoreLibrary `.model.json` sidecars) and translate
 * into this shape at import time.
 */
type ModelRefOverride = {
  offset?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  scale?: { x: number; y: number; z: number };
};

interface OpclibModel3dTransformFields {
  offsetMm?: { x: number; y: number; z: number };
  rotationDeg?: { x: number; y: number; z: number };
  scaleMm?: { x: number; y: number; z: number };
  transformBaked?: boolean;
}

function vectorIsZero(v: { x: number; y: number; z: number }): boolean {
  return v.x === 0 && v.y === 0 && v.z === 0;
}
function scaleIsIdentity(v: { x: number; y: number; z: number }): boolean {
  return v.x === 1 && v.y === 1 && v.z === 1;
}

/**
 * Translate the manifest's `Model3dTransform` fields into the runtime
 * `modelRef` shape consumed by `applyPlacementTransform`. Returns `null`
 * when every component is identity, so the DB column stays null and we
 * don't pay a no-op matrix multiply per render.
 */
function modelRefFromManifest(
  entry: OpclibModel3dTransformFields,
): ModelRefOverride | null {
  if (entry.transformBaked) return null;
  const offset = entry.offsetMm;
  const rotation = entry.rotationDeg;
  const scale = entry.scaleMm;
  const out: ModelRefOverride = {};
  if (offset && !vectorIsZero(offset)) out.offset = offset;
  if (rotation && !vectorIsZero(rotation)) out.rotation = rotation;
  if (scale && !scaleIsIdentity(scale)) out.scale = scale;
  if (!out.offset && !out.rotation && !out.scale) return null;
  return out;
}

/**
 * Fallback overrides for `.opclib` versions that pre-date the manifest's
 * `offsetMm` / `rotationDeg` / `scaleMm` propagation. Forward-compatibility
 * shim: when the manifest entry already carries the values, the fallback
 * is ignored. Keyed by footprint id (the PK on `library_footprint_models`).
 *
 * Empty by design. The CoreLibrary `.model.json` sidecars now declare the
 * correct (identity) orientation for every KiCad-derived STEP and bake it
 * into the shipped GLB (`transformBaked`). The previous LED (−90° X) and
 * PinHeader/PinSocket (+90° Y + y-mirror) entries were WRONG: those STEPs are
 * authored Z-up — KiCad's own `(model)` block is `rotate 0 0 0`, identical to
 * the resistor that always rendered correctly — and the spurious rotations
 * were being applied a SECOND time on top of the (already mis-baked) GLB,
 * tipping the parts through/below the board. Render-time correction must stay
 * empty for transform-baked models; see STALE_OVERRIDE_FOOTPRINT_IDS for the
 * cleanup of `model_ref_json` rows on existing DBs.
 */
const MODEL_REF_OVERRIDES_BY_FOOTPRINT: Readonly<
  Record<string, ModelRefOverride>
> = {};

/** Footprints that historically carried a now-removed override — listed here
 * so `backfillModelRefOverrides` nulls out their `model_ref_json` on existing
 * DBs (the GLBs ship `transformBaked`, so the render-time transform must be
 * empty). Keep an id here until every DB in the wild has cycled past the bad
 * override. */
const STALE_OVERRIDE_FOOTPRINT_IDS: readonly string[] = [
  "openpcb.core.footprint.opto.led-0603-1608metric",
  "openpcb.core.footprint.opto.led-0805-2012metric",
  "openpcb.core.footprint.opto.led-1206-3216metric",
  "openpcb.core.footprint.connector.pin-header-1x02-p2-54mm-vertical",
  "openpcb.core.footprint.connector.pin-header-2x03-p2-54mm-vertical",
  "openpcb.core.footprint.connector.pin-socket-1x02-p2-54mm-vertical",
  "openpcb.core.footprint.connector.pin-socket-2x03-p2-54mm-vertical",
];

function resolveModelRefOverride(footprintId: string): string | null {
  const override = MODEL_REF_OVERRIDES_BY_FOOTPRINT[footprintId];
  return override ? JSON.stringify(override) : null;
}

/**
 * Idempotent backfill of `model_ref_json`. Runs every boot:
 *   1. writes the override JSON for any footprint in the fallback map whose
 *      row exists in `library_footprint_models` (covers existing DBs whose
 *      manifest pre-dates the new fields);
 *   2. clears `modelRefJson` for footprints in `STALE_OVERRIDE_FOOTPRINT_IDS`
 *      so removing an entry from the override map actually takes effect on
 *      existing DBs.
 *
 * A no-op for rows that already carry the same JSON.
 */
export function backfillModelRefOverrides(ctx: CoreBackendModuleContext): {
  updated: number;
} {
  const db = getDb(ctx);
  const now = new Date().toISOString();
  let updated = 0;
  for (const [footprintId, override] of Object.entries(
    MODEL_REF_OVERRIDES_BY_FOOTPRINT,
  )) {
    const json = JSON.stringify(override);
    const existing = db
      .select({
        footprintId: footprintModels.footprintId,
        modelRefJson: footprintModels.modelRefJson,
      })
      .from(footprintModels)
      .where(eq(footprintModels.footprintId, footprintId))
      .get();
    if (!existing) continue;
    if (existing.modelRefJson === json) continue;
    db.update(footprintModels)
      .set({ modelRefJson: json, updatedAt: now })
      .where(eq(footprintModels.footprintId, footprintId))
      .run();
    updated += 1;
  }
  for (const footprintId of STALE_OVERRIDE_FOOTPRINT_IDS) {
    if (footprintId in MODEL_REF_OVERRIDES_BY_FOOTPRINT) continue;
    const existing = db
      .select({ modelRefJson: footprintModels.modelRefJson })
      .from(footprintModels)
      .where(eq(footprintModels.footprintId, footprintId))
      .get();
    if (!existing) continue;
    if (existing.modelRefJson === null) continue;
    db.update(footprintModels)
      .set({ modelRefJson: null, updatedAt: now })
      .where(eq(footprintModels.footprintId, footprintId))
      .run();
    updated += 1;
  }
  return { updated };
}

function requiresRenderable3d(libraryId: string): boolean {
  return libraryId === "openpcb.core";
}

function validateReferencedModels(pkg: OpclibPackage): void {
  if (!requiresRenderable3d(pkg.manifest.library.id)) return;
  const modelsById = new Map(pkg.manifest.models3d.map((m) => [m.id, m]));
  for (const fp of pkg.manifest.footprints) {
    const modelIds = fp.models3d ?? [];
    if (modelIds.length > 1) {
      throw new Error(
        `opclib ${pkg.manifest.library.id}: footprint ${fp.id} references ${modelIds.length} 3D models; exactly one renderable GLB model is supported`,
      );
    }
    for (const modelId of modelIds) {
      const model = modelsById.get(modelId);
      if (!model) {
        throw new Error(
          `opclib ${pkg.manifest.library.id}: footprint ${fp.id} references missing 3D model ${modelId}`,
        );
      }
      if (!model.formats.glb) {
        throw new Error(
          `opclib ${pkg.manifest.library.id}: footprint ${fp.id} references 3D model ${modelId} without GLB format`,
        );
      }
    }
  }
}

/**
 * Transactionally import a parsed .opclib package into SQLite. Re-importing
 * the same (sourceId, version) upserts content rows in case files diverged on
 * disk. GLB filesystem writes happen before the DB transaction; the DB
 * portion is fully synchronous within `db.transaction`.
 */
export async function importOpclib(
  ctx: CoreBackendModuleContext,
  pkg: OpclibPackage,
  opts: ImporterOptions,
): Promise<ImportResult> {
  const db = getDb(ctx);
  const now = new Date().toISOString();
  const lib = pkg.manifest.library;
  const isReadOnly = (lib.kind ?? "core") === "core" ? 1 : 0;

  const requireSignature =
    opts.requireSignature ?? process.env.OPENPCB_REQUIRE_SIGNED_OPCLIB === "1";
  const verdict = verifyManifest(pkg.manifest, { resolveKey: makeResolver() });
  const signatureValid = verdict.valid ? 1 : 0;
  if (verdict.valid) {
    ctx.logger.info(
      `core-library: signature verified (keyId=${verdict.keyId}, source=${lib.id}@${lib.version})`,
    );
  } else if (requireSignature) {
    throw new Error(
      `opclib signature verification failed: ${verdict.reason ?? "unknown"} (source=${lib.id}@${lib.version})`,
    );
  } else {
    ctx.logger.warn(
      `core-library: importing without valid signature (reason=${verdict.reason}, source=${lib.id}@${lib.version}); set OPENPCB_REQUIRE_SIGNED_OPCLIB=1 to enforce`,
    );
  }

  const result: ImportResult = {
    sourceId: lib.id,
    version: lib.version,
    installOrigin: opts.installOrigin,
    inserted: { symbols: 0, footprints: 0, components: 0, variants: 0 },
    updated: { symbols: 0, footprints: 0, components: 0, variants: 0 },
    models: { written: 0, deduped: 0 },
    reimport: false,
  };

  if (lib.id === "openpcb.core") {
    await migrateLegacyAliases(ctx, pkg);
  }

  validateReferencedModels(pkg);

  // Model writes are content-addressed (sha256 → <userData>/models/{glb,source})
  // and run BEFORE the DB transaction because better-sqlite3 is sync. If a
  // later DB step throws, GLBs already written remain on disk; the store dedupes
  // on the next successful import so they are not duplicated. Acceptable for
  // M2; M3 will add an explicit reconciliation pass when sync introduces
  // multi-version installs.
  const pendingGlbs: Array<{
    sha256: string;
    bytes: Uint8Array;
    modelId: string;
  }> = [];
  const pendingSteps: Array<{
    sha256: string;
    bytes: Uint8Array;
    modelId: string;
  }> = [];
  const glbBySha = new Map<string, StoredAssetInfo>();
  const stepBySha = new Map<string, StoredAssetInfo>();
  for (const model of pkg.manifest.models3d) {
    const glb = model.formats.glb;
    if (glb) {
      const bytes = readAssetBytes(pkg, glb.path);
      pendingGlbs.push({ sha256: glb.sha256, bytes, modelId: model.id });
    }
    const step = model.formats.step;
    if (step) {
      const bytes = readAssetBytes(pkg, step.path);
      pendingSteps.push({ sha256: step.sha256, bytes, modelId: model.id });
    }
  }

  // Run GLB writes before the DB transaction. They are content-addressed and
  // idempotent.
  // NOTE: writeGlb is async; we accumulate promises then resolve serially.
  const glbWritePromises = pendingGlbs.map(async (p) => {
    const stored = await writeGlb(p.bytes, p.sha256);
    glbBySha.set(p.sha256, {
      relativePath: stored.relativePath,
      byteSize: stored.byteSize,
      deduped: stored.deduped,
    });
    if (stored.deduped) result.models.deduped += 1;
    else result.models.written += 1;
    return { ...p, relativePath: stored.relativePath };
  });

  const stepWritePromises = pendingSteps.map(async (p) => {
    const stored = await writeSourceStep(p.bytes, p.sha256);
    stepBySha.set(p.sha256, {
      relativePath: stored.relativePath,
      byteSize: stored.byteSize,
      deduped: stored.deduped,
    });
    return { ...p, relativePath: stored.relativePath };
  });

  await Promise.all([...glbWritePromises, ...stepWritePromises]);

  db.transaction((tx) => {
    const transactionalDb = tx as typeof db;

    // 1. library_sources
    transactionalDb
      .insert(sources)
      .values({
        id: lib.id,
        name: lib.name,
        kind: lib.kind ?? "core",
        license: lib.license,
        homepage: lib.homepage,
        isReadOnly,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: sources.id,
        set: {
          name: lib.name,
          kind: lib.kind ?? "core",
          license: lib.license,
          homepage: lib.homepage,
          isReadOnly,
        },
      })
      .run();

    // 2. library_releases — idempotent on (source_id, version)
    const existingRelease = transactionalDb
      .select({ version: releases.version })
      .from(releases)
      .where(
        and(eq(releases.sourceId, lib.id), eq(releases.version, lib.version)),
      )
      .get();
    if (existingRelease) {
      result.reimport = true;
    }
    transactionalDb
      .insert(releases)
      .values({
        sourceId: lib.id,
        version: lib.version,
        channel: lib.channel,
        installOrigin: opts.installOrigin,
        packageSha256: pkg.manifest.integrity.packageSha256,
        signatureValid,
        installedAt: now,
        manifestJson: JSON.stringify(pkg.manifest),
      })
      .onConflictDoUpdate({
        target: [releases.sourceId, releases.version],
        set: {
          channel: lib.channel,
          installOrigin: opts.installOrigin,
          packageSha256: pkg.manifest.integrity.packageSha256,
          signatureValid,
          installedAt: now,
          manifestJson: JSON.stringify(pkg.manifest),
        },
      })
      .run();

    // 3. symbols
    for (const entry of pkg.manifest.symbols) {
      const raw = readAssetJson<Record<string, unknown>>(pkg, entry.path);
      const dataJson = JSON.stringify(raw);
      const exists = transactionalDb
        .select({ id: symbols.id })
        .from(symbols)
        .where(eq(symbols.id, entry.id))
        .get();
      if (!exists) {
        transactionalDb
          .insert(symbols)
          .values({
            id: entry.id,
            name: entry.name,
            dataJson,
            createdAt: now,
            sourceId: lib.id,
            version: entry.version,
            uuid: entry.uuid,
            contentSha256: entry.sha256,
          })
          .onConflictDoNothing()
          .run();
        result.inserted.symbols += 1;
      } else {
        transactionalDb
          .update(symbols)
          .set({
            name: entry.name,
            dataJson,
            sourceId: lib.id,
            version: entry.version,
            uuid: entry.uuid,
            contentSha256: entry.sha256,
          })
          .where(eq(symbols.id, entry.id))
          .run();
        result.updated.symbols += 1;
      }
    }

    // 4. footprints + footprint_models
    for (const entry of pkg.manifest.footprints) {
      const raw = readAssetJson<Record<string, unknown>>(pkg, entry.path);
      const dataJson = JSON.stringify(raw);
      const exists = transactionalDb
        .select({ id: footprints.id })
        .from(footprints)
        .where(eq(footprints.id, entry.id))
        .get();
      if (!exists) {
        transactionalDb
          .insert(footprints)
          .values({
            id: entry.id,
            name: entry.name,
            dataJson,
            createdAt: now,
            sourceId: lib.id,
            version: entry.version,
            uuid: entry.uuid,
            contentSha256: entry.sha256,
          })
          .onConflictDoNothing()
          .run();
        result.inserted.footprints += 1;
      } else {
        transactionalDb
          .update(footprints)
          .set({
            name: entry.name,
            dataJson,
            sourceId: lib.id,
            version: entry.version,
            uuid: entry.uuid,
            contentSha256: entry.sha256,
          })
          .where(eq(footprints.id, entry.id))
          .run();
        result.updated.footprints += 1;
      }

      upsertFootprintModelMetadata(
        transactionalDb,
        entry,
        pkg,
        glbBySha,
        stepBySha,
        now,
      );
      if ((entry.models3d ?? []).length === 0) {
        transactionalDb
          .delete(footprintModels)
          .where(eq(footprintModels.footprintId, entry.id))
          .run();
      }
    }

    // 5. components + variant join rows
    for (const entry of pkg.manifest.components) {
      upsertComponent(transactionalDb, entry, lib.id, now, result);
    }

    reconcileSourceRows(transactionalDb, pkg);
  });

  return result;
}

function reconcileSourceRows(
  tx: ReturnType<typeof getDb>,
  pkg: OpclibPackage,
): void {
  const sourceId = pkg.manifest.library.id;
  const componentIds = new Set(
    pkg.manifest.components.map((entry) => entry.id),
  );
  const symbolIds = new Set(pkg.manifest.symbols.map((entry) => entry.id));
  const footprintIds = new Set(
    pkg.manifest.footprints.map((entry) => entry.id),
  );

  const staleComponentIds = tx
    .select({ id: components.id })
    .from(components)
    .where(eq(components.sourceId, sourceId))
    .all()
    .map((row) => row.id)
    .filter((id) => !componentIds.has(id));

  if (staleComponentIds.length > 0) {
    tx.delete(componentFootprints)
      .where(inArray(componentFootprints.componentId, staleComponentIds))
      .run();
    tx.delete(components)
      .where(inArray(components.id, staleComponentIds))
      .run();
  }

  const referencedSymbolIds = new Set(
    tx
      .select({ id: components.symbolId })
      .from(components)
      .all()
      .map((row) => row.id),
  );
  const staleSymbolIds = tx
    .select({ id: symbols.id })
    .from(symbols)
    .where(eq(symbols.sourceId, sourceId))
    .all()
    .map((row) => row.id)
    .filter((id) => !symbolIds.has(id) && !referencedSymbolIds.has(id));

  if (staleSymbolIds.length > 0) {
    tx.delete(symbols).where(inArray(symbols.id, staleSymbolIds)).run();
  }

  const referencedFootprintIds = new Set<string>();
  for (const row of tx
    .select({ id: components.footprintId })
    .from(components)
    .all()) {
    referencedFootprintIds.add(row.id);
  }
  for (const row of tx
    .select({ id: componentFootprints.footprintId })
    .from(componentFootprints)
    .all()) {
    referencedFootprintIds.add(row.id);
  }

  const staleFootprintIds = tx
    .select({ id: footprints.id })
    .from(footprints)
    .where(eq(footprints.sourceId, sourceId))
    .all()
    .map((row) => row.id)
    .filter((id) => !footprintIds.has(id) && !referencedFootprintIds.has(id));

  if (staleFootprintIds.length > 0) {
    tx.delete(footprintModels)
      .where(inArray(footprintModels.footprintId, staleFootprintIds))
      .run();
    tx.delete(footprints)
      .where(inArray(footprints.id, staleFootprintIds))
      .run();
  }
}

async function migrateLegacyAliases(
  ctx: CoreBackendModuleContext,
  pkg: OpclibPackage,
): Promise<void> {
  const db = getDb(ctx);
  const now = new Date().toISOString();
  const componentsWithAliases = pkg.manifest.components.filter(
    (entry) => (entry.aliases ?? []).length > 0,
  );
  if (componentsWithAliases.length === 0) return;

  for (const entry of componentsWithAliases) {
    const aliases = entry.aliases ?? [];
    if (aliases.length === 0) continue;
    const rows = db
      .select()
      .from(components)
      .where(inArray(components.id, aliases))
      .all();
    if (rows.length === 0) continue;

    const existingCanonical = db
      .select()
      .from(components)
      .where(eq(components.id, entry.id))
      .get();
    if (!existingCanonical) {
      continue;
    }

    const first = rows[0];
    if (rows.length === 1 && first?.id === entry.id) {
      continue;
    }

    const targetId = entry.id;
    for (const legacy of rows) {
      if (legacy.id === targetId) continue;
      db.transaction((tx) => {
        const transactionalDb = tx as typeof db;
        const componentId = legacy.id;

        transactionalDb
          .update(components)
          .set({
            id: targetId,
            symbolId: existingCanonical.symbolId,
            footprintId: existingCanonical.footprintId,
            sourceId: "openpcb.core",
            version: entry.version,
            uuid: entry.uuid,
            isBuiltin: 1,
            originJson: JSON.stringify({
              libraryId: "openpcb.core",
              componentId: targetId,
              componentVersion: entry.version,
              aliases,
              migratedFrom: componentId,
              migratedAt: now,
            }),
          })
          .where(eq(components.id, componentId))
          .run();

        transactionalDb
          .update(componentFootprints)
          .set({ componentId: targetId })
          .where(eq(componentFootprints.componentId, componentId))
          .run();
      });
    }
  }
}

function upsertComponent(
  tx: ReturnType<typeof getDb>,
  entry: OpclibComponentEntry,
  sourceId: string,
  now: string,
  result: ImportResult,
): void {
  const exists = tx
    .select({ id: components.id })
    .from(components)
    .where(eq(components.id, entry.id))
    .get();

  const tagsJson = JSON.stringify(entry.tags ?? []);
  const isBuiltin = sourceId === "openpcb.core" ? 1 : 0;
  const originJson = JSON.stringify({
    libraryId: sourceId,
    componentId: entry.id,
    componentVersion: entry.version,
    aliases: entry.aliases ?? [],
  });

  if (!exists) {
    tx.insert(components)
      .values({
        id: entry.id,
        name: entry.name,
        description: entry.description ?? "",
        symbolId: entry.symbol,
        footprintId: entry.defaultFootprint,
        tagsJson,
        createdAt: now,
        isBuiltin,
        sourceId,
        version: entry.version,
        uuid: entry.uuid,
        // Components are derived from package metadata — no single source
        // file maps to one row — so content_sha256 stays null. The release
        // row's package_sha256 covers integrity for the whole bundle.
        contentSha256: null,
        originJson,
      })
      .onConflictDoNothing()
      .run();
    result.inserted.components += 1;
  } else {
    tx.update(components)
      .set({
        name: entry.name,
        description: entry.description ?? "",
        symbolId: entry.symbol,
        footprintId: entry.defaultFootprint,
        tagsJson,
        isBuiltin,
        sourceId,
        version: entry.version,
        uuid: entry.uuid,
        originJson,
      })
      .where(eq(components.id, entry.id))
      .run();
    result.updated.components += 1;
  }

  // Reset variant rows. Idempotent. Variants from a re-import count as
  // `updated` even though the underlying SQL is delete-then-insert.
  const variantsExistedBefore = exists !== undefined;
  tx.delete(componentFootprints)
    .where(eq(componentFootprints.componentId, entry.id))
    .run();
  entry.footprints.forEach((variant, index) => {
    const pinMapJson = variant.pinMap
      ? JSON.stringify(variant.pinMap)
      : PASSIVE_PIN_MAP_FALLBACK;
    tx.insert(componentFootprints)
      .values({
        componentId: entry.id,
        footprintId: variant.footprint,
        isDefault: variant.footprint === entry.defaultFootprint ? 1 : 0,
        variantLabel: variant.label,
        sortOrder: index,
        pinMapJson,
      })
      .onConflictDoNothing()
      .run();
    if (variantsExistedBefore) result.updated.variants += 1;
    else result.inserted.variants += 1;
  });
}

function upsertFootprintModelMetadata(
  tx: ReturnType<typeof getDb>,
  fp: OpclibFootprintEntry,
  pkg: OpclibPackage,
  glbBySha: Map<string, StoredAssetInfo>,
  stepBySha: Map<string, StoredAssetInfo>,
  now: string,
): void {
  const modelIds = fp.models3d ?? [];
  if (modelIds.length === 0) return;
  // First model wins for the cached "default" 3D representation. The richer
  // multi-model story can be layered in later via a join table.
  const primary = pkg.manifest.models3d.find((m) => m.id === modelIds[0]);
  if (!primary) return;
  const glb = primary.formats.glb;
  if (!glb) return;
  const glbStored = glbBySha.get(glb.sha256);
  const step = primary.formats.step;
  const stepStored = step ? stepBySha.get(step.sha256) : undefined;
  const byteSize = glbStored?.byteSize ?? null;
  const sourceFilename = step?.path ? path.posix.basename(step.path) : null;
  // Manifest entries from `.opclib` v0.3+ carry the model transform fields
  // directly. Older packages don't, so we fall back to the OpenPCB-side
  // override map.
  // Cast through `unknown`: the installed `@openpcb/opclib-pack` v0.2 type
  // doesn't declare the optional transform fields yet (they were added in a
  // local edit and are read structurally here).
  const primaryTransform = primary as unknown as OpclibModel3dTransformFields;
  const manifestModelRef = modelRefFromManifest(primaryTransform);
  const modelRefJson = primaryTransform.transformBaked
    ? null
    : manifestModelRef
      ? JSON.stringify(manifestModelRef)
      : resolveModelRefOverride(fp.id);

  tx.insert(footprintModels)
    .values({
      footprintId: fp.id,
      status: "ready",
      glbPath: glbStored?.relativePath ?? `models/glb/${glb.sha256}.glb`,
      glbSha256: glb.sha256,
      sourceStepPath: stepStored?.relativePath ?? null,
      sourceStepSha256: step?.sha256 ?? null,
      sourceFilename,
      sourceByteSize: stepStored?.byteSize ?? null,
      modelRefJson,
      tessellationParamsJson: null,
      converterVersion: null,
      byteSize,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: footprintModels.footprintId,
      set: {
        status: "ready",
        glbPath: glbStored?.relativePath ?? `models/glb/${glb.sha256}.glb`,
        glbSha256: glb.sha256,
        sourceStepPath: stepStored?.relativePath ?? null,
        sourceStepSha256: step?.sha256 ?? null,
        sourceFilename,
        sourceByteSize: stepStored?.byteSize ?? null,
        modelRefJson,
        tessellationParamsJson: null,
        converterVersion: null,
        byteSize,
        errorMessage: null,
        updatedAt: now,
      },
    })
    .run();
}
