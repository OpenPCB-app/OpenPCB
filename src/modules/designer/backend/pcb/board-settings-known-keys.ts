// The known-key lists of the board-settings serializer
// (`board-settings-serialize.ts`, contract 15 §2.1). "Known" is an EXPLICIT
// list, never `Object.keys(next)`: `next` omits a known optional key the user
// just emptied, and reading known-ness off the runtime object would resurrect
// it. Every list carries a compile-time exhaustiveness assertion, so adding a
// field to one of these types without listing it here fails `tsc`.

import type {
  AutoLayoutConfig,
  AutoLayoutPlaceConfig,
  AutoLayoutRouteConfig,
  PcbBoardSettings,
  PcbDesignRules,
  PcbDiffPair,
  PcbDrcRule,
  PcbLengthMatchGroup,
  PcbNetClass,
  PcbViewState,
} from "../../../../sdks/designer";
import type { BoardSettingsRowParsers } from "./board-settings-serialize";

export const SCHEMA_VERSION_KEY = "schemaVersion";

type Exhaustive<T, K extends readonly PropertyKey[]> =
  Exclude<keyof T, K[number]> extends never ? true : false;
/** Fails to instantiate when a list below is missing a key of its type. */
type AssertExhaustive<T extends true> = T;

const BOARD_SETTINGS_KEYS = [
  "outline",
  "cutouts",
  "activeLayer",
  "visibleLayers",
  "designRules",
  "netClasses",
  "perNetClassAssignments",
  "drcSeverityOverrides",
  "drcRules",
  "diffPairs",
  "lengthMatchGroups",
  "tracePresets",
  "fabricator",
  "layerCount",
  "boardThicknessMm",
  "displayMode",
  "solderMaskExpansionMm",
  "solderPasteExpansionMm",
  "viewState",
  "updatedAt",
] as const satisfies readonly (keyof PcbBoardSettings)[];
type _BoardSettingsKeys = AssertExhaustive<
  Exhaustive<PcbBoardSettings, typeof BOARD_SETTINGS_KEYS>
>;

const DESIGN_RULE_KEYS = [
  "clearance",
  "minimums",
  "electrical",
  "silkscreen",
  "solderMask",
  "dfm",
  "outline",
] as const satisfies readonly (keyof PcbDesignRules)[];
type _DesignRuleKeys = AssertExhaustive<
  Exhaustive<PcbDesignRules, typeof DESIGN_RULE_KEYS>
>;

const CLEARANCE_KEYS = [
  "traceToTraceMm",
  "traceToPadMm",
  "padToPadMm",
  "traceToViaMm",
  "viaToViaMm",
  "copperToBoardEdgeMm",
  "holeToBoardEdgeMm",
  "pourToCopperMm",
  "copperToHoleMm",
] as const satisfies readonly (keyof PcbDesignRules["clearance"])[];
type _ClearanceKeys = AssertExhaustive<
  Exhaustive<PcbDesignRules["clearance"], typeof CLEARANCE_KEYS>
>;

const MINIMUMS_KEYS = [
  "traceWidthMm",
  "drillSizeMm",
  "annularRingMm",
  "viaDiameterMm",
  "viaDrillMm",
  "holeToHoleMm",
  "clearanceMm",
] as const satisfies readonly (keyof PcbDesignRules["minimums"])[];
type _MinimumsKeys = AssertExhaustive<
  Exhaustive<PcbDesignRules["minimums"], typeof MINIMUMS_KEYS>
>;

type ElectricalRules = NonNullable<PcbDesignRules["electrical"]>;
const ELECTRICAL_KEYS = [
  "tempRiseC",
  "copperWeightOz",
  "innerCopperWeightOz",
  "outerConductors",
] as const satisfies readonly (keyof ElectricalRules)[];
type _ElectricalKeys = AssertExhaustive<
  Exhaustive<ElectricalRules, typeof ELECTRICAL_KEYS>
>;

type SilkscreenRules = NonNullable<PcbDesignRules["silkscreen"]>;
const SILKSCREEN_KEYS = [
  "silkToMaskClearanceMm",
  "silkToBoardEdgeMm",
] as const satisfies readonly (keyof SilkscreenRules)[];
type _SilkscreenKeys = AssertExhaustive<
  Exhaustive<SilkscreenRules, typeof SILKSCREEN_KEYS>
>;

type SolderMaskRules = NonNullable<PcbDesignRules["solderMask"]>;
const SOLDER_MASK_KEYS = [
  "minBridgeMm",
] as const satisfies readonly (keyof SolderMaskRules)[];
type _SolderMaskKeys = AssertExhaustive<
  Exhaustive<SolderMaskRules, typeof SOLDER_MASK_KEYS>
>;

type DfmRules = NonNullable<PcbDesignRules["dfm"]>;
const DFM_KEYS = [
  "sliverWidthMm",
  "sliverMinLengthMm",
  "acuteAngleDeg",
  "courtyardFallbackMm",
] as const satisfies readonly (keyof DfmRules)[];
type _DfmKeys = AssertExhaustive<Exhaustive<DfmRules, typeof DFM_KEYS>>;

type OutlineRules = NonNullable<PcbDesignRules["outline"]>;
const OUTLINE_KEYS = [
  "minWebMm",
] as const satisfies readonly (keyof OutlineRules)[];
type _OutlineKeys = AssertExhaustive<
  Exhaustive<OutlineRules, typeof OUTLINE_KEYS>
>;

