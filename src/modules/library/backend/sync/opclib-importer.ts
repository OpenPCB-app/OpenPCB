import { and, eq, inArray } from "drizzle-orm";
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
import { writeGlb } from "../services/footprint-model-store";
import { readAssetBytes, readAssetJson } from "./opclib-reader";
import type {
  ImportResult,
  InstallOrigin,
  OpclibComponentEntry,
  OpclibFootprintEntry,
  OpclibPackage,
} from "./types";

interface ImporterOptions {
  installOrigin: InstallOrigin;
}

const PASSIVE_PIN_MAP_FALLBACK = JSON.stringify([
  { pinNumber: "1", padNumber: "1", pinName: "1" },
  { pinNumber: "2", padNumber: "2", pinName: "2" },
]);

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

  // GLB writes are content-addressed (sha256 → <userData>/models/glb/<sha>.glb)
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
  const model3dBySha = new Map<
    string,
    { byteSize: number; deduped: boolean }
  >();
  for (const model of pkg.manifest.models3d) {
    const glb = model.formats.glb;
    if (!glb) continue;
    const bytes = readAssetBytes(pkg, glb.path);
    pendingGlbs.push({ sha256: glb.sha256, bytes, modelId: model.id });
  }

  // Run GLB writes before the DB transaction. They are content-addressed and
  // idempotent.
  // NOTE: writeGlb is async; we accumulate promises then resolve serially.
  const glbWritePromises = pendingGlbs.map(async (p) => {
    const stored = await writeGlb(p.bytes, p.sha256);
    model3dBySha.set(p.sha256, {
      byteSize: stored.byteSize,
      deduped: stored.deduped,
    });
    if (stored.deduped) result.models.deduped += 1;
    else result.models.written += 1;
    return { ...p, relativePath: stored.relativePath };
  });

  await Promise.all(glbWritePromises);

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
        signatureValid: 0,
        installedAt: now,
        manifestJson: JSON.stringify(pkg.manifest),
      })
      .onConflictDoUpdate({
        target: [releases.sourceId, releases.version],
        set: {
          channel: lib.channel,
          installOrigin: opts.installOrigin,
          packageSha256: pkg.manifest.integrity.packageSha256,
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
        model3dBySha,
        now,
      );
    }

    // 5. components + variant join rows
    for (const entry of pkg.manifest.components) {
      upsertComponent(transactionalDb, entry, lib.id, now, result);
    }
  });

  return result;
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
  model3dBySha: Map<string, { byteSize: number; deduped: boolean }>,
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
  const stats = model3dBySha.get(glb.sha256);
  const byteSize = stats?.byteSize ?? null;

  tx.insert(footprintModels)
    .values({
      footprintId: fp.id,
      status: "ready",
      glbPath: `models/glb/${glb.sha256}.glb`,
      glbSha256: glb.sha256,
      sourceStepPath: null,
      sourceStepSha256: primary.formats.step?.sha256 ?? null,
      sourceFilename: null,
      sourceByteSize: null,
      modelRefJson: null,
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
        glbPath: `models/glb/${glb.sha256}.glb`,
        glbSha256: glb.sha256,
        byteSize,
        updatedAt: now,
      },
    })
    .run();
}
