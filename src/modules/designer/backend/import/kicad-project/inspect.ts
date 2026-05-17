/**
 * KiCad project import — inspect phase.
 *
 * Parses a ZIP archive containing a KiCad project (.kicad_pro + at least one
 * .kicad_sch + a .kicad_pcb) and produces a report describing what would
 * happen on commit, plus any warnings or dropped data.
 *
 * NO database writes happen here. The wizard renders this report and the user
 * confirms before commit() is called.
 */

import type {
  KicadProjectImportComponentRow,
  KicadProjectImportCounts,
  KicadProjectImportNetClass,
  KicadProjectImportWarning,
  KicadProjectInspectReport,
} from "../../../../../sdks/designer";
import { extractZipEntries } from "../../../../library/backend/import/archive/extract-zip";
import { parseKicadProject } from "../../../../library/backend/infrastructure/parsers/kicad/kicad-project-parser";
import { parseKicadSchematic } from "../../../../library/backend/infrastructure/parsers/kicad/kicad-schematic-parser";
import { parseKicadPcb } from "../../../../library/backend/infrastructure/parsers/kicad/kicad-pcb-parser";

export interface ResolvedProjectFiles {
  projectFileName: string;
  projectContent: string;
  pcbFileName: string;
  pcbContent: string;
  schematicSheets: Array<{ fileName: string; content: string }>;
}

/**
 * Resolve project files from a ZIP buffer. Throws when the bundle is incomplete.
 */
