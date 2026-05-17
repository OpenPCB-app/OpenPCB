/**
 * KiCad Project File Parser (.kicad_pro)
 *
 * Reference: https://dev-docs.kicad.org/en/file-formats/index.html
 *
 * Targets KiCad v7+ project files (JSON). Extracts the minimum fields needed
 * for OpenPCB's project-import inspect report:
 *   - layer count (2 vs 4 vs other)
 *   - net classes (name + electrical rules; unknown keys preserved as opaque metadata)
 *   - project metadata (name)
 * Other sections (3D viewer, ERC, IPC-D-356, plot, schematic settings) are
 * intentionally ignored in v1.
 */

export interface ParsedKicadProject {
  name: string | null;
  /** Number of copper layers, derived from board stackup. */
  layerCount: number | null;
  netClasses: ParsedKicadNetClass[];
  warnings: ParsedKicadProjectWarning[];
  /** Raw JSON for provenance. */
  rawSource: string;
}

export interface ParsedKicadNetClass {
  name: string;
  /** Trace width in mm. */
  clearanceMm: number | null;
  trackWidthMm: number | null;
  viaDiameterMm: number | null;
  viaDrillMm: number | null;
  /**
   * Unknown / unsupported KiCad rules (diff pair gap, microvia, uvia, etc.)
   * kept as opaque metadata. v1 DRC does not consume these.
   */
  unknownRules: Record<string, unknown>;
}

export interface ParsedKicadProjectWarning {
  code: string;
  message: string;
}

interface RawProjectJson {
  meta?: { filename?: unknown; version?: unknown };
  board?: { layer_presets?: unknown; design_settings?: unknown };
  net_settings?: { classes?: unknown };
  [key: string]: unknown;
}

const KNOWN_NET_CLASS_KEYS = new Set([
  "name",
  "clearance",
  "track_width",
  "via_diameter",
  "via_drill",
  "nets",
  "priority",
  "schematic_color",
  "pcb_color",
]);

export function parseKicadProject(source: string): ParsedKicadProject {
  const warnings: ParsedKicadProjectWarning[] = [];
  let parsed: RawProjectJson;
  try {
    parsed = JSON.parse(source) as RawProjectJson;
  } catch (error) {
    throw new Error(
      `Failed to parse .kicad_pro: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const name = extractProjectName(parsed);
  const layerCount = extractLayerCount(parsed, warnings);
  const netClasses = extractNetClasses(parsed, warnings);

  return {
    name,
    layerCount,
    netClasses,
    warnings,
    rawSource: source,
  };
}

function extractProjectName(json: RawProjectJson): string | null {
  const filename = json.meta?.filename;
  if (typeof filename === "string" && filename.length > 0) {
    return filename.replace(/\.kicad_pro$/i, "");
  }
  return null;
}

function extractLayerCount(
  json: RawProjectJson,
  warnings: ParsedKicadProjectWarning[],
): number | null {
  // KiCad stores the copper count under board.design_settings.rules.min_copper_edge_clearance
  // ... but the authoritative source is the `.kicad_pcb` setup (layers ...) block.
  // The project file only carries layer *presets* (visibility groups), not the
  // canonical stackup. Defer to the PCB parser for the real layer count and
  // emit a warning here only if presets reveal an inner layer reference.
  const presets = (json.board as { layer_presets?: unknown } | undefined)
    ?.layer_presets;
  if (!Array.isArray(presets)) {
    return null;
  }
  let sawInner = false;
  for (const preset of presets) {
    const flat = JSON.stringify(preset ?? "");
    if (/In[0-9]+\.Cu/.test(flat)) {
      sawInner = true;
      break;
    }
  }
  if (sawInner) {
    warnings.push({
      code: "layer_count_deferred",
      message:
        "Project file references inner copper layers; authoritative layer count comes from .kicad_pcb.",
    });
  }
  return null;
}

function extractNetClasses(
  json: RawProjectJson,
  warnings: ParsedKicadProjectWarning[],
): ParsedKicadNetClass[] {
  const classes = json.net_settings?.classes;
  if (!Array.isArray(classes)) {
    return [];
  }
  return classes.map((raw, index) => parseNetClass(raw, index, warnings));
}

function parseNetClass(
  raw: unknown,
  index: number,
  warnings: ParsedKicadProjectWarning[],
): ParsedKicadNetClass {
  if (!isRecord(raw)) {
    warnings.push({
      code: "net_class_invalid",
      message: `Net class at index ${index} is not an object; skipped fields.`,
    });
    return {
      name: `Class${index}`,
      clearanceMm: null,
      trackWidthMm: null,
      viaDiameterMm: null,
      viaDrillMm: null,
      unknownRules: {},
    };
  }
  const name = typeof raw.name === "string" ? raw.name : `Class${index}`;
  const unknownRules: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!KNOWN_NET_CLASS_KEYS.has(key)) {
      unknownRules[key] = value;
    }
  }
  if (Object.keys(unknownRules).length > 0) {
    warnings.push({
      code: "net_class_unknown_rules",
      message: `Net class '${name}' has unsupported rules preserved as opaque metadata: ${Object.keys(unknownRules).join(", ")}`,
    });
  }
  return {
    name,
    clearanceMm: numericOrNull(raw.clearance),
    trackWidthMm: numericOrNull(raw.track_width),
    viaDiameterMm: numericOrNull(raw.via_diameter),
    viaDrillMm: numericOrNull(raw.via_drill),
    unknownRules,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numericOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
