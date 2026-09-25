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
import { KicadProjectImportError, parseProjectFile } from "./errors";

export interface ResolvedProjectFiles {
  projectFileName: string;
  projectContent: string;
  pcbFileName: string;
  pcbContent: string;
  schematicSheets: Array<{ fileName: string; content: string }>;
  /**
   * The archive carried a `.kicad_dru` custom-rules file. OpenPCB does not
   * import KiCad's custom rule language (rule-semantics contract §9), and
   * silently ignoring a file whose whole purpose is extra constraints would be
   * fail-open — so the inspect report warns.
   */
  customRulesFileName?: string;
}

/**
 * Resolve project files from a ZIP buffer. Throws a 4xx problem when the bundle
 * is not a readable ZIP (400), is a KiCad 5 / library archive or is incomplete
 * (422, `KicadProjectImportError`).
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

  const pcbContent = pcb ? decode(pcb.bytes) : null;
  const legacyBoard =
    pcbContent !== null && isLegacyKicadBoard(pcbContent) ? pcb : null;
  if (!project) {
    const legacy = entries.find(
      (e) => e.extension === ".pro" || e.extension === ".sch",
    );
    const legacyFile = legacy?.baseName ?? legacyBoard?.baseName;
    if (legacyFile) throw legacyProjectError(legacyFile);
    if (entries.some((e) => KICAD_LIBRARY_EXTENSIONS.has(e.extension))) {
      throw new KicadProjectImportError(
        "library_archive",
        "This ZIP holds KiCad library files, not a project. Import symbols and footprints from the Library instead, or choose a ZIP that contains a .kicad_pro project.",
      );
    }
    throw new KicadProjectImportError(
      "missing_project",
      "The ZIP does not contain a KiCad project (.kicad_pro). Zip the whole project folder from KiCad 6 or newer and try again.",
    );
  }
  if (!pcb || pcbContent === null) {
    throw new KicadProjectImportError(
      "missing_board",
      "The ZIP does not contain a .kicad_pcb board file.",
    );
  }
  if (legacyBoard) throw legacyProjectError(legacyBoard.baseName);
  if (schematics.length === 0) {
    throw new KicadProjectImportError(
      "missing_schematic",
      "The ZIP does not contain any .kicad_sch schematic sheets.",
    );
  }

  // Sort sheets so the project-matching root sheet comes first; the inserters
  // process sheets in this order for deterministic refdes ordering on retry.
  schematics.sort((a, b) => {
    const aIsRoot = withoutExt(a.baseName) === projectBaseStem ? 0 : 1;
    const bIsRoot = withoutExt(b.baseName) === projectBaseStem ? 0 : 1;
    if (aIsRoot !== bIsRoot) return aIsRoot - bIsRoot;
    return a.path.localeCompare(b.path);
  });

  const customRules = entries.find((e) => e.extension === ".kicad_dru");

  return {
    projectFileName: project.baseName,
    projectContent: decode(project.bytes),
    pcbFileName: pcb.baseName,
    pcbContent,
    schematicSheets: schematics.map((s) => ({
      fileName: s.baseName,
      content: decode(s.bytes),
    })),
    ...(customRules ? { customRulesFileName: customRules.baseName } : {}),
  };
}

/** KiCad 6.0 wrote board format 20211014; everything older is KiCad 5 or earlier. */
const FIRST_KICAD6_BOARD_VERSION = 20211014;

const KICAD_LIBRARY_EXTENSIONS = new Set([
  ".kicad_sym",
  ".kicad_mod",
  ".lib",
]);

/**
 * `(kicad_pcb (version 20171130) …)` — read from the header alone, before any
 * parse, so a KiCad 5 board is named as such instead of failing somewhere deep
 * in the parser. A board with no readable version is left to the parser.
 */
function isLegacyKicadBoard(content: string): boolean {
  const match = /\(\s*kicad_pcb\s*\(\s*version\s+(\d+)\s*\)/.exec(
    content.slice(0, 512),
  );
  if (!match?.[1]) return false;
  return Number(match[1]) < FIRST_KICAD6_BOARD_VERSION;
}

function legacyProjectError(fileName: string): KicadProjectImportError {
  return new KicadProjectImportError(
    "legacy_kicad",
    "KiCad 5 projects (.pro/.sch) aren't supported yet. Open the project in KiCad 6 or newer, save it, then import the ZIP again.",
    { fileName },
  );
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
  const project = parseProjectFile(files.projectFileName, () =>
    parseKicadProject(files.projectContent),
  );
  pushWarnings(warnings, project.warnings, "info");

  if (files.customRulesFileName) {
    warnings.push({
      code: "kicad_custom_rules_ignored",
      severity: "warning",
      message: `'${files.customRulesFileName}' custom design rules (.kicad_dru) are not imported.`,
    });
  }

  // --- Parse PCB (authoritative for layer count + nets + outline) ---
  const pcb = parseProjectFile(files.pcbFileName, () =>
    parseKicadPcb(files.pcbContent),
  );
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
    const parsed = parseProjectFile(sheet.fileName, () =>
      parseKicadSchematic(sheet.content),
    );
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
    pcbKeepouts: pcb.keepoutCount,
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

  const netClassAssignments = foldNetClassAssignments(project, warnings);

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
    ...(Object.keys(project.designRules).length > 0
      ? { designRules: project.designRules }
      : {}),
    ...(Object.keys(netClassAssignments).length > 0
      ? { netClassAssignments }
      : {}),
    warnings,
  };
}

/** KiCad pattern wildcards; a pattern carrying one names no single net. */
const NETCLASS_PATTERN_WILDCARD = /[*?[]/;

/**
 * Fold the three KiCad per-net assignment formats into one net NAME → class
 * NAME map (rule-semantics contract §12.3). Precedence follows KiCad's own
 * file order: `classes[].nets` (v6) first, then `netclass_patterns` (v7/8),
 * then `netclass_assignments` (v9) — each later, more specific format
 * overrides. Only patterns free of wildcard characters name a real net; a
 * wildcard pattern warns rather than matching nothing silently.
 */
function foldNetClassAssignments(
  project: ReturnType<typeof parseKicadProject>,
  warnings: KicadProjectImportWarning[],
): Record<string, string> {
  const knownClasses = new Set(project.netClasses.map((c) => c.name));
  const out: Record<string, string> = {};
  const assign = (netName: string, className: string): void => {
    if (!knownClasses.has(className)) {
      warnings.push({
        code: "kicad_netclass_unknown",
        severity: "warning",
        message: `Net '${netName}' is assigned to net class '${className}', which the project does not declare; the assignment was skipped.`,
      });
      return;
    }
    out[netName] = className;
  };
  for (const netClass of project.netClasses) {
    for (const netName of netClass.nets) assign(netName, netClass.name);
  }
  for (const { pattern, netclass } of project.netClassPatterns) {
    if (NETCLASS_PATTERN_WILDCARD.test(pattern)) {
      warnings.push({
        code: "kicad_netclass_pattern_unsupported",
        severity: "warning",
        message: `Net-class pattern '${pattern}' → '${netclass}' uses wildcards, which are not imported; assign those nets manually.`,
      });
      continue;
    }
    assign(pattern, netclass);
  }
  for (const [netName, className] of Object.entries(
    project.netClassAssignments ?? {},
  )) {
    assign(netName, className);
  }
  return out;
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