export function resolveProjectFiles(
  archiveBytes: Uint8Array,
): ResolvedProjectFiles {
  const entries = extractZipEntries(archiveBytes).filter(isMeaningfulEntry);
  const project = entries.find((e) => e.extension === ".kicad_pro");
  // Pick the .kicad_pcb at the same directory depth as the .kicad_pro, falling
  // back to any .kicad_pcb. Same for the root schematic sheet (matching base
  // name is the canonical root in KiCad).
  const projectDir = project ? dirOf(project.path) : "";
  const projectBaseStem = project ? withoutExt(project.baseName) : "";
  const pcb =
    entries.find(
      (e) => e.extension === ".kicad_pcb" && dirOf(e.path) === projectDir,
    ) ?? entries.find((e) => e.extension === ".kicad_pcb");
  const schematics = entries
    .filter((e) => e.extension === ".kicad_sch")
    // Prefer sheets in the same dir as .kicad_pro; if there are nested
    // backup copies (e.g. `…-backups/…`), drop them.
    .filter((e) => !/(^|\/)([^/]*-backups|\.backup)\//i.test(e.path));

  if (!project) {
    throw new Error("ZIP archive does not contain a .kicad_pro project file");
  }
  if (!pcb) {
    throw new Error("ZIP archive does not contain a .kicad_pcb board file");
  }
  if (schematics.length === 0) {
    throw new Error("ZIP archive does not contain any .kicad_sch sheets");
  }

  // Sort sheets so the project-matching root sheet comes first; the inserters
  // process sheets in this order for deterministic refdes ordering on retry.
  schematics.sort((a, b) => {
    const aIsRoot = withoutExt(a.baseName) === projectBaseStem ? 0 : 1;
    const bIsRoot = withoutExt(b.baseName) === projectBaseStem ? 0 : 1;
    if (aIsRoot !== bIsRoot) return aIsRoot - bIsRoot;
    return a.path.localeCompare(b.path);
  });

  return {
    projectFileName: project.baseName,
    projectContent: decode(project.bytes),
    pcbFileName: pcb.baseName,
    pcbContent: decode(pcb.bytes),
    schematicSheets: schematics.map((s) => ({
      fileName: s.baseName,
      content: decode(s.bytes),
    })),
  };
}

/**
 * Filter out macOS resource forks (`__MACOSX/*` or files whose base name
 * starts with `._`), hidden OS artefacts, and ZIP-internal lock files —
 * none of which carry KiCad project content but can match by extension when
 * macOS bundles them into a ZIP via Finder.
 */
function isMeaningfulEntry(entry: { path: string; baseName: string }): boolean {
  if (entry.path.startsWith("__MACOSX/") || entry.path.includes("/__MACOSX/")) {
    return false;
  }
  if (entry.baseName.startsWith("._")) return false;
  if (entry.baseName.toLowerCase() === ".ds_store") return false;
  if (entry.baseName === "Thumbs.db") return false;
  if (entry.baseName.startsWith("~_autosave-")) return false;
  if (entry.baseName.endsWith(".lck")) return false;
  return true;
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

function withoutExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(0, dot) : name;
}

/**
 * Parse all resolved files and build the inspect report. No DB access; safe
 * to call from a hot path.
 *
 * @param libraryComponentLookup — async callback the caller wires up so we can
 *   determine reuse vs ingest status for each lib_id. Returning `null` means
 *   the component is not present in the OpenPCB library and would need to be
 *   ingested at commit time.
 */
export async function buildInspectReport(
  files: ResolvedProjectFiles,
  libraryComponentLookup: (libId: string) => Promise<string | null>,
): Promise<KicadProjectInspectReport> {
  const warnings: KicadProjectImportWarning[] = [];

  // --- Parse project ---
  const project = parseKicadProject(files.projectContent);
  pushWarnings(warnings, project.warnings, "info");

  // --- Parse PCB (authoritative for layer count + nets + outline) ---
  const pcb = parseKicadPcb(files.pcbContent);
  pushWarnings(warnings, pcb.warnings, "warning");

  // --- Parse schematic sheets ---
  const allSymbols: Array<{ libId: string; reference: string }> = [];
  let totalWires = 0;
  let totalLabels = 0;
  let totalGlobalLabels = 0;
  let totalPowerSymbols = 0;
  let totalJunctions = 0;
  let totalNoConnects = 0;
  let totalSheets = 0;
  for (const sheet of files.schematicSheets) {
    const parsed = parseKicadSchematic(sheet.content);
    pushWarnings(warnings, parsed.warnings, "info");
    for (const sym of parsed.symbols) {
      allSymbols.push({ libId: sym.libId, reference: sym.reference });
    }
    totalWires += parsed.wires.length;
    totalLabels += parsed.labels.length;
    totalGlobalLabels += parsed.globalLabels.length;
    totalPowerSymbols += parsed.powerSymbols.length;
    totalJunctions += parsed.junctions.length;
    totalNoConnects += parsed.noConnects.length;
    totalSheets += parsed.hierarchicalSheets.length;
  }

  // Hierarchical sheets are flattened in v1; we keep only the root sheet.
  // Surface the count as info for the user.
  if (totalSheets > 0) {
    warnings.push({
      code: "hierarchical_sheets_flattened_summary",
      severity: "info",
      message: `Project contains ${totalSheets} hierarchical sheet(s) across ${files.schematicSheets.length} file(s); v1 flattens them.`,
    });
  }

  // --- Component reuse/ingest table ---
  // Collect unique lib_ids referenced by either schematic symbols (symbol lib_id)
  // OR PCB footprints (footprint lib_id). These are two different namespaces:
  // schematic uses LibraryName:SymbolName, PCB uses LibraryName:FootprintName.
  // For matching we keep them as separate rows.
  const componentRowsByLibId = new Map<
    string,
    KicadProjectImportComponentRow
  >();
  for (const sym of allSymbols) {
    appendComponentReference(
      componentRowsByLibId,
      `sym:${sym.libId}`,
      sym.libId,
      sym.reference,
    );
  }
  for (const fp of pcb.footprints) {
    appendComponentReference(
      componentRowsByLibId,
      `fp:${fp.libId}`,
      fp.libId,
      fp.reference,
    );
  }

  for (const row of componentRowsByLibId.values()) {
    const matched = await libraryComponentLookup(row.libId);
    if (matched) {
      row.status = "reuse";
      row.componentId = matched;
    } else {
      // v1 does not ingest the project's embedded symbols/footprints into the
      // OpenPCB library automatically. Surface the gap so the wizard can show
      // "N components missing; will be skipped on commit" until library
      // ingestion lands.
      row.status = "missing";
      row.reason =
        "Component not found in OpenPCB library; will be deferred until library ingestion is wired.";
    }
  }

  const counts: KicadProjectImportCounts = {
    schematicSymbols: allSymbols.length,
    schematicWires: totalWires,
    schematicLabels: totalLabels,
    schematicGlobalLabels: totalGlobalLabels,
    schematicPowerSymbols: totalPowerSymbols,
    schematicJunctions: totalJunctions,
    schematicNoConnects: totalNoConnects,
    hierarchicalSheets: totalSheets,
    pcbFootprints: pcb.footprints.length,
    pcbSegments: pcb.segments.length,
    pcbVias: pcb.vias.length,
    pcbZones: pcb.zoneCount,
  };

  const netClasses: KicadProjectImportNetClass[] = project.netClasses.map(
    (nc) => ({
      name: nc.name,
      clearanceMm: nc.clearanceMm,
      trackWidthMm: nc.trackWidthMm,
      viaDiameterMm: nc.viaDiameterMm,
      viaDrillMm: nc.viaDrillMm,
      unknownRules: nc.unknownRules,
    }),
  );

  return {
    projectName:
      project.name ?? files.projectFileName.replace(/\.kicad_pro$/i, ""),
    copperLayerCount: pcb.copperLayerCount,
    schematicSheetCount: files.schematicSheets.length,
    netCount: pcb.nets.length,
    boardOutlineMm: pcb.boardOutline,
    components: [...componentRowsByLibId.values()].sort((a, b) =>
      a.libId.localeCompare(b.libId),
    ),
    counts,
    netClasses,
    warnings,
  };
}

function appendComponentReference(
  rows: Map<string, KicadProjectImportComponentRow>,
  key: string,
  libId: string,
  reference: string,
): void {
  const existing = rows.get(key);
  if (existing) {
    if (!existing.references.includes(reference)) {
      existing.references.push(reference);
    }
    return;
  }
  rows.set(key, {
    libId,
    references: [reference],
    status: "missing",
    componentId: null,
  });
}

function pushWarnings(
  out: KicadProjectImportWarning[],
  parsed: Array<{ code: string; message: string }>,
  severity: "info" | "warning",
): void {
  for (const w of parsed) {
    out.push({ code: w.code, message: w.message, severity });
  }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
