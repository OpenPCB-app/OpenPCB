/**
 * Import Grouping Heuristics
 *
 * Classifies KiCad footprint files into component family groups
 * using naming patterns, package codes, and manufacturer suffixes.
 */

export interface GroupingSuggestion {
  suggestedFamilyLabel: string;
  suggestedCanonicalKey: string;
  variants: VariantSuggestion[];
  confidence: number;
}

export interface VariantSuggestion {
  suggestedCanonicalCode: string;
  suggestedHumanLabel: string;
  footprintFileNames: string[];
  model3dFileNames: string[];
  confidence: number;
}

/** Imperial → Metric mapping for common chip sizes */
const IMPERIAL_METRIC_MAP: Record<string, string> = {
  "0201": "0603",
  "0402": "1005",
  "0603": "1608",
  "0805": "2012",
  "1206": "3216",
  "1210": "3225",
  "1812": "4532",
  "2010": "5025",
  "2512": "6332",
};

const METRIC_IMPERIAL_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(IMPERIAL_METRIC_MAP).map(([k, v]) => [v, k]),
);

export interface FootprintFileInfo {
  fileName: string;
  name: string; // parsed footprint name
  model3dFileNames: string[];
}

/**
 * Group footprint files into component family suggestions.
 */
export function groupFootprints(
  footprints: FootprintFileInfo[],
): GroupingSuggestion[] {
  const groups = new Map<string, FootprintFileInfo[]>();

  for (const fp of footprints) {
    const key = extractGroupKey(fp.name);
    const existing = groups.get(key) ?? [];
    existing.push(fp);
    groups.set(key, existing);
  }

  return [...groups.entries()].map(([key, fps]) =>
    buildGroupSuggestion(key, fps),
  );
}

/**
 * Extract a group key from a footprint name.
 * Strips hand-solder suffixes, normalizes manufacturer variants.
 */
export function extractGroupKey(name: string): string {
  let key = name;

  // Strip hand-solder suffix
  key = key.replace(/_Pad[\d.]+x[\d.]+mm_HandSolder$/i, "");

  // For manufacturer-specific electrolytic: group by size
  // e.g. CP_Elec_6.3x5.4_Nichicon → CP_Elec_6.3x5.4
  const mfrMatch = key.match(/^(CP_Elec_[\d.]+x[\d.]+)_\w+$/);
  if (mfrMatch) return mfrMatch[1]!;

  // For trimmer: keep as-is (separate family)
  if (key.startsWith("C_Trimmer_")) return key;

  // For standard chip: group by package code
  // e.g. C_0603_1608Metric → C_0603
  const chipMatch = key.match(/^(C[P]?_\d{4})(?:_\d+Metric)?$/);
  if (chipMatch) return chipMatch[1]!;

  return key;
}

/**
 * Extract package code from a footprint name.
 * Returns { imperial, metric } aliases if detectable.
 */
export function extractPackageCode(name: string): {
  code: string;
  imperial: string | null;
  metric: string | null;
} {
  // Chip pattern: C_0603_1608Metric
  const chipMatch = name.match(/^C[P]?_(\d{4})(?:_(\d+)Metric)?/);
  if (chipMatch) {
    const imperial = chipMatch[1]!;
    const metric = chipMatch[2] ?? IMPERIAL_METRIC_MAP[imperial] ?? null;
    return {
      code: imperial,
      imperial,
      metric,
    };
  }

  // Electrolytic pattern: CP_Elec_6.3x5.4
  const elecMatch = name.match(/^CP_Elec_([\d.]+x[\d.]+)/);
  if (elecMatch) {
    return { code: elecMatch[1]!, imperial: null, metric: null };
  }

  // Trimmer pattern
  const trimMatch = name.match(/^C_Trimmer_(\w+)/);
  if (trimMatch) {
    return { code: trimMatch[1]!, imperial: null, metric: null };
  }

  return { code: name, imperial: null, metric: null };
}

/**
 * Classify if a footprint is a hand-solder variant.
 */
export function isHandSolderVariant(name: string): boolean {
  return /_Pad[\d.]+x[\d.]+mm_HandSolder$/i.test(name);
}

/**
 * Detect if a footprint name is manufacturer-specific.
 */
export function isManufacturerSpecific(name: string): {
  isSpecific: boolean;
  manufacturer: string | null;
} {
  // CP_Elec_X.YxZ.W_ManufacturerName
  const match = name.match(/^CP_Elec_[\d.]+x[\d.]+_(\w+)$/);
  if (match) {
    return { isSpecific: true, manufacturer: match[1]! };
  }
  return { isSpecific: false, manufacturer: null };
}

/**
 * Detect if a footprint is polarized (CP_ prefix).
 */
export function isPolarized(name: string): boolean {
  return name.startsWith("CP_");
}

function buildGroupSuggestion(
  key: string,
  fps: FootprintFileInfo[],
): GroupingSuggestion {
  // Determine family label from key
  let familyLabel: string;
  let canonicalKey: string;

  if (key.startsWith("CP_Elec_")) {
    const size = key.replace("CP_Elec_", "");
    familyLabel = `Electrolytic Capacitor ${size}`;
    canonicalKey = `cp_elec_${size.replace(/\./g, "_")}`;
  } else if (key.startsWith("C_Trimmer_")) {
    familyLabel = `Trimmer Capacitor ${key.replace("C_Trimmer_", "")}`;
    canonicalKey = key.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  } else {
    const pkg = extractPackageCode(key);
    const prefix = isPolarized(key) ? "Polarized Capacitor" : "Chip Capacitor";
    const label = pkg.metric
      ? `${pkg.imperial} / ${pkg.metric} Metric`
      : pkg.code;
    familyLabel = `${prefix} ${label}`;
    canonicalKey = key.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  }

  // Split into nominal and hand-solder variants
  const nominal = fps.filter((fp) => !isHandSolderVariant(fp.name));
  const handSolder = fps.filter((fp) => isHandSolderVariant(fp.name));

  const variants: VariantSuggestion[] = [];

  if (nominal.length > 0) {
    const pkg = extractPackageCode(nominal[0]!.name);
    const humanLabel = pkg.metric
      ? `${pkg.imperial} / ${pkg.metric} Metric`
      : pkg.code;
    variants.push({
      suggestedCanonicalCode: pkg.code,
      suggestedHumanLabel: humanLabel,
      footprintFileNames: nominal.map((fp) => fp.fileName),
      model3dFileNames: nominal.flatMap((fp) => fp.model3dFileNames),
      confidence: 0.9,
    });
  }

  if (handSolder.length > 0) {
    const pkg = extractPackageCode(handSolder[0]!.name);
    variants.push({
      suggestedCanonicalCode: `${pkg.code}_handsolder`,
      suggestedHumanLabel: `${pkg.code} Hand Solder`,
      footprintFileNames: handSolder.map((fp) => fp.fileName),
      model3dFileNames: handSolder.flatMap((fp) => fp.model3dFileNames),
      confidence: 0.85,
    });
  }

  return {
    suggestedFamilyLabel: familyLabel,
    suggestedCanonicalKey: canonicalKey,
    variants,
    confidence: variants.length > 0 ? 0.9 : 0.5,
  };
}
