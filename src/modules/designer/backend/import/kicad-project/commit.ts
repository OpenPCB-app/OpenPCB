/**
 * KiCad project import — commit phase.
 *
 * Full pipeline:
 *   1. Parse + inspect (counts, warnings, components-reuse-vs-missing). No DB writes.
 *   2. Library-ingest project-embedded symbols + footprints; cache componentId
 *      per (symbolLibId, footprintLibId) pair and per refdes. Each library
 *      `commitKicadImport` call manages its own transaction; ingest rows are
 *      content-hashed so a partial failure leaves no orphans of concern.
 *   3. Pre-resolve LibraryComponentPlacementDetail for each ingested component
 *      (async hop done outside the inserter transaction).
 *   4. Single Drizzle transaction:
 *        a. Insert design head + board settings.
 *        b. Insert flattened schematic entities (parts + pins, labels,
 *           power primitives, wires).
 *        c. Insert PCB entities (placements with positions from .kicad_pcb,
 *           traces, vias).
 *        d. Insert synthetic `import_kicad_project` command-log row.
 *
 * Hierarchical sheets are flattened at parse time: every .kicad_sch file in
 * the archive is parsed independently and merged into one flat sheet.
 */

import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  KicadProjectCommitResult,
  KicadProjectDeferredEntityKind,
  KicadProjectImportWarning,
  PcbBoardSettings,
  PcbDesignRules,
  PcbLayerCount,
  PcbNetClass,
} from "../../../../../sdks/designer";
import type {
  LibraryComponentPlacementDetail,
  LibrarySDK,
} from "../../../../../sdks/library";
import { parsePcbLayerCount } from "../../../../../sdks/designer";
import { DEFAULT_HOLE_TO_HOLE_MM } from "../../../../../shared/drc/rule-resolver";
import { MODULE_SDK_TOKENS } from "../../../../../sdks";
import type { CoreBackendModuleContext } from "../../../../../core/contracts/modules/backend-module";
import { resolveCaptureRuntime } from "../../capture";
import { commandLog, designHeads, pcbEntities } from "../../schema";
import { createDefaultPcbBoardSettings } from "../../pcb/pcb-defaults";
import { serializePcbBoardSettings } from "../../pcb/pcb-store";
import { parseKicadSchematic } from "../../../../library/backend/infrastructure/parsers/kicad/kicad-schematic-parser";
import { parseKicadPcb } from "../../../../library/backend/infrastructure/parsers/kicad/kicad-pcb-parser";
import {
  buildInspectReport,
  resolveProjectFiles,
  type ResolvedProjectFiles,
} from "./inspect";
import { ingestProjectComponents } from "./ingest-library";
import { ingestProjectModels } from "./ingest-models";
import { insertSchematicEntities } from "./insert-schematic";
import { adjustBoardCenter, insertPcbEntities } from "./insert-pcb";
import { flattenSheets } from "./flatten-sheets";
import { loadSchematicProjection } from "../../projection-read";
import { netNamesFromSchematic } from "../../pcb/pcb-projection";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

type LibraryLookup = (libId: string) => Promise<string | null>;

export interface CommitOptions {
  designName?: string;
  archiveFileName: string;
  archiveBytes: Uint8Array;
  libraryComponentLookup: LibraryLookup;
}

