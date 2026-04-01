/**
 * Component Library Semantic Contract
 *
 * Defines exact meanings for all package-aware entities, decision tables,
 * and behavioral rules. This is the decision anchor for all library code.
 */

// ---------------------------------------------------------------------------
// Graphics Primitives (subset from symbol-editor types)
// ---------------------------------------------------------------------------

export type SymbolGraphic =
  | {
      type: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      strokeWidth: number;
    }
  | {
      type: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      filled: boolean;
      strokeWidth: number;
    }
  | {
      type: "circle";
      cx: number;
      cy: number;
      radius: number;
      filled: boolean;
      strokeWidth: number;
    }
  | {
      type: "arc";
      cx: number;
      cy: number;
      radius: number;
      startAngle: number;
      endAngle: number;
      strokeWidth: number;
    }
  | {
      type: "polygon";
      points: Array<{ x: number; y: number }>;
      filled: boolean;
      closed: boolean;
      strokeWidth: number;
    }
  | {
      type: "text";
      x: number;
      y: number;
      content: string;
      fontSize: number;
      rotation: number;
    };

// ---------------------------------------------------------------------------
// Entity hierarchy
// ---------------------------------------------------------------------------

/** Scope of a component family or preset catalog */
export type ComponentScope = "built_in" | "workspace";

/** Mount type for a package variant */
export type MountType = "smd" | "through_hole" | "virtual";

/**
 * Logical component family (e.g. "Ceramic Capacitor", "Resistor").
 * Top-level entity — not a single package or MPN.
 */
export interface ComponentFamily {
  id: string;
  canonicalKey: string; // unique per scope, e.g. "ceramic_capacitor"
  displayLabel: string; // human label, e.g. "Ceramic Capacitor"
  description: string;
  scope: ComponentScope;
  symbolData: SymbolData;
  packageVariants: PackageVariant[];
  defaultPackageVariantId: string | null;
  categoryPath: string | null; // e.g. "Passives/Resistors/Chip"
  tags: string[]; // e.g. ["SMD", "0603", "Ceramic"]
}

/** Symbol data attached to a family (shared across all variants) */
export interface SymbolData {
  referencePrefix: string; // e.g. "R", "C", "U"
  pinDefinitions: PinDefinition[];
  properties: Record<string, string>;
  unitCount: number; // number of units for multi-unit symbols (default: 1)
  bodyGraphics: SymbolGraphic[]; // converted graphics primitives
  rawKicadSource: string | null; // preserve original for round-trip export
}

export interface PinDefinition {
  name: string;
  electricalType: PinElectricalType;
}

export type PinElectricalType =
  | "passive"
  | "input"
  | "output"
  | "bidirectional"
  | "power_in"
  | "power_out"
  | "open_collector"
  | "open_emitter"
  | "unspecified";

/**
 * One physical package a family can come in (e.g. "0603 / 1608 Metric").
 */
export interface PackageVariant {
  id: string;
  familyId: string;
  canonicalCode: string; // unique within family, e.g. "0603"
  humanLabel: string; // e.g. "0603 / 1608 Metric"
  imperialAlias: string | null;
  metricAlias: string | null;
  mountType: MountType;
  dimensions: PackageDimensions | null;
  isDefault: boolean;
  pinRemapTable: PinRemapTable | null;
  footprintOptions: FootprintOption[];
  defaultFootprintOptionId: string | null;
  offerings: ManufacturerOffering[];
}

export interface PackageDimensions {
  lengthMm: number;
  widthMm: number;
  heightMm: number | null;
}

/**
 * Pin remap: maps family-level pin names to variant-specific pad names.
 * Key = family pin name, Value = variant pad name.
 */
export type PinRemapTable = Record<string, string>;

/**
 * One footprint option within a package variant (e.g. nominal, hand-solder).
 */
export interface FootprintOption {
  id: string;
  variantId: string;
  label: string; // e.g. "Nominal", "Hand Solder", "Most (M)"
  isDefault: boolean;
  kicadPayload: unknown; // raw KiCad footprint data (JSON)
  densityLevel?: "most" | "nominal" | "least" | null;
  ipcName?: string | null;
  model3dOptions: Model3DOption[];
  defaultModel3dOptionId: string | null;
}

/**
 * 3D model linked to a footprint option.
 */
export interface Model3DOption {
  id: string;
  footprintOptionId: string;
  fileName: string;
  stepAssetPath: string | null; // path to original STEP file
  gltfPreviewPath: string | null; // path to generated GLTF preview
  isDefault: boolean;
  linkStatus: Model3DLinkStatus;
}

export type Model3DLinkStatus =
  | "valid"
  | "missing_target"
  | "orphan_asset"
  | "shared_body";

/**
 * Manufacturer offering (MPN) under a specific package variant.
 */
export interface ManufacturerOffering {
  id: string;
  variantId: string;
  mpn: string;
  manufacturer: string;
  datasheetUrl: string | null;
}

// ---------------------------------------------------------------------------
// Draft & revision
// ---------------------------------------------------------------------------

export interface ComponentDraft {
  id: string;
  familyId: string | null; // null for new families
  wizardStep: number;
  payload: ComponentDraftPayload;
  warnings: ImportWarning[];
}

export interface ComponentDraftPayload {
  displayLabel: string;
  description: string;
  symbolData: SymbolData;
  packageVariants: PackageVariant[];
  defaultPackageVariantId: string | null;
}

