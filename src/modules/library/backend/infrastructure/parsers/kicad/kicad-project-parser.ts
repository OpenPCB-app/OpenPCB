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
  /**
   * `net_settings.netclass_patterns` (KiCad 7/8): `{ pattern, netclass }`.
   * Only patterns free of wildcard characters name a real net (§12.3).
   */
  netClassPatterns: ParsedKicadNetClassPattern[];
  /**
   * `net_settings.netclass_assignments` (KiCad 9) when it is a plain
   * `netName → className` object; `null` when the key is absent, and an empty
   * object when it is present but empty (every v9 file in the corpus).
   */
  netClassAssignments: Record<string, string> | null;
  /** `board.design_settings.rules` — the project-wide minimums (§12.3). */
  designRules: ParsedKicadProjectDesignRules;
  warnings: ParsedKicadProjectWarning[];
  /** Raw JSON for provenance. */
  rawSource: string;
}

export interface ParsedKicadNetClassPattern {
  pattern: string;
  netclass: string;
}

/**
 * KiCad's project-wide minimums (`board.design_settings.rules`), in mm. Every
 * field is optional: an older project may carry only some of them, and a
 * missing minimum must NOT be invented (rule-semantics contract §12.3).
 * `min_hole_clearance` maps to `clearance.copperToHoleMm` (batch-DRC contract
 * 06 §4) — the copper-to-non-plated-drill rule.
 */
export interface ParsedKicadProjectDesignRules {
  minClearanceMm?: number;
  minTrackWidthMm?: number;
  minViaDiameterMm?: number;
  minThroughHoleMm?: number;
  minViaAnnularMm?: number;
  minHoleToHoleMm?: number;
  minCopperEdgeClearanceMm?: number;
  /** `min_hole_clearance` — copper edge to a (non-plated) drill wall. */
  minHoleClearanceMm?: number;
}

export interface ParsedKicadNetClass {
  name: string;
  /** Trace width in mm. */
  clearanceMm: number | null;
  trackWidthMm: number | null;
  viaDiameterMm: number | null;
  viaDrillMm: number | null;
  /** `classes[].nets` (KiCad 6): exact net names assigned to this class. */
  nets: string[];
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
  net_settings?: {
    classes?: unknown;
    netclass_patterns?: unknown;
    netclass_assignments?: unknown;
  };
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
    netClassPatterns: extractNetClassPatterns(parsed, warnings),
    netClassAssignments: extractNetClassAssignments(parsed, warnings),
    designRules: extractProjectDesignRules(parsed),
    warnings,
    rawSource: source,
  };
}

/**
 * `board.design_settings.rules` → the project minimums. Verbatim mapping of
 * rule-semantics contract §12.3; a value of 0 is a legitimate KiCad minimum
 * (its own `min_clearance` default is 0) and must survive, so the guard is
 * "finite number", never truthiness.
 */
function extractProjectDesignRules(
  json: RawProjectJson,
): ParsedKicadProjectDesignRules {
  const settings = (json.board as { design_settings?: unknown } | undefined)
    ?.design_settings;
  const rules = isRecord(settings) ? settings.rules : undefined;
  if (!isRecord(rules)) return {};
  const out: ParsedKicadProjectDesignRules = {};
  const put = (
    key: keyof ParsedKicadProjectDesignRules,
    raw: unknown,
  ): void => {
    const value = numericOrNull(raw);
    if (value !== null) out[key] = value;
  };
  put("minClearanceMm", rules.min_clearance);
  put("minTrackWidthMm", rules.min_track_width);
  put("minViaDiameterMm", rules.min_via_diameter);
  put("minThroughHoleMm", rules.min_through_hole_diameter);
  put("minViaAnnularMm", rules.min_via_annular_width);
  put("minHoleToHoleMm", rules.min_hole_to_hole);
  put("minCopperEdgeClearanceMm", rules.min_copper_edge_clearance);
  put("minHoleClearanceMm", rules.min_hole_clearance);
  return out;
}

function extractNetClassPatterns(
  json: RawProjectJson,
  warnings: ParsedKicadProjectWarning[],
): ParsedKicadNetClassPattern[] {
  const raw = json.net_settings?.netclass_patterns;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push({
      code: "kicad_netclass_patterns_invalid",
      message: "net_settings.netclass_patterns is not an array; ignored.",
    });
    return [];
  }
  const out: ParsedKicadNetClassPattern[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const pattern = entry.pattern;
    const netclass = entry.netclass;
    if (typeof pattern !== "string" || typeof netclass !== "string") continue;
    if (pattern.length === 0 || netclass.length === 0) continue;
    out.push({ pattern, netclass });
  }
  return out;
}

function extractNetClassAssignments(
  json: RawProjectJson,
  warnings: ParsedKicadProjectWarning[],
): Record<string, string> | null {
  const raw = json.net_settings?.netclass_assignments;
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) {
    warnings.push({
      code: "kicad_netclass_assignments_unsupported",
      message:
        "net_settings.netclass_assignments is not a netName → className object; per-net assignments from it were not imported.",
    });
    return null;
  }
  const out: Record<string, string> = {};
  for (const [netName, className] of Object.entries(raw)) {
    if (typeof className !== "string" || className.length === 0) {
      warnings.push({
        code: "kicad_netclass_assignments_unsupported",
        message: `net_settings.netclass_assignments['${netName}'] is not a class name; skipped.`,
      });
      continue;
    }
    out[netName] = className;
  }
  return out;
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
      nets: [],
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
    nets: Array.isArray(raw.nets)
      ? raw.nets.filter((n): n is string => typeof n === "string" && n.length > 0)
      : [],
    unknownRules,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numericOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
