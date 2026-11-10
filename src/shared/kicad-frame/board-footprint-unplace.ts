/**
 * Board-instance footprint → library form, K → K (H13 §3.8, KF1 §4 row 2;
 * docs/pcb-hardening/KF1-kicad-frame-contract.md). Un-rotates child angles,
 * un-flips a back-side instance and strips per-instance data. The output is
 * still frame K: the one K → C conversion runs afterwards in
 * `@openpcb/kicad-import`. Pure; never mutates its input.
 *
 * KiCad semantics, cited at tag 8.0.4 (gitlab.com/kicad/code/kicad/-/raw/8.0.4):
 * - `pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.cpp` (sha256 e91107af…6e2069):
 *   pad `(at)` = footprint-relative unrotated position + ABSOLUTE angle
 *   (:1500-1503); fp_text / property `(at)` = relative position + absolute
 *   angle (:1838-1863); fp_text_box `(angle)` is footprint-RELATIVE (:1916-1921).
 * - `pcbnew/pad.cpp` `PAD::Flip` (sha256 59c83cee…0b8ee83, :732-783): mirrors
 *   position, drill offset and `rect_delta` in y, negates the footprint-relative
 *   orientation, swaps chamfer top/bottom, flips primitives and maps layers with
 *   `FlipLayerMask(mask)` — copper count defaulted to 0
 *   (`include/layer_ids.h:1014`), so pad inner layers are never remapped.
 * - `common/lset.cpp` `FlipLayer` (sha256 6ed00c1e…f2ac8e, :634-677):
 *   `In_k.Cu ↔ In_(n−1−k).Cu` for a board with n ≥ 4 copper layers.
 *
 * Flipped graphics and texts are spelled differently across KiCad versions
 * (8.0.4 `EDA_SHAPE::flip` swaps segment endpoints and `PCB_TEXT::Flip` maps a
 * text angle to 180 − a; the Chickadee corpus board, flipped before KiCad 8,
 * shows neither). The library form follows the H13 rule (pointwise y negation;
 * text angles as for pads) and `contentKey` canonicalises those spellings.
 */
import type { SExpr } from "@openpcb/kicad-parsers";
import { norm360, norm360Grid } from "./angles";
import { footprintContentKey } from "./footprint-content-key";
import { childNode, neg, num, type SExprNode } from "./sexpr-nodes";

export type BoardFootprintSide = "front" | "back";

export interface UnplaceWarning {
  code: string;
  message: string;
}

export interface UnplacedBoardFootprint {
  /** Library-form `.kicad_mod` node: frame K, front side, unrotated. */
  node: SExpr[];
  side: BoardFootprintSide;
  /** The board instance's footprint angle, `norm360` of the file value. */
  orientationDeg: number;
  libId: string;
  /** sha256 of the library form minus per-instance spellings (`footprintContentKey`). */
  contentKey: string;
  warnings: UnplaceWarning[];
}

export interface UnplaceOptions {
  /** Board copper layer count; inner graphic/text layers flip only when ≥ 4 (default 2). */
  copperLayerCount?: number;
}

export const BOARD_FOOTPRINT_CHILD_UNSUPPORTED =
  "board_footprint_child_unsupported";
export const REFERENCE_PLACEHOLDER = "REF**";

interface UnplaceContext {
  theta: number;
  back: boolean;
  copperLayerCount: number;
  itemName: string;
  warnings: UnplaceWarning[];
}

const DEFAULT_COPPER_LAYER_COUNT = 2;
/** KiCad `FlipLayerMask(mask)` for pads: no inner-layer remap. */
const PAD_FLIP_COPPER_LAYER_COUNT = 0;

