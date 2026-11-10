/**
 * The KiCad project import warning catalog (H14 §3.14.4): the ONE place a
 * warning code gets its group, severity, blocker class, live predicate and
 * human message. Planners build every warning through `kicadImportWarning`,
 * so no message ever shows a raw code and no capability loss is ever
 * acknowledgeable.
 *
 * Each code has exactly one blocker class. The census trigger rule (§3.6.1:
 * copper/mask/paste/outline or a manufacturing modifier → capability,
 * silk/fab → cosmetic, otherwise info) therefore picks between sibling codes
 * (`source_construct_unsupported` / `_cosmetic` / `source_construct_ignored`).
 */

import type {
  KicadImportBlockerClass,
  KicadImportLossPredicate,
  KicadImportSubjectKind,
  KicadImportWarningGroup,
  KicadProjectImportWarning,
} from "../../../../../sdks/designer";

export type KicadImportWarningDetails = NonNullable<
  KicadProjectImportWarning["details"]
>;

export interface KicadImportCatalogBlocker {
  class: KicadImportBlockerClass;
  predicate: KicadImportLossPredicate;
  /** What the predicate reads. Absent only for `permanent`. */
  subject?: KicadImportSubjectKind;
}

export interface KicadImportCatalogEntry<C extends string = string> {
  code: C;
  group: KicadImportWarningGroup;
  severity: "info" | "warning";
  blocker?: KicadImportCatalogBlocker;
  render(details: KicadImportWarningDetails): string;
}

type Render = (details: KicadImportWarningDetails) => string;
type Group = KicadImportWarningGroup;

const MAX_LISTED = 5;

/** KiCad tokens are snake_case; a message must never read like a code. */
export function humanKicadToken(token: string): string {
  return token.replace(/[_-]+/g, " ").trim();
}

function strings(details: KicadImportWarningDetails, key: string): string[] {
  const value = details[key];
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value !== "" ? [value] : [];
}

function listOf(values: readonly string[]): string {
  const shown = values.slice(0, MAX_LISTED).join(", ");
  const more = values.length - MAX_LISTED;
  return more > 0 ? `${shown} and ${more} more` : shown;
}

/** `sentence` + `: <items>` (refdes, net or zone names) + `(<tokens>)`. */
function say(sentence: string): Render {
  return (details) => {
    const tokens = strings(details, "tokens").map(humanKicadToken);
    const items = strings(details, "items");
    const withTokens =
      tokens.length > 0 ? `${sentence} (${listOf(tokens)})` : sentence;
    return items.length > 0
      ? `${withTokens}: ${listOf(items)}.`
      : `${withTokens}.`;
  };
}

function info<C extends string>(
  code: C,
  group: Group,
  sentence: string,
): KicadImportCatalogEntry<C> {
  return { code, group, severity: "info", render: say(sentence) };
}

function warn<C extends string>(
  code: C,
  group: Group,
  sentence: string,
): KicadImportCatalogEntry<C> {
  return { code, group, severity: "warning", render: say(sentence) };
}

function capability<C extends string>(
  code: C,
  group: Group,
  predicate: KicadImportLossPredicate,
  subject: KicadImportSubjectKind | undefined,
  render: string | Render,
): KicadImportCatalogEntry<C> {
  return {
    code,
    group,
    severity: "warning",
    blocker: {
      class: "capability",
      predicate,
      ...(subject ? { subject } : {}),
    },
    render: typeof render === "string" ? say(render) : render,
  };
}

/** Silk / fab only: acknowledgeable, open until acknowledged (§3.14.2). */
function cosmetic<C extends string>(
  code: C,
  group: Group,
  sentence: string,
): KicadImportCatalogEntry<C> {
  return {
    code,
    group,
    severity: "warning",
    blocker: { class: "cosmetic", predicate: "permanent", subject: "graphic" },
    render: say(sentence),
  };
}

const PERMANENT = "permanent";

