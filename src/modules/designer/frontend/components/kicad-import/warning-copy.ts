/**
 * Human copy for the KiCad import warning codes the current pipeline emits
 * (H14 P0). The wizard shows these sentences, never the raw code. H14 S0
 * replaces this table with the backend catalog (`report.ts`).
 *
 * `blocker` marks losses that change copper, mask, holes, the outline,
 * connectivity or the rules DRC applies ("capability"), or silk/fab only
 * ("cosmetic"); it drives the Done stage's manufacturing notice.
 */

import type { KicadProjectImportWarning } from "../../../../../sdks/designer";

export type ImportWarningBlocker = "capability" | "cosmetic";

export interface ImportWarningCopy {
  group: ImportWarningGroup;
  /** One sentence for the whole code, shown once per group of messages. */
  summary: string;
  blocker?: ImportWarningBlocker;
  /** Per-item backend messages are specific enough to list under the summary. */
  showItems?: boolean;
  /** Rewrites a per-item backend message into plain language. */
  rewrite?(message: string): string;
}

/** Section labels, in display order. */
export const IMPORT_WARNING_GROUP_LABEL = {
  components: "Parts",
  nets: "Nets",
  rules: "Design rules",
  geometry: "Board and zones",
  schematic: "Schematic",
  library: "Library and 3D models",
  source: "Project files",
} as const;

export type ImportWarningGroup = keyof typeof IMPORT_WARNING_GROUP_LABEL;

const GROUP_ORDER = Object.keys(IMPORT_WARNING_GROUP_LABEL) as ImportWarningGroup[];

// `<refdes>: Ingestion failed for <symbol lib_id> / <footprint lib_id>: <reason>`
const INGESTION_FAILED = /^(.+?): Ingestion failed for .+? \/ .+?: (.+)$/s;

function rewriteUnresolvedComponent(message: string): string {
  const match = INGESTION_FAILED.exec(message);
  if (!match) return message;
  return `${match[1]} can't be imported — ${match[2]}`;
}

const ZONE_LOSS: ImportWarningCopy = {
  group: "geometry",
  summary: "Part of a copper zone couldn't be imported.",
  blocker: "capability",
  showItems: true,
};

const SHEETS_FLATTENED: ImportWarningCopy = {
  group: "schematic",
  summary:
    "Hierarchical sheets were merged onto one sheet, which can join wires that were separate.",
  blocker: "capability",
};

const SYMBOL_UNREADABLE: ImportWarningCopy = {
  group: "schematic",
  summary: "Schematic symbols that couldn't be read were skipped.",
  blocker: "capability",
};