const INSTANCE_ONLY_TAGS: ReadonlySet<string> = new Set([
  "at",
  "uuid",
  "tstamp",
  "path",
  "sheetname",
  "sheetfile",
  "locked",
  "placed",
]);
const INSTANCE_ONLY_ATOMS: ReadonlySet<string> = new Set(["locked", "placed"]);
const INSTANCE_ONLY_PROPERTIES: ReadonlySet<string> = new Set([
  "Sheetname",
  "Sheetfile",
]);
const GRAPHIC_TAGS: ReadonlySet<string> = new Set([
  "fp_line",
  "fp_rect",
  "fp_circle",
  "fp_arc",
  "fp_poly",
  "fp_curve",
]);
const UNSUPPORTED_CHILD_TAGS: ReadonlySet<string> = new Set([
  "zone",
  "group",
  "dimension",
]);
/** Netlist annotations a board pad carries and a library pad does not. */
const PAD_NETLIST_TAGS: ReadonlySet<string> = new Set([
  "net",
  "pinfunction",
  "pintype",
]);
const POINT_TAGS: ReadonlySet<string> = new Set([
  "start",
  "mid",
  "end",
  "center",
  "xy",
]);
const GEOMETRY_TAGS: ReadonlySet<string> = new Set([
  ...POINT_TAGS,
  "at",
  "pts",
]);
const CHAMFER_SWAP: Readonly<Record<string, string>> = {
  top_left: "bottom_left",
  bottom_left: "top_left",
  top_right: "bottom_right",
  bottom_right: "top_right",
};

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * `F.x ↔ B.x`; `In_k.Cu ↔ In_(n−1−k).Cu` when `copperLayerCount` n ≥ 4 and k is
 * an inner layer of that stack; everything else (`*.Cu`, `F&B.Cu`, `Edge.Cuts`,
 * user layers, out-of-stack inner layers) unchanged.
 */
export function flipLayerName(name: string, copperLayerCount: number): string {
  if (name.startsWith("F.")) return `B.${name.slice(2)}`;
  if (name.startsWith("B.")) return `F.${name.slice(2)}`;
  const inner = /^In(\d+)\.Cu$/.exec(name);
  if (!inner || !Number.isInteger(copperLayerCount) || copperLayerCount < 4) {
    return name;
  }
  const k = Number(inner[1]);
  if (k < 1 || k > copperLayerCount - 2) return name;
  return `In${copperLayerCount - 1 - k}.Cu`;
}

/** H13 §3.8 steps 1-7. Throws `TypeError` for anything but a `(footprint …)` node. */
export function unplaceBoardFootprint(
  node: SExpr[],
  opts: UnplaceOptions = {},
): UnplacedBoardFootprint {
  if (!Array.isArray(node) || node[0] !== "footprint") {
    throw new TypeError("unplaceBoardFootprint: expected a (footprint …) node");
  }
  const work = structuredClone(node) as SExprNode;
  const named = typeof work[1] === "string" || typeof work[1] === "number";
  const libId = named ? String(work[1]) : "";
  const theta = num(childNode(work, "at")?.[3]) ?? 0;
  const back = childNode(work, "layer")?.[1] === "B.Cu";
  const ctx: UnplaceContext = {
    theta,
    back,
    copperLayerCount: opts.copperLayerCount ?? DEFAULT_COPPER_LAYER_COUNT,
    itemName: libId.includes(":") ? libId.slice(libId.indexOf(":") + 1) : libId,
    warnings: [],
  };
  const out: SExprNode = named ? [work[0]!, work[1]!] : [work[0]!];
  for (const child of work.slice(out.length)) {
    const kept = unplaceChild(child, ctx);
    if (kept !== null) out.push(kept);
  }
  if (back) sortEqualNumberPads(out);
  return {
    node: out,
    side: back ? "back" : "front",
    orientationDeg: norm360(theta),
    libId,
    contentKey: footprintContentKey(out.slice(named ? 2 : 1)),
    warnings: ctx.warnings,
  };
}

// ── Children ───────────────────────────────────────────────────────────────