// One entry per line: the catalog reads as a table.
// prettier-ignore
export const KICAD_IMPORT_WARNING_ENTRIES = [
  // ── components ──
  capability("component_unresolved", "components", PERMANENT, "part", "Some parts couldn't be imported and are missing from the design"),
  capability("schematic_part_detail_unavailable", "components", PERMANENT, "part", "Some library parts had no placement data and were left out"),
  capability("pcb_placement_skipped_no_part", "components", PERMANENT, "footprint", "PCB footprints without a matching schematic symbol were left out"),
  capability("footprint_missing_lib_id", "components", PERMANENT, "footprint", "Footprints without a library ID were skipped"),
  capability("footprint_manufacturing_token_unsupported", "components", "footprint_changed", "placement", "Some footprints use pad or footprint manufacturing settings this version can't represent yet, so their copper, mask or paste would differ from KiCad"),
  cosmetic("footprint_cosmetic_token_unsupported", "components", "Some footprint silkscreen or fabrication details couldn't be imported"),
  info("footprint_token_ignored", "components", "Some footprint settings that don't affect the board were ignored"),
  info("footprint_matched_by_refdes", "components", "Some footprints were matched to their symbols by reference designator because the board file doesn't link them"),
  capability("schematic_part_without_footprint", "components", "delegated", "part", "Some schematic parts have no footprint on the board and were imported as symbols only"),
  capability("refdes_conflicting_symbols", "components", PERMANENT, "part", "Some parts share a reference designator but use different symbols, so they weren't combined"),
  capability("pad_geometry_degraded", "components", "footprint_changed", "placement", "Some pads use plated, slotted or custom hole and pad shapes this version can't represent yet"),
  info("unnumbered_mechanical_pads", "components", "Unnumbered mounting holes and pegs were imported as mechanical holes"),
  warn("unnumbered_copper_pads", "components", "Some copper pads have no pad number and connect to no pin"),
  info("board_only_footprint_decomposed", "components", "Footprints with no schematic symbol were imported as loose board items"),
  capability("board_only_pad_shape_unsupported", "components", PERMANENT, "footprint", "Some pads of footprints without a schematic symbol use shapes this version can't represent and were skipped"),
  capability("board_only_footprint_dropped", "components", PERMANENT, "footprint", "Some footprints without a schematic symbol had nothing that could be imported and were left out"),
  warn("dnp_not_imported", "components", "Parts marked do-not-populate were left out"),

  // ── nets ──
  capability("pcb_traces_missing_net_name", "nets", PERMANENT, "copper", "Some tracks have no net name and may join the wrong net"),
  warn("kicad_net_split_in_schematic", "nets", "Some KiCad nets are split into several nets in the schematic; the extra connections show up as shorts in the design rule check"),
  capability("kicad_pad_net_without_pin", "nets", "footprint_changed", "placement", "Some pads are on a net in KiCad but have no matching schematic pin, so they were imported without a net"),
  capability("unnumbered_pad_has_board_net", "nets", "footprint_changed", "placement", "Some unnumbered pads are on a net in KiCad and were imported without one, which changes how copper pours connect to them"),
  capability("kicad_net_unbound", "nets", "delegated", "copper", "Some copper is on a net the schematic doesn't have; it keeps its KiCad net name until you assign it"),
  capability("kicad_net_alias_ambiguous", "nets", "delegated", "copper", "Some copper has a KiCad net name that matches more than one schematic net; it stays unassigned until you pick one"),
  capability("kicad_nets_shorted_by_merge", "nets", "copper_reassigned", "copper", "Some KiCad nets are one net in the schematic, but their copper touches on the board, which is a short in KiCad"),
  warn("kicad_nets_merged_in_schematic", "nets", "Some separate KiCad nets are one net in the schematic; the missing connection shows as unrouted"),
  warn("board_pad_unassigned", "nets", "Some pads have no net on the board although their schematic pin is connected"),
  info("label_scoped", "nets", "Local labels repeated on several sheets were renamed with their sheet path, as KiCad treats them"),
  warn("net_name_case_collision_renamed", "nets", "Net names that differ only in letter case were kept apart by adding a number"),
  capability("pad_number_net_conflict", "nets", "footprint_changed", "placement", "Some pads share one number but sit on different nets; the net used by most of them was kept"),
  warn("net_ordinal_unknown", "nets", "Some copper refers to a net the board file doesn't declare and was imported without a net"),
  warn("common_pin_wired_on_secondary_unit", "nets", "Shared pins of multi-unit parts are wired on a secondary unit; they belong to the first unit"),

  // ── rules ──
  capability("kicad_custom_rules_ignored", "rules", PERMANENT, "file", "Custom design rules from the KiCad rules file were not imported"),
  capability("kicad_netclass_unknown", "rules", "netclass_assigned", "net", "Some nets use a net class the project doesn't define"),
  capability("kicad_netclass_pattern_unsupported", "rules", "netclass_assigned", "net", "Wildcard net class patterns were not applied"),
  capability("kicad_netclass_patterns_invalid", "rules", PERMANENT, "rule", "The project's net class patterns couldn't be read"),
  capability("kicad_netclass_assignments_unsupported", "rules", PERMANENT, "rule", "Some net class assignments couldn't be read"),
  warn("kicad_netclass_assignment_unknown_net", "rules", "Some net class assignments name nets this design doesn't have"),
  capability("net_class_invalid", "rules", PERMANENT, "rule", "A net class couldn't be read; its rules were skipped"),
  capability("net_class_unknown_rules", "rules", PERMANENT, "rule", "Some net class rules aren't supported yet and are not checked"),
  capability("kicad_netclass_unresolved", "rules", "netclass_assigned", "net", "Some nets' net class couldn't be worked out; they use the Default class until you assign one"),
  warn("kicad_netclass_dropped_by_merge", "rules", "Net class assignments of KiCad nets merged into another net were dropped"),
  info("kicad_default_class_synthesised", "rules", "The project has no Default net class; one was created from KiCad's defaults"),
  info("kicad_netclass_field_defaulted", "rules", "Empty net class values were filled in with KiCad's defaults"),
  info("kicad_rule_defaulted", "rules", "Board minimums the project doesn't set use KiCad's defaults"),
  info("kicad_default_rule_relaxed", "rules", "A default board minimum stricter than the project's net classes was relaxed to match them"),
  warn("kicad_class_below_board_minimum", "rules", "Some net classes are below the project's board minimums; the design rule check will flag them"),
  capability("board_setup_unsupported", "rules", PERMANENT, "board", "Some board mask or paste settings can't be represented yet"),
  info("kicad_setup_drc_only", "rules", "Some board setup options only change KiCad's own design rule check and were not imported"),
  info("kicad_defaults_version_assumed", "rules", "The project comes from a different KiCad version; KiCad 8.0 defaults were assumed"),

  // ── geometry ──
  capability("board_outline_missing", "geometry", "outline_changed", "board", "No board outline was found; a default board size is used"),
  capability("board_outline_approximated", "geometry", "outline_changed", "board", "The board outline couldn't be fully rebuilt from the KiCad edge cuts; the nearest closed shape is used"),
  capability("layers_missing", "geometry", PERMANENT, "file", "The board file has no layer list"),
  capability("copper_layer_out_of_stack", "geometry", PERMANENT, "copper", "Tracks and vias on copper layers outside the board's layer stack were left out"),
  capability("zone_extra_contour_dropped", "geometry", "zone_deleted", "zone", "Zones with more than one outline kept only the first"),
  capability("zone_hatched_fill_as_solid", "geometry", "zone_deleted", "zone", "Hatched copper zones were imported as solid fills"),
  capability("zone_hole_invalid_import", "geometry", "zone_deleted", "zone", "Zones with an unusable cutout were imported switched off, so they pour no copper"),
  capability("zone_ring_invalid", "geometry", PERMANENT, "zone", "Zones with an invalid outline were left out"),
  capability("zone_layer_unsupported", "geometry", PERMANENT, "zone", "Zones on layers this design doesn't have lost those layers"),
  capability("zone_no_copper_layer", "geometry", PERMANENT, "zone", "Zones without a copper layer were left out"),
  info("zone_multilayer_split", "geometry", "Zones on several copper layers became one zone per layer"),
  info("pcb_zones_imported", "geometry", "Copper zones and keepouts were imported"),
  info("arc_tessellated", "geometry", "Curved tracks were converted to straight segments"),

  // ── graphics ──
  cosmetic("board_text_style_approximated", "graphics", "Some board text uses a font, thickness or width this version can't show, so it looks different"),
  cosmetic("board_text_anchor_approximated", "graphics", "Some board text is aligned to its top or bottom edge and may sit slightly off"),
  cosmetic("board_text_knockout_unsupported", "graphics", "Knockout board text was skipped"),
  capability("board_copper_graphic_unsupported", "graphics", PERMANENT, "graphic", "Drawings on copper layers can't be imported yet and were left out"),
  capability("board_mask_graphic_unsupported", "graphics", PERMANENT, "graphic", "Drawings on solder mask or paste layers can't be imported yet and were left out"),
  info("board_graphic_layer_ignored", "graphics", "Drawings on user and comment layers were not imported"),

  // ── schematic ──
  capability("schematic_part_skipped_no_component", "schematic", PERMANENT, "part", "Schematic symbols whose part couldn't be imported were left out"),
  capability("hierarchical_sheets_flattened", "schematic", PERMANENT, "sheet", "Hierarchical sheets were merged onto one sheet, which can join wires that were separate"),
  capability("hierarchical_sheets_flattened_summary", "schematic", PERMANENT, "sheet", "Hierarchical sheets were merged onto one sheet, which can join wires that were separate"),
  capability("sheet_missing_file", "schematic", PERMANENT, "sheet", "A hierarchical sheet doesn't say which file it uses"),
  capability("sheet_file_missing", "schematic", PERMANENT, "sheet", "A hierarchical sheet's file is missing from the ZIP, so its contents were not imported"),
  info("sheet_unreferenced", "schematic", "Some schematic files aren't used by any sheet and were not imported"),
  capability("symbol_missing_lib_id", "schematic", PERMANENT, "part", "Schematic symbols that couldn't be read were skipped"),
  capability("symbol_missing_at", "schematic", PERMANENT, "part", "Schematic symbols that couldn't be read were skipped"),
  capability("kicad_hidden_power_pin_unsupported", "schematic", "footprint_changed", "placement", "Some parts have hidden power pins that couldn't be connected to their power net"),
  info("refdes_collision_renamed", "schematic", "Duplicate reference designators on sub-sheets were renamed"),
  info("wire_diagonal", "schematic", "Diagonal wires are straightened into horizontal and vertical runs"),
  warn("wires_dropped_degenerate", "schematic", "Zero-length schematic wires were removed"),
  info("wire_anchor_synthesized", "schematic", "Wire ends that touched nothing were given connection points"),
  warn("wire_anchor_synthesized_floating", "schematic", "Wire ends that touched nothing were given connection points"),
  warn("hierarchical_pin_unmatched", "schematic", "Some hierarchical labels have no matching sheet pin and stay unconnected"),
  info("erc_flag_skipped", "schematic", "Power flag symbols were skipped; they only matter to KiCad's electrical rules check"),
  info("schematic_symbol_not_on_board", "schematic", "Symbols excluded from the board were skipped"),

  // ── library ──
  info("models_3d_queued", "library", "Bundled 3D models are being converted for the 3D view"),
  info("models_3d_skipped", "library", "Some 3D models weren't bundled in the ZIP and were skipped"),
  info("footprint_instance_variants", "library", "Footprints placed with different settings were added to the library as separate variants"),

  // ── source ──
  info("layer_count_deferred", "source", "The layer count is taken from the board file"),
  warn("multiple_projects_in_archive", "source", "The ZIP holds more than one KiCad project; the first one was imported"),
  capability("source_construct_unsupported", "source", PERMANENT, undefined, "The board file uses features this version can't import, which affect copper, mask, paste or the outline"),
  cosmetic("source_construct_unsupported_cosmetic", "source", "The board file uses silkscreen or fabrication features this version can't import"),
  info("source_construct_ignored", "source", "Some project file entries that don't affect manufacturing were ignored"),
  capability("import_census_mismatch", "source", PERMANENT, undefined, "Some items in the project files couldn't be accounted for in the imported design"),
  capability("import_report_missing", "source", PERMANENT, "board", () =>
    "This design was imported from KiCad before import checks existed, or its import record is missing. Re-import the project."),
] as const;