const COPY: Record<string, ImportWarningCopy> = {
  component_unresolved: {
    group: "components",
    summary: "Some parts couldn't be imported and are missing from the design.",
    blocker: "capability",
    showItems: true,
    rewrite: rewriteUnresolvedComponent,
  },
  schematic_part_skipped_no_component: {
    group: "schematic",
    summary: "Schematic symbols whose part couldn't be imported were left out.",
    blocker: "capability",
    showItems: true,
  },
  schematic_part_detail_unavailable: {
    group: "components",
    summary: "Some library parts had no placement data and were left out.",
    blocker: "capability",
  },
  pcb_placement_skipped_no_part: {
    group: "components",
    summary:
      "PCB footprints without a matching schematic symbol were left out.",
    blocker: "capability",
    showItems: true,
  },
  footprint_missing_lib_id: {
    group: "components",
    summary: "Footprints without a library ID were skipped.",
    blocker: "capability",
  },
  pcb_traces_missing_net_name: {
    group: "nets",
    summary: "Some tracks have no net name and may join the wrong net.",
    blocker: "capability",
  },
  kicad_custom_rules_ignored: {
    group: "rules",
    summary: "Custom design rules (.kicad_dru) were not imported.",
    blocker: "capability",
  },
  kicad_netclass_unknown: {
    group: "rules",
    summary: "Some nets use a net class the project doesn't define.",
    blocker: "capability",
    showItems: true,
  },
  kicad_netclass_pattern_unsupported: {
    group: "rules",
    summary: "Wildcard net class patterns were not applied.",
    blocker: "capability",
    showItems: true,
  },
  kicad_netclass_patterns_invalid: {
    group: "rules",
    summary: "The project's net class patterns couldn't be read.",
    blocker: "capability",
  },
  kicad_netclass_assignments_unsupported: {
    group: "rules",
    summary: "Some net class assignments couldn't be read.",
    blocker: "capability",
  },
  kicad_netclass_assignment_unknown_net: {
    group: "rules",
    summary: "Some net class assignments name nets this design doesn't have.",
    showItems: true,
  },
  net_class_invalid: {
    group: "rules",
    summary: "A net class couldn't be read; its rules were skipped.",
    blocker: "capability",
  },
  net_class_unknown_rules: {
    group: "rules",
    summary: "Some net class rules aren't supported yet and are not checked.",
    blocker: "capability",
    showItems: true,
  },
  board_outline_missing: {
    group: "geometry",
    summary: "No board outline was found; a default board size is used.",
    blocker: "capability",
  },
  layers_missing: {
    group: "geometry",
    summary: "The board file has no layer list.",
    blocker: "capability",
  },
  zone_extra_contour_dropped: ZONE_LOSS,
  zone_hole_invalid_import: ZONE_LOSS,
  zone_ring_invalid: ZONE_LOSS,
  zone_layer_unsupported: ZONE_LOSS,
  zone_no_copper_layer: ZONE_LOSS,
  zone_hatched_fill_as_solid: {
    group: "geometry",
    summary: "Hatched copper zones were imported as solid fills.",
    blocker: "capability",
    showItems: true,
  },
  zone_multilayer_split: {
    group: "geometry",
    summary: "Zones on several copper layers became one zone per layer.",
  },
  pcb_zones_imported: {
    group: "geometry",
    summary: "Copper zones were imported.",
  },
  arc_tessellated: {
    group: "geometry",
    summary: "Curved tracks were converted to straight segments.",
  },
  hierarchical_sheets_flattened: SHEETS_FLATTENED,
  hierarchical_sheets_flattened_summary: SHEETS_FLATTENED,
  sheet_missing_file: {
    group: "schematic",
    summary: "A hierarchical sheet doesn't say which file it uses.",
    blocker: "capability",
  },
  symbol_missing_lib_id: SYMBOL_UNREADABLE,
  symbol_missing_at: SYMBOL_UNREADABLE,
  refdes_collision_renamed: {
    group: "schematic",
    summary: "Duplicate reference designators on sub-sheets were renamed.",
  },
  wire_diagonal: {
    group: "schematic",
    summary: "Diagonal wires are straightened into horizontal and vertical runs.",
  },
  wires_dropped_degenerate: {
    group: "schematic",
    summary: "Zero-length schematic wires were removed.",
  },
  wire_anchor_synthesized: {
    group: "schematic",
    summary: "Wire ends that touched nothing were given connection points.",
  },
  models_3d_queued: {
    group: "library",
    summary: "Bundled 3D models are being converted for the 3D view.",
  },
  models_3d_skipped: {
    group: "library",
    summary: "Some 3D models weren't bundled in the ZIP and were skipped.",
  },
  layer_count_deferred: {
    group: "source",
    summary: "The layer count is taken from the board file.",
  },
};

/** Codes this table covers; the backend catalog test checks each is mapped there. */
export const IMPORT_WARNING_COPY_CODES: readonly string[] = Object.keys(COPY);

const FALLBACK: ImportWarningCopy = {
  group: "source",
  summary: "Other notes from the project files.",
  showItems: true,
};

/** Codes that carry a variable suffix (`wire_anchor_synthesized_floating`). */
function copyKey(code: string): string {
  return code.startsWith("wire_anchor_synthesized_")
    ? "wire_anchor_synthesized"
    : code;
}

export function importWarningCopy(code: string): ImportWarningCopy {
  return COPY[copyKey(code)] ?? FALLBACK;
}

export interface ImportWarningEntry {
  key: string;
  copy: ImportWarningCopy;
  severity: KicadProjectImportWarning["severity"];
  codes: string[];
  items: string[];
}

export interface ImportWarningSection {
  group: ImportWarningGroup;
  label: string;
  entries: ImportWarningEntry[];
}

/** Warnings grouped by section, one entry per (summary) code. */
export function groupImportWarnings(
  warnings: readonly KicadProjectImportWarning[],
): ImportWarningSection[] {
  const entries = new Map<string, ImportWarningEntry>();
  for (const warning of warnings) {
    const copy = importWarningCopy(warning.code);
    const key = copy === FALLBACK ? "__other" : copyKey(warning.code);
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, copy, severity: "info", codes: [], items: [] };
      entries.set(key, entry);
    }
    if (warning.severity === "warning") entry.severity = "warning";
    if (!entry.codes.includes(warning.code)) entry.codes.push(warning.code);
    entry.items.push(copy.rewrite ? copy.rewrite(warning.message) : warning.message);
  }
  return GROUP_ORDER.map((group) => ({
    group,
    label: IMPORT_WARNING_GROUP_LABEL[group],
    entries: [...entries.values()].filter((e) => e.copy.group === group),
  })).filter((section) => section.entries.length > 0);
}

/** Capability / cosmetic counts across the warnings (one per message). */
export function countImportBlockers(
  warnings: readonly KicadProjectImportWarning[],
): { capability: number; cosmetic: number } {
  let capability = 0;
  let cosmetic = 0;
  for (const warning of warnings) {
    const blocker = importWarningCopy(warning.code).blocker;
    if (blocker === "capability") capability += 1;
    else if (blocker === "cosmetic") cosmetic += 1;
  }
  return { capability, cosmetic };
}