function unplaceChild(child: SExpr, ctx: UnplaceContext): SExpr | null {
  if (!Array.isArray(child)) {
    return INSTANCE_ONLY_ATOMS.has(String(child)) ? null : child;
  }
  const tag = child[0];
  if (typeof tag !== "string") return child;
  if (INSTANCE_ONLY_TAGS.has(tag)) return null;
  switch (tag) {
    case "layer":
      return ["layer", "F.Cu"];
    case "property":
      if (INSTANCE_ONLY_PROPERTIES.has(String(child[1]))) return null;
      unplaceText(child, ctx);
      return child;
    case "fp_text":
      unplaceText(child, ctx);
      return child;
    case "fp_text_box":
      unplaceTextBox(child, ctx);
      return child;
    case "pad":
      unplacePad(child, ctx);
      return child;
  }
  if (GRAPHIC_TAGS.has(tag)) {
    if (ctx.back) flipGraphic(child, ctx.copperLayerCount);
  } else if (
    UNSUPPORTED_CHILD_TAGS.has(tag) ||
    (ctx.back && carriesGeometry(child))
  ) {
    ctx.warnings.push({
      code: BOARD_FOOTPRINT_CHILD_UNSUPPORTED,
      message: `Footprint child '${tag}' is kept as written; it is not un-placed.`,
    });
  }
  return child;
}

/** Pads, texts: relative angle `β = α − θ`; back: `y → −y`, `β → −β` (H13 §3.8 steps 3, 5). */
function unplaceAt(at: SExprNode, ctx: UnplaceContext): void {
  const x = num(at[1]);
  const y = num(at[2]);
  if (x === null || y === null) return;
  const angle = num(at[3]);
  const rest = at.slice(angle === null ? 3 : 4);
  const relative = (angle ?? 0) - ctx.theta;
  const beta = norm360Grid(ctx.back ? -relative : relative);
  at.length = 0;
  at.push("at", x, ctx.back ? neg(y) : y);
  if (beta !== 0) at.push(beta);
  at.push(...rest);
}

function unplaceText(text: SExprNode, ctx: UnplaceContext): void {
  const field = text[1];
  if (field === "Reference" || field === "reference") {
    text[2] = REFERENCE_PLACEHOLDER;
  } else if (field === "Value" || field === "value") {
    text[2] = ctx.itemName;
  }
  const at = childNode(text, "at");
  if (at) unplaceAt(at, ctx);
  if (ctx.back) {
    flipLayerChild(text, ctx.copperLayerCount);
    toggleMirror(text);
  }
}

/** fp_text_box geometry and `(angle)` are already footprint-relative; only a back side changes. */
function unplaceTextBox(box: SExprNode, ctx: UnplaceContext): void {
  if (!ctx.back) return;
  negateGeometry(box);
  const angleIndex = box.findIndex((c) => Array.isArray(c) && c[0] === "angle");
  if (angleIndex >= 0) {
    const beta = norm360Grid(-(num((box[angleIndex] as SExprNode)[1]) ?? 0));
    if (beta === 0) box.splice(angleIndex, 1);
    else box[angleIndex] = ["angle", beta];
  }
  flipLayerChild(box, ctx.copperLayerCount);
  toggleMirror(box);
}

function unplacePad(pad: SExprNode, ctx: UnplaceContext): void {
  for (let i = pad.length - 1; i >= 0; i -= 1) {
    const c = pad[i];
    if (Array.isArray(c) && PAD_NETLIST_TAGS.has(String(c[0]))) pad.splice(i, 1);
  }
  const at = childNode(pad, "at");
  if (at) unplaceAt(at, ctx);
  if (!ctx.back) return;
  const drill = childNode(pad, "drill");
  const offset = drill ? childNode(drill, "offset") : null;
  if (offset) negateY(offset);
  const delta = childNode(pad, "rect_delta");
  if (delta) negateY(delta);
  const chamfer = childNode(pad, "chamfer");
  if (chamfer) {
    for (let i = 1; i < chamfer.length; i += 1) {
      const swapped = CHAMFER_SWAP[String(chamfer[i])];
      if (swapped) chamfer[i] = swapped;
    }
  }
  const layers = childNode(pad, "layers");
  if (layers) {
    for (let i = 1; i < layers.length; i += 1) {
      const l = layers[i];
      if (typeof l === "string") {
        layers[i] = flipLayerName(l, PAD_FLIP_COPPER_LAYER_COUNT);
      }
    }
  }
  const primitives = childNode(pad, "primitives");
  if (primitives) {
    for (const shape of primitives) {
      if (Array.isArray(shape)) flipGraphic(shape, PAD_FLIP_COPPER_LAYER_COUNT);
    }
  }
  // KiCad 9 per-layer padstacks carry their own F/B shapes; not un-flipped here.
  if (childNode(pad, "padstack")) {
    ctx.warnings.push({
      code: BOARD_FOOTPRINT_CHILD_UNSUPPORTED,
      message: `Pad '${String(pad[1])}' has a per-layer padstack; it is kept as written on the back side.`,
    });
  }
}