export type KicadImportWarningCode =
  (typeof KICAD_IMPORT_WARNING_ENTRIES)[number]["code"];

const CATALOG: ReadonlyMap<string, KicadImportCatalogEntry> = new Map(
  KICAD_IMPORT_WARNING_ENTRIES.map((entry) => [entry.code, entry]),
);

/** Codes the current pipeline emits with a variable suffix (`wire_anchor_synthesized_label`). */
const SUFFIXED_CODE_PREFIXES = ["wire_anchor_synthesized"] as const;

/** Catalog entry for a stored or emitted code; `null` for an unknown code. */
export function kicadImportWarningEntry(
  code: string,
): KicadImportCatalogEntry | null {
  const exact = CATALOG.get(code);
  if (exact) return exact;
  const prefix = SUFFIXED_CODE_PREFIXES.find((p) => code.startsWith(`${p}_`));
  return prefix ? (CATALOG.get(prefix) ?? null) : null;
}

/** Predicates that can only be evaluated against subject keys. */
const KEYED_PREDICATES: ReadonlySet<KicadImportLossPredicate> = new Set([
  "subject_deleted",
  "footprint_changed",
  "zone_deleted",
  "netclass_assigned",
  "copper_reassigned",
]);

/**
 * Builds a catalog warning. A keyed predicate without subject keys becomes
 * `permanent`: a blocker that cannot be evaluated must stay open (fail closed).
 */
