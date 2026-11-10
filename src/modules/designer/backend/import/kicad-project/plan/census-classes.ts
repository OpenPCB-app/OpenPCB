/**
 * The census token classification and blocker trigger rule (H14 §3.6.1), one
 * exhaustive table per s-expression level. A token in neither `handled` nor
 * `benign` is `unsupported`.
 *
 * Trigger rule for a token OpenPCB cannot represent:
 *   capability — its layers meet `*.Cu`, `*.Mask`, `*.Paste` or `Edge.Cuts`,
 *                or it is a manufacturing modifier;
 *   cosmetic   — it is on silk / fab layers only;
 *   info       — otherwise.
 */

import type { CensusLossClass } from "./census";

export interface TokenClassTable {
  handled: ReadonlySet<string>;
  benign: ReadonlySet<string>;
}

function table(handled: string[], benign: string[]): TokenClassTable {
  return { handled: new Set(handled), benign: new Set(benign) };
}

export const PCB_CLASSES = table(
  // prettier-ignore
  ["segment", "arc", "via", "zone", "footprint", "gr_line", "gr_rect", "gr_circle", "gr_arc", "gr_poly", "gr_text", "net", "layers", "setup"],
  // prettier-ignore
  ["version", "generator", "generator_version", "general", "paper", "title_block", "uuid", "tstamp", "property", "sheet_instances", "symbol_instances", "embedded_fonts", "embedded_files", "group"],
);

/** Inside `(setup …)`; the values these carry are judged by the rules plan (§3.9). */
export const SETUP_CLASSES = table(
  // prettier-ignore
  ["pad_to_mask_clearance", "pad_to_paste_clearance", "pad_to_paste_clearance_ratio", "solder_mask_min_width", "tenting", "allow_soldermask_bridges_in_footprints", "pcbplotparams"],
  // Stack-up is H50's (out of scope); origins only move the drawing datum.
  ["stackup", "aux_axis_origin", "grid_origin"],
);

export const FOOTPRINT_CLASSES = table(
  // prettier-ignore
  ["layer", "at", "uuid", "tstamp", "path", "attr", "property", "pad", "model", "locked", "fp_text", "fp_line", "fp_rect", "fp_circle", "fp_arc", "fp_poly"],
  // prettier-ignore
  ["descr", "tags", "sheetname", "sheetfile", "placed", "tedit", "autoplace_cost90", "autoplace_cost180", "embedded_fonts", "embedded_files"],
);

export const PAD_CLASSES = table(
  // `options` is the custom-pad header; its `primitives` are a modifier.
  // prettier-ignore
  ["at", "size", "drill", "layers", "net", "roundrect_rratio", "pinfunction", "pintype", "uuid", "tstamp", "chamfer_ratio", "chamfer", "rect_delta", "options", "remove_unused_layers"],
  // `property` is a fabrication attribute (heatsink, test point, BGA …);
  // `die_length` only feeds KiCad's length tuning; `keep_end_layers` only
  // matters with `remove_unused_layers yes`, which is itself a loss.
  ["locked", "property", "die_length", "keep_end_layers", "teardrops"],
);

export const SCH_CLASSES = table(
  // prettier-ignore
  ["symbol", "wire", "junction", "label", "global_label", "hierarchical_label", "netclass_flag", "sheet", "no_connect", "lib_symbols"],
  // prettier-ignore
  ["version", "generator", "generator_version", "uuid", "paper", "title_block", "sheet_instances", "symbol_instances", "embedded_fonts", "embedded_files"],
);

/**
 * Footprint- and pad-level manufacturing modifiers (§3.6.1). They change
 * copper, mask, paste or connectivity whatever layer they sit on. `zone` here
 * means a FOOTPRINT zone; a board zone is a handled top-level token.
 */
export const MANUFACTURING_MODIFIERS: ReadonlySet<string> = new Set([
  "clearance",
  "solder_mask_margin",
  "solder_paste_margin",
  "solder_paste_margin_ratio",
  "solder_paste_ratio",
  "zone_connect",
  "thermal_width",
  "thermal_bridge_width",
  "thermal_gap",
  "thermal_bridge_angle",
  "net_tie_pad_groups",
  "jumper_pad_groups",
  "duplicate_pad_numbers_are_jumpers",
  "private_layers",
  "primitives",
  "zone",
  "zone_layer_connections",
  "remove_unused_layers",
]);

const MANUFACTURING_LAYER = /^(?:F|B|\*|F&B|In\d+)\.(?:Cu|Mask|Paste)$/;
const COSMETIC_LAYER = /^(?:F|B|\*|F&B)\.(?:SilkS|Silkscreen|Fab|Fabrication)$/;

/** `*.Cu`, `*.Mask`, `*.Paste` (incl. wildcards) or `Edge.Cuts`. */
export function isEdgeOrManufacturingLayer(layer: string): boolean {
  return layer === "Edge.Cuts" || MANUFACTURING_LAYER.test(layer);
}

/** The §3.6.1 trigger rule for one lost token on `layers`. */
export function censusLossClass(
  token: string,
  layers: readonly string[],
): CensusLossClass {
  if (MANUFACTURING_MODIFIERS.has(token)) return "capability";
  if (layers.some(isEdgeOrManufacturingLayer)) return "capability";
  if (layers.length > 0 && layers.every((l) => COSMETIC_LAYER.test(l)))
    return "cosmetic";
  return "info";
}