const VIEW_STATE_KEYS = [
  "displayMode",
  "viewSide",
  "perLayerOpacity",
  "layerPreset",
  "ratsnestVisible",
  "alignmentGuidesVisible",
  "drcIgnoredRuleClasses",
  "drcWaivedViolationIds",
  "autoLayoutConfig",
] as const satisfies readonly (keyof PcbViewState)[];
type _ViewStateKeys = AssertExhaustive<
  Exhaustive<PcbViewState, typeof VIEW_STATE_KEYS>
>;

const AUTO_LAYOUT_KEYS = [
  "runPlace",
  "runRoute",
  "preset",
  "effort",
  "scope",
  "place",
  "route",
] as const satisfies readonly (keyof AutoLayoutConfig)[];
type _AutoLayoutKeys = AssertExhaustive<
  Exhaustive<AutoLayoutConfig, typeof AUTO_LAYOUT_KEYS>
>;

const AUTO_LAYOUT_PLACE_KEYS = [
  "allowRotate",
  "allowFlip",
  "moveConnectors",
  "respectExistingTraces",
  "targetUtilization",
] as const satisfies readonly (keyof AutoLayoutPlaceConfig)[];
type _AutoLayoutPlaceKeys = AssertExhaustive<
  Exhaustive<AutoLayoutPlaceConfig, typeof AUTO_LAYOUT_PLACE_KEYS>
>;

const AUTO_LAYOUT_ROUTE_KEYS = [
  "geometryMode",
  "allowVias",
  "maxViasPerNet",
  "serializePours",
] as const satisfies readonly (keyof AutoLayoutRouteConfig)[];
type _AutoLayoutRouteKeys = AssertExhaustive<
  Exhaustive<AutoLayoutRouteConfig, typeof AUTO_LAYOUT_ROUTE_KEYS>
>;

const NET_CLASS_KEYS = [
  "id",
  "name",
  "traceWidthMm",
  "clearanceMm",
  "viaDiameterMm",
  "viaDrillMm",
  "color",
  "defaultViaProtection",
  "diffPairGapMm",
  "voltageV",
  "voltageMinV",
  "voltageMaxV",
  "currentA",
] as const satisfies readonly (keyof PcbNetClass)[];
type _NetClassKeys = AssertExhaustive<
  Exhaustive<PcbNetClass, typeof NET_CLASS_KEYS>
>;

const DIFF_PAIR_KEYS = [
  "id",
  "name",
  "pNetId",
  "nNetId",
  "gapMm",
  "gapTolMm",
  "maxUncoupledMm",
  "maxSkewMm",
  "couplingMaxGapMm",
] as const satisfies readonly (keyof PcbDiffPair)[];
type _DiffPairKeys = AssertExhaustive<
  Exhaustive<PcbDiffPair, typeof DIFF_PAIR_KEYS>
>;

const LENGTH_GROUP_KEYS = [
  "id",
  "name",
  "netIds",
  "target",
  "toleranceMm",
] as const satisfies readonly (keyof PcbLengthMatchGroup)[];
type _LengthGroupKeys = AssertExhaustive<
  Exhaustive<PcbLengthMatchGroup, typeof LENGTH_GROUP_KEYS>
>;

const DRC_RULE_KEYS = [
  "id",
  "name",
  "enabled",
  "priority",
  "scopes",
  "constraint",
  "severity",
  "comment",
] as const satisfies readonly (keyof PcbDrcRule)[];
type _DrcRuleKeys = AssertExhaustive<
  Exhaustive<PcbDrcRule, typeof DRC_RULE_KEYS>
>;

export const KNOWN_TOP_LEVEL = new Set<string>([
  ...BOARD_SETTINGS_KEYS,
  SCHEMA_VERSION_KEY,
]);
export const KNOWN_DESIGN_RULES = new Set<string>(DESIGN_RULE_KEYS);
export const KNOWN_VIEW_STATE = new Set<string>(VIEW_STATE_KEYS);
export const KNOWN_AUTO_LAYOUT = new Set<string>(AUTO_LAYOUT_KEYS);
export const KNOWN_AUTO_LAYOUT_PLACE = new Set<string>(AUTO_LAYOUT_PLACE_KEYS);
export const KNOWN_AUTO_LAYOUT_ROUTE = new Set<string>(AUTO_LAYOUT_ROUTE_KEYS);

/** Each known `designRules` sub-block and its own known keys. */
export const DESIGN_RULE_BLOCKS: ReadonlyArray<readonly [string, ReadonlySet<string>]> =
  [
    ["clearance", new Set<string>(CLEARANCE_KEYS)],
    ["minimums", new Set<string>(MINIMUMS_KEYS)],
    ["electrical", new Set<string>(ELECTRICAL_KEYS)],
    ["silkscreen", new Set<string>(SILKSCREEN_KEYS)],
    ["solderMask", new Set<string>(SOLDER_MASK_KEYS)],
    ["dfm", new Set<string>(DFM_KEYS)],
    ["outline", new Set<string>(OUTLINE_KEYS)],
  ];

/** The id-keyed row arrays, in the order they are merged. */
export const ROW_ARRAYS = [
  ["netClasses", new Set<string>(NET_CLASS_KEYS)],
  ["diffPairs", new Set<string>(DIFF_PAIR_KEYS)],
  ["lengthMatchGroups", new Set<string>(LENGTH_GROUP_KEYS)],
  ["drcRules", new Set<string>(DRC_RULE_KEYS)],
] as const satisfies ReadonlyArray<
  readonly [keyof BoardSettingsRowParsers, ReadonlySet<string>]
>;

/**
 * Nested discriminated objects on a row. Their union members carry no optional
 * keys, so the NEXT object's own keys are exactly the known set — no separate
 * list can drift from the union.
 */
export const NESTED_ROW_OBJECTS = ["target", "constraint"] as const;