/** Pointwise `y → −y` (H13 §3.8 step 4); a KiCad 5 `(angle)` sweep is negated (KF1 §2). */
function flipGraphic(shape: SExprNode, copperLayerCount: number): void {
  negateGeometry(shape);
  const sweep = childNode(shape, "angle");
  if (sweep) negateY(sweep, 1);
  flipLayerChild(shape, copperLayerCount);
}

/**
 * KiCad writes pads sorted by number, then footprint-relative x, then y
 * (`FOOTPRINT::cmp_pads`, footprint.cpp:3265). A back instance was sorted on
 * flipped y, so equal-number pads (shield tabs, paste grids) re-sort here and
 * `${number}:${index}` pad ids match the front library form.
 */
function sortEqualNumberPads(node: SExprNode): void {
  const slots: number[] = [];
  node.forEach((c, i) => {
    if (Array.isArray(c) && c[0] === "pad") slots.push(i);
  });
  const sorted: SExprNode[] = [];
  let run: SExprNode[] = [];
  const flush = (): void => {
    run.sort(comparePadPlacement);
    sorted.push(...run);
    run = [];
  };
  for (const slot of slots) {
    const pad = node[slot] as SExprNode;
    if (run.length > 0 && String(run[0]![1]) !== String(pad[1])) flush();
    run.push(pad);
  }
  flush();
  slots.forEach((slot, k) => {
    node[slot] = sorted[k]!;
  });
}

function comparePadPlacement(a: SExprNode, b: SExprNode): number {
  const keys = (pad: SExprNode): number[] => {
    const at = childNode(pad, "at");
    const size = childNode(pad, "size");
    return [num(at?.[1]), num(at?.[2]), num(size?.[1]), num(size?.[2])].map(
      (v) => v ?? 0,
    );
  };
  const ka = keys(a);
  const kb = keys(b);
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i]) return ka[i]! < kb[i]! ? -1 : 1;
  }
  return 0;
}

// ── S-expression helpers ───────────────────────────────────────────────────

function negateY(point: SExprNode, index = 2): void {
  const v = num(point[index]);
  if (v !== null) point[index] = neg(v);
}

/** `y → −y` for start/mid/end/center/xy, recursing into `pts` and their `arc`s. */
function negateGeometry(node: SExprNode): void {
  for (const c of node) {
    if (!Array.isArray(c)) continue;
    const tag = String(c[0]);
    if (POINT_TAGS.has(tag)) negateY(c);
    else if (tag === "pts" || tag === "arc") negateGeometry(c);
  }
}

function carriesGeometry(node: SExprNode): boolean {
  return node.some((c) => Array.isArray(c) && GEOMETRY_TAGS.has(String(c[0])));
}

function flipLayerChild(node: SExprNode, copperLayerCount: number): void {
  const layer = childNode(node, "layer");
  if (layer && typeof layer[1] === "string") {
    layer[1] = flipLayerName(layer[1], copperLayerCount);
  }
}

/**
 * Un-flip toggles mirroring on a side-specific layer, as KiCad's flip does
 * (`PCB_TEXT::Flip`, pcb_text.cpp:357-374): `(justify … mirror)` loses or gains
 * the `mirror` token.
 */
function toggleMirror(text: SExprNode): void {
  const layer = childNode(text, "layer")?.[1];
  if (typeof layer !== "string" || !/^[FB]\./.test(layer)) return;
  let effects = childNode(text, "effects");
  if (!effects) {
    effects = ["effects"];
    text.push(effects);
  }
  const justify = childNode(effects, "justify");
  if (!justify) {
    effects.push(["justify", "mirror"]);
    return;
  }
  const i = justify.indexOf("mirror");
  if (i < 0) {
    justify.push("mirror");
    return;
  }
  justify.splice(i, 1);
  if (justify.length === 1) effects.splice(effects.indexOf(justify), 1);
}