export interface ComponentRevision {
  id: string;
  familyId: string;
  revisionNumber: number;
  snapshot: ComponentDraftPayload;
  publishedAt: string;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export interface ComponentProvenance {
  id: string;
  familyId: string;
  sourceFileNames: string[];
  sourceHashes: Record<string, string>; // fileName → SHA-256
  importTimestamp: string;
  kicadIdentifiers: Record<string, string>; // original KiCad UUIDs/names
  heuristicDecisions: string[];
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportWarning {
  code: ImportWarningCode;
  message: string;
  severity: "warning" | "blocker";
  context: Record<string, string>;
}

export type ImportWarningCode =
  | "missing_symbol_data"
  | "zero_package_variants"
  | "no_default_variant"
  | "variant_missing_default_footprint"
  | "unresolved_pin_remap"
  | "broken_internal_ids"
  | "duplicate_canonical_code"
  | "missing_3d_model"
  | "orphan_model_file"
  | "missing_datasheet"
  | "absent_offerings"
  | "import_ambiguity"
  | "unsupported_construct";

// ---------------------------------------------------------------------------
// Schematic instance selection
// ---------------------------------------------------------------------------

export interface SchematicComponentSelection {
  componentFamilyId: string;
  componentRevisionId: string;
  selectedPackageVariantId: string;
  selectedFootprintOptionId: string;
}

// ---------------------------------------------------------------------------
// Preset catalog
// ---------------------------------------------------------------------------

export interface PresetCatalog {
  id: string;
  name: string;
  scope: ComponentScope;
  isImmutable: boolean;
  variants: PresetVariant[];
}

export interface PresetVariant {
  id: string;
  catalogId: string;
  canonicalCode: string;
  humanLabel: string;
  imperialAlias: string | null;
  metricAlias: string | null;
  mountType: MountType;
  typicalDimensions: PackageDimensions | null;
  pinCount: number | null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  blockers: ValidationIssue[];
  warnings: ValidationIssue[];
  canPublish: boolean;
}

export interface ValidationIssue {
  code: ImportWarningCode;
  message: string;
  entityId: string | null;
  entityType: string | null;
}

/** Codes that BLOCK publish */
export const PUBLISH_BLOCKERS: ReadonlySet<ImportWarningCode> = new Set([
  "missing_symbol_data",
  "zero_package_variants",
  "no_default_variant",
  "variant_missing_default_footprint",
  "unresolved_pin_remap",
  "broken_internal_ids",
  "duplicate_canonical_code",
]);

/** Codes that are WARNING-ONLY (never block publish) */
export const PUBLISH_WARNINGS: ReadonlySet<ImportWarningCode> = new Set([
  "missing_3d_model",
  "orphan_model_file",
  "missing_datasheet",
  "absent_offerings",
  "import_ambiguity",
  "unsupported_construct",
]);

// ---------------------------------------------------------------------------
// Package switch
// ---------------------------------------------------------------------------

export type SwitchOutcome =
  | "auto_apply" // identity or pin-compatible → apply silently
  | "auto_fallback" // remap ok but footprint invalid → use new default footprint
  | "requires_confirmation" // remap changes pin associations or pin count mismatch
  | "blocked"; // impossible switch (e.g. broken references)

export interface SwitchPreview {
  outcome: SwitchOutcome;
  sourceVariantId: string;
  targetVariantId: string;
  newFootprintOptionId: string | null;
  affectedPins: string[];
  confirmationMessage: string | null;
}

/**
 * Determine switch outcome based on source and target variant.
 */
export function determineSwitchOutcome(
  source: PackageVariant,
  target: PackageVariant,
  familyPins: PinDefinition[],
  currentFootprintOptionId: string,
): SwitchOutcome {
  // Same variant → identity
  if (source.id === target.id) return "auto_apply";

  // Check if target has a default footprint
  if (!target.defaultFootprintOptionId) return "blocked";

  const sourcePinNames = new Set(
    source.pinRemapTable
      ? Object.values(source.pinRemapTable)
      : familyPins.map((p) => p.name),
  );
  const targetPinNames = new Set(
    target.pinRemapTable
      ? Object.values(target.pinRemapTable)
      : familyPins.map((p) => p.name),
  );

  // Pin count mismatch → requires confirmation
  if (sourcePinNames.size !== targetPinNames.size) {
    return "requires_confirmation";
  }

  // Check if all pin names match (identity mapping)
  const allMatch = [...sourcePinNames].every((p) => targetPinNames.has(p));
  if (!allMatch) {
    return "requires_confirmation";
  }

  // Pins match — check if current footprint exists in target
  const footprintExistsInTarget = target.footprintOptions.some(
    (fp) => fp.id === currentFootprintOptionId,
  );
  if (!footprintExistsInTarget) {
    return "auto_fallback";
  }

  return "auto_apply";
}

// ---------------------------------------------------------------------------
// Preset inheritance
// ---------------------------------------------------------------------------

/**
 * Rules for preset duplication:
 * - Built-in presets are immutable (scope=built_in, isImmutable=true)
 * - Workspace presets are created by duplicating a built-in
 * - After duplication, the workspace copy is DETACHED — no upstream merge
 * - Users can edit workspace presets freely
 */
export function canEditPreset(preset: PresetCatalog): boolean {
  return !preset.isImmutable;
}

export function canDuplicatePreset(preset: PresetCatalog): boolean {
  return true; // any preset can be duplicated
}