export async function commitKicadProjectImport(
  ctx: CoreBackendModuleContext,
  options: CommitOptions,
): Promise<KicadProjectCommitResult> {
  const files = resolveProjectFiles(options.archiveBytes);
  const report = await buildInspectReport(
    files,
    options.libraryComponentLookup,
  );

  const timestamp = new Date().toISOString();
  const designId = crypto.randomUUID();
  const designName = (options.designName?.trim() || report.projectName).slice(
    0,
    255,
  );

  // Re-parse with full per-sheet detail (the inspect report keeps a thin
  // summary; the inserters need the full ECS-shaped output).
  const rawSchematics = files.schematicSheets.map((sheet) =>
    parseKicadSchematic(sheet.content),
  );
  // Flatten hierarchical sheets with refdes-collision rename pass.
  const flatten = flattenSheets(rawSchematics);
  const schematics = flatten.sheets;
  const pcb = parseKicadPcb(files.pcbContent);
  const settings = buildBoardSettings(
    report,
    timestamp,
    pcb.boardOutlinePolygon,
  );
  const warnings: KicadProjectImportWarning[] = [
    ...report.warnings,
    ...flatten.warnings,
  ];

  // Step 2 — library ingestion. Outside the design transaction because the
  // library module opens its own transactions per commit; ingestion is
  // idempotent (content-hashed) so partial progress on retry is fine.
  const ingestion = await ingestProjectComponents(ctx, {
    schematics,
    pcb,
    pcbSource: files.pcbContent,
    preexistingLookup: options.libraryComponentLookup,
  });
  for (const unresolved of ingestion.unresolved) {
    warnings.push({
      code: "component_unresolved",
      severity: "warning",
      message: `${unresolved.refdes}: ${unresolved.reason}`,
    });
  }

  // Step 2b — attach 3D models bundled in the project ZIP to their footprints.
  // Best-effort: matches by basename; silently skips when models are not
  // bundled (which is the common case for KiCad projects that reference
  // global model libraries via absolute path).
  const modelIngestion = await ingestProjectModels(ctx, {
    archiveBytes: options.archiveBytes,
    pcbFootprints: pcb.footprints,
    componentByRefdes: ingestion.componentByRefdes,
    ingestionEntries: ingestion.entries,
  });
  if (modelIngestion.modelsQueued > 0) {
    warnings.push({
      code: "models_3d_queued",
      severity: "info",
      message: `Queued ${modelIngestion.modelsQueued} 3D model(s) for STEP→GLB conversion.`,
    });
  }
  if (modelIngestion.modelsSkippedMissing > 0) {
    warnings.push({
      code: "models_3d_skipped",
      severity: "info",
      message: `Skipped ${modelIngestion.modelsSkippedMissing} 3D model reference(s) not bundled in the ZIP.`,
    });
  }

  const library = ctx.sdk.get<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
  if (!library) {
    throw new Error(
      "Library SDK unavailable; cannot complete KiCad project import",
    );
  }

  // Step 3 — pre-resolve placement details so the inserters can be fully sync
  // (Drizzle's better-sqlite3 transaction callback is synchronous).
  const placementDetailByComponentId = new Map<
    string,
    LibraryComponentPlacementDetail | null
  >();
  for (const componentId of new Set(ingestion.componentByRefdes.values())) {
    const detail = await library.resolveComponentForPlacement(componentId);
    placementDetailByComponentId.set(componentId, detail);
  }

  // Step 4 — single transaction with all design-side inserts.
  const txResult = ctx.db.transaction(
    (
      txRaw,
    ): {
      schematic: ReturnType<typeof insertSchematicEntities>;
      pcb: ReturnType<typeof insertPcbEntities>;
    } => {
      const tx = txRaw as DbClient;

      tx.insert(designHeads)
        .values({
          id: designId,
          name: designName,
          revision: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();

      tx.insert(pcbEntities)
        .values({
          id: crypto.randomUUID(),
          designId,
          kind: "board_settings",
          payloadJson: serializePcbBoardSettings(undefined, settings),
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();

      const schematic = insertSchematicEntities(
        tx,
        {
          designId,
          schematics,
          componentByRefdes: ingestion.componentByRefdes,
          placementDetailByComponentId,
        },
        timestamp,
      );

      // Per-net class assignments are keyed by net NAME in the project file,
      // but OpenPCB stores them by net ID — and net ids only exist once the
      // schematic projection can derive them from the inserted wires/labels
      // (rule-semantics contract §12.3). So resolve them here, after the
      // schematic insert, and rewrite the settings row.
      const assignments = resolvePerNetClassAssignments(
        tx,
        designId,
        settings,
        report.netClassAssignments ?? {},
        warnings,
      );
      if (Object.keys(assignments).length > 0) {
        tx.update(pcbEntities)
          .set({
            // The row was inserted from `settings` a few statements above, so
            // there is no stored payload with unknown keys to carry over.
            payloadJson: serializePcbBoardSettings(undefined, {
              ...settings,
              perNetClassAssignments: assignments,
            }),
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(pcbEntities.designId, designId),
              eq(pcbEntities.kind, "board_settings"),
            ),
          )
          .run();
      }

      const pcbResult = insertPcbEntities(
        tx,
        {
          designId,
          pcb,
          partIdByRefdes: schematic.partIdByRefdes,
          boardCenterMm: adjustBoardCenter(pcb.boardOutline),
        },
        timestamp,
      );

      // Synthetic command-log row — informational, marks the design as
      // KiCad-imported in undo/history traces.
      tx.insert(commandLog)
        .values({
          commandId: crypto.randomUUID(),
          designId,
          sessionId: "import-kicad-project",
          commandType: "import_kicad_project",
          commandJson: JSON.stringify({
            type: "import_kicad_project",
            archiveFileName: options.archiveFileName,
            projectName: report.projectName,
            schematicSheetCount: report.schematicSheetCount,
            ingestedComponents: ingestion.entries.length,
          }),
          resultJson: JSON.stringify({
            partsInserted: schematic.partsInserted,
            wiresInserted: schematic.wiresInserted,
            labelsInserted: schematic.labelsInserted,
            primitivesInserted: schematic.primitivesInserted,
            tracesInserted: pcbResult.tracesInserted,
            viasInserted: pcbResult.viasInserted,
          }),
          issuedAt: Date.now(),
          appliedRevision: 0,
          createdAt: timestamp,
        })
        .run();

      return { schematic, pcb: pcbResult };
    },
  );
  const { schematic: schematicSummary, pcb: pcbSummary } = txResult;

  warnings.push(...schematicSummary.warnings, ...pcbSummary.warnings);

  // Dataset capture (WP-D4): the importer bypasses dispatchCommand (it inserts
  // entities directly + one synthetic commandLog row), so actor:"import" is
  // recorded here — the only place with the data. Fail-isolated in the runtime.
  resolveCaptureRuntime(ctx).onImportCommitted(designId, {
    designName,
    partsInserted: schematicSummary.partsInserted,
    wiresInserted: schematicSummary.wiresInserted,
    pcbTracesInserted: pcbSummary.tracesInserted,
    pcbViasInserted: pcbSummary.viasInserted,
  });

  // Track what could not be fully ingested. With the full pipeline in place,
  // we only mark `library_ingestion` / `schematic_symbols` deferred if the
  // schematic referenced symbols but we ended up inserting zero parts.
  const deferred: KicadProjectDeferredEntityKind[] = [];
  if (
    report.counts.schematicSymbols > 0 &&
    schematicSummary.partsInserted === 0
  ) {
    deferred.push("schematic_symbols", "library_ingestion");
  }

  ctx.logger.info("imported KiCad project", {
    designId,
    designName,
    copperLayerCount: report.copperLayerCount,
    netClassesIngested: settings.netClasses.length,
    componentsIngested: ingestion.entries.length,
    componentsUnresolved: ingestion.unresolved.length,
    partsInserted: schematicSummary.partsInserted,
    wiresInserted: schematicSummary.wiresInserted,
    wiresDropped: schematicSummary.wiresDropped,
    labelsInserted: schematicSummary.labelsInserted,
    primitivesInserted: schematicSummary.primitivesInserted,
    pcbPlacementsRepositioned: pcbSummary.placementsRepositioned,
    pcbTracesInserted: pcbSummary.tracesInserted,
    pcbViasInserted: pcbSummary.viasInserted,
    warningCount: warnings.length,
  });

  return {
    designId,
    designName,
    applied: {
      boardOutline:
        settings.outline.widthMm > 0 && settings.outline.heightMm > 0,
      copperLayerCount: report.copperLayerCount,
      netClassesIngested: settings.netClasses.length,
      deferred,
    },
    warnings,
  };
}

/**
 * Re-export for tests + future refactors. The wizard uses this without
 * touching commit() when it only needs the report.
 */
export async function inspectKicadProjectFromBytes(
  archiveBytes: Uint8Array,
  libraryComponentLookup: LibraryLookup,
): Promise<{
  files: ResolvedProjectFiles;
  report: Awaited<ReturnType<typeof buildInspectReport>>;
}> {
  const files = resolveProjectFiles(archiveBytes);
  const report = await buildInspectReport(files, libraryComponentLookup);
  return { files, report };
}

/** Map parsed report → PcbBoardSettings, falling back to OpenPCB defaults. */
function buildBoardSettings(
  report: Awaited<ReturnType<typeof buildInspectReport>>,
  timestamp: string,
  polygonPoints: Array<{ xMm: number; yMm: number }> | null,
): PcbBoardSettings {
  const base = createDefaultPcbBoardSettings(timestamp);
  const layerCount = pickLayerCount(report.copperLayerCount, base.layerCount);
  const outline = pickOutline(
    report.boardOutlineMm,
    base.outline,
    polygonPoints,
  );
  const netClasses = mergeNetClasses(base.netClasses, report.netClasses);
  return {
    ...base,
    layerCount,
    outline,
    netClasses,
    designRules: applyKicadDesignRules(base.designRules, report),
  };
}

/** A KiCad minimum that is present; 0 is legitimate, so never truthiness. */
function isFiniteNumber(v: number | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * KiCad's project minimums and its `Default` class clearance → OpenPCB's
 * design rules (rule-semantics contract §12.3). Every mapping is 1:1 and every
 * source field is optional: an absent KiCad minimum keeps OpenPCB's default
 * rather than inventing a number. A KiCad minimum of 0 is legitimate (its own
 * `min_clearance` default is 0) and must survive, so the guard is
 * "is a finite number", never truthiness.
 *
 * The board's per-kind clearances take the KiCad `Default` class clearance —
 * KiCad's working clearance for unclassed nets — while the FLOOR stays the
 * project's `min_clearance`, which reproduces KiCad's "class clearance,
 * floored by the board minimum" semantics.
 */
function applyKicadDesignRules(
  base: PcbDesignRules,
  report: Awaited<ReturnType<typeof buildInspectReport>>,
): PcbDesignRules {
  const rules = report.designRules ?? {};
  const num = (v: number | undefined, fallback: number): number =>
    isFiniteNumber(v) ? v : fallback;
  const defaultClearanceMm = report.netClasses.find(
    (nc) => nc.name.toLowerCase() === "default",
  )?.clearanceMm;
  const working =
    typeof defaultClearanceMm === "number" && Number.isFinite(defaultClearanceMm)
      ? defaultClearanceMm
      : null;
  const clearance: PcbDesignRules["clearance"] = {
    ...base.clearance,
    ...(working !== null
      ? {
          traceToTraceMm: working,
          traceToPadMm: working,
          padToPadMm: working,
          traceToViaMm: working,
          viaToViaMm: working,
        }
      : {}),
    copperToBoardEdgeMm: num(
      rules.minCopperEdgeClearanceMm,
      base.clearance.copperToBoardEdgeMm,
    ),
    // `min_hole_clearance` is KiCad's copper-to-hole rule — OpenPCB's
    // `copperToHoleMm` (batch-DRC contract 06 §4). Optional on both sides: a
    // project without it leaves the key absent, which reads as the copper ↔
    // edge rule, so no board is retroactively tightened.
    ...(isFiniteNumber(rules.minHoleClearanceMm)
      ? { copperToHoleMm: rules.minHoleClearanceMm }
      : {}),
  };
  // KiCad has ONE drill minimum; it floors both the plain drill and the via
  // drill (§12.3).
  const drillMm = num(rules.minThroughHoleMm, base.minimums.drillSizeMm);
  const minimums: PcbDesignRules["minimums"] = {
    ...base.minimums,
    traceWidthMm: num(rules.minTrackWidthMm, base.minimums.traceWidthMm),
    drillSizeMm: drillMm,
    viaDrillMm:
      typeof rules.minThroughHoleMm === "number" &&
      Number.isFinite(rules.minThroughHoleMm)
        ? rules.minThroughHoleMm
        : base.minimums.viaDrillMm,
    annularRingMm: num(rules.minViaAnnularMm, base.minimums.annularRingMm),
    viaDiameterMm: num(rules.minViaDiameterMm, base.minimums.viaDiameterMm),
    holeToHoleMm: num(
      rules.minHoleToHoleMm,
      base.minimums.holeToHoleMm ?? DEFAULT_HOLE_TO_HOLE_MM,
    ),
    clearanceMm: num(rules.minClearanceMm, base.minimums.clearanceMm ?? 0),
  };
  return { ...base, clearance, minimums };
}

/**
 * Net NAME → class NAME (from the project file) resolved against the design's
 * real nets and class ids. A name that matches no net, or a class that the
 * merged class list does not carry, is skipped WITH a warning — a silently
 * dropped assignment would leave a net quietly on the default class.
 */
function resolvePerNetClassAssignments(
  tx: DbClient,
  designId: string,
  settings: PcbBoardSettings,
  byNetName: Record<string, string>,
  warnings: KicadProjectImportWarning[],
): Record<string, string> {
  if (Object.keys(byNetName).length === 0) return {};
  const netIdByName = new Map<string, string>();
  for (const [netId, netName] of netNamesFromSchematic(
    loadSchematicProjection(tx, designId),
  )) {
    // Two nets can share a display name; the first in projection order wins,
    // which is the same tie-break every other name lookup uses.
    if (!netIdByName.has(netName)) netIdByName.set(netName, netId);
  }
  const classIdByName = new Map(
    settings.netClasses.map((c) => [c.name.toLowerCase(), c.id]),
  );
  const out: Record<string, string> = {};
  for (const [netName, className] of Object.entries(byNetName)) {
    const netId = netIdByName.get(netName);
    if (!netId) {
      warnings.push({
        code: "kicad_netclass_assignment_unknown_net",
        severity: "warning",
        message: `Net class '${className}' is assigned to net '${netName}', which this design has no net for; the assignment was skipped.`,
      });
      continue;
    }
    // Guard, not a live branch today: `foldNetClassAssignments` already drops
    // an assignment naming a class the PROJECT does not declare (tested at
    // inspect level), and `mergeNetClasses` puts every declared class on the
    // board. It stays so a future merge that filters classes cannot silently
    // leave a net on the default class.
    const classId = classIdByName.get(className.toLowerCase());
    if (!classId) {
      warnings.push({
        code: "kicad_netclass_unknown",
        severity: "warning",
        message: `Net '${netName}' is assigned to net class '${className}', which was not imported; the assignment was skipped.`,
      });
      continue;
    }
    out[netId] = classId;
  }
  return out;
}

function pickLayerCount(
  fromKicad: number,
  fallback: PcbLayerCount,
): PcbLayerCount {
  // parsePcbLayerCount preserves 6/8/… stackups (P2); only fall back to the
  // existing board count when KiCad reported nothing usable.
  return fromKicad >= 2 ? parsePcbLayerCount(fromKicad) : fallback;
}

function pickOutline(
  fromKicad: {
    minXMm: number;
    minYMm: number;
    maxXMm: number;
    maxYMm: number;
  } | null,
  fallback: PcbBoardSettings["outline"],
  polygonPoints: Array<{ xMm: number; yMm: number }> | null,
): PcbBoardSettings["outline"] {
  if (!fromKicad) return fallback;
  const widthMm = Math.max(1, fromKicad.maxXMm - fromKicad.minXMm);
  const heightMm = Math.max(1, fromKicad.maxYMm - fromKicad.minYMm);
  const centerMm = {
    x: (fromKicad.minXMm + fromKicad.maxXMm) / 2,
    y: (fromKicad.minYMm + fromKicad.maxYMm) / 2,
  };
  // Prefer a polygon outline when the parser chained Edge.Cuts into a closed
  // loop — preserves rounded corners and cutouts. Bbox kept on the polygon
  // payload so non-polygon-aware consumers (fab presets, 3D shell) still
  // work without traversing the point list.
  if (polygonPoints && polygonPoints.length >= 3) {
    return {
      kind: "polygon",
      widthMm,
      heightMm,
      centerMm,
      pointsMm: polygonPoints.map((p) => ({ x: p.xMm, y: p.yMm })),
    };
  }
  return {
    kind: "rect",
    widthMm,
    heightMm,
    centerMm,
  };
}

function mergeNetClasses(
  defaults: PcbNetClass[],
  fromKicad: Awaited<ReturnType<typeof buildInspectReport>>["netClasses"],
): PcbNetClass[] {
  const byName = new Map<string, PcbNetClass>();
  for (const nc of defaults) byName.set(nc.name.toLowerCase(), nc);
  // Class ids must be unique (the design-rules save refuses duplicates), and
  // two KiCad names can slug alike ("USB+" / "USB-").
  const usedIds = new Set(defaults.map((nc) => nc.id));

  for (const incoming of fromKicad) {
    const key = incoming.name.toLowerCase();
    const existing = byName.get(key);
    const merged: PcbNetClass = {
      id: existing?.id ?? uniqueId(slugify(incoming.name), usedIds),
      name: incoming.name,
      traceWidthMm: incoming.trackWidthMm ?? existing?.traceWidthMm ?? 0.25,
      clearanceMm: incoming.clearanceMm ?? existing?.clearanceMm ?? 0.25,
      viaDiameterMm: incoming.viaDiameterMm ?? existing?.viaDiameterMm ?? 0.8,
      viaDrillMm: incoming.viaDrillMm ?? existing?.viaDrillMm ?? 0.4,
      color: existing?.color ?? "#d4d4d8",
      defaultViaProtection: existing?.defaultViaProtection ?? "tented",
    };
    byName.set(key, merged);
  }
  return [...byName.values()];
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
  used.add(id);
  return id;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "class"
  );
}