export function kicadImportWarning(
  code: KicadImportWarningCode,
  input: {
    details?: KicadImportWarningDetails;
    subjectKeys?: readonly string[];
  } = {},
): KicadProjectImportWarning {
  const entry = CATALOG.get(code);
  if (!entry)
    throw new Error(
      `KiCad import warning code missing from the catalog: ${code}`,
    );
  const details = input.details ?? {};
  const keys = [...(input.subjectKeys ?? [])];
  const warning: KicadProjectImportWarning = {
    code,
    message: entry.render(details),
    severity: entry.severity,
    group: entry.group,
  };
  const subjectKind = entry.blocker?.subject;
  if (subjectKind && (keys.length > 0 || subjectKind === "board")) {
    warning.subject = { kind: subjectKind, keys };
  }
  if (entry.blocker) {
    const unkeyed =
      KEYED_PREDICATES.has(entry.blocker.predicate) && keys.length === 0;
    warning.blocker = {
      class: entry.blocker.class,
      predicate: unkeyed ? "permanent" : entry.blocker.predicate,
    };
  }
  if (input.details) warning.details = { ...input.details };
  return warning;
}

/** Only silk / fab losses can be acknowledged; a capability loss never. */
export function isAcknowledgeableImportBlocker(blocker: {
  class: KicadImportBlockerClass;
}): boolean {
  return blocker.class === "cosmetic";
}
