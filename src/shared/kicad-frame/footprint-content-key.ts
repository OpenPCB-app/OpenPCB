/**
 * `contentKey` of a library-form footprint (H13 §3.8 step 7, E9): sha256 over
 * the children as an unordered multiset, minus per-instance spellings —
 * field texts (Reference/Value/properties), uuid/tstamp, segment and arc
 * endpoint order, rectangle corner order, and the 180° keep-upright
 * alternative of a footprint text.
 *
 * Why each is stripped: KiCad sorts written footprint children by ABSOLUTE
 * position (`FOOTPRINT::cmp_drawings`, pcbnew/footprint.cpp:3188 @8.0.4), so
 * child order differs per placed instance; fields are per-instance; and boards
 * flipped by different KiCad versions spell the same segment/text differently
 * (8.0.4 `EDA_SHAPE::flip` swaps endpoints, older versions did not;
 * `PCB_TEXT::KeepUpright` moves a text by 180° and negates its justification).
 */
import { createHash } from "node:crypto";
import { type SExpr, serializeSexpr } from "@openpcb/kicad-parsers";
import { norm360Grid } from "./angles";
import { childNode, num, type SExprNode } from "./sexpr-nodes";

const RECT_TAGS: ReadonlySet<string> = new Set(["fp_rect", "gr_rect", "gr_bbox"]);
const ENDPOINT_TAGS: ReadonlySet<string> = new Set([
  "fp_line",
  "gr_line",
  "fp_arc",
  "gr_arc",
]);
const OPPOSITE_JUSTIFY: Readonly<Record<string, string>> = {
  left: "right",
  right: "left",
  top: "bottom",
  bottom: "top",
};

/** `children` = the library-form node without its tag and name. */
export function footprintContentKey(children: readonly SExpr[]): string {
  const parts: string[] = [];
  for (const child of children) {
    if (Array.isArray(child) && isFieldText(child)) continue;
    parts.push(serializeSexpr(keyForm(child)));
  }
  parts.sort();
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function isFieldText(child: SExprNode): boolean {
  if (child[0] === "property") return true;
  return (
    child[0] === "fp_text" && (child[1] === "reference" || child[1] === "value")
  );
}

function keyForm(expr: SExpr): SExpr {
  if (!Array.isArray(expr)) return expr;
  const out: SExprNode = [];
  for (const c of expr) {
    if (Array.isArray(c) && (c[0] === "uuid" || c[0] === "tstamp")) continue;
    out.push(keyForm(c));
  }
  const tag = String(out[0]);
  if (RECT_TAGS.has(tag)) orderRectCorners(out);
  // A KiCad 5 `(angle)` arc stores its CENTRE in `start`: endpoint order is meaningful.
  else if (ENDPOINT_TAGS.has(tag) && childNode(out, "angle") === null) {
    orderEndpoints(out);
  } else if (tag === "fp_text") uprightCanonical(out);
  return out;
}

function orderEndpoints(shape: SExprNode): void {
  const start = childNode(shape, "start");
  const end = childNode(shape, "end");
  if (!start || !end) return;
  const s = [num(start[1]) ?? 0, num(start[2]) ?? 0] as const;
  const e = [num(end[1]) ?? 0, num(end[2]) ?? 0] as const;
  if (s[0] > e[0] || (s[0] === e[0] && s[1] > e[1])) {
    start.splice(1, 2, e[0], e[1]);
    end.splice(1, 2, s[0], s[1]);
  }
}

function orderRectCorners(shape: SExprNode): void {
  const start = childNode(shape, "start");
  const end = childNode(shape, "end");
  if (!start || !end) return;
  const xs = [num(start[1]) ?? 0, num(end[1]) ?? 0];
  const ys = [num(start[2]) ?? 0, num(end[2]) ?? 0];
  start.splice(1, 2, Math.min(...xs), Math.min(...ys));
  end.splice(1, 2, Math.max(...xs), Math.max(...ys));
}

/** KiCad `PCB_TEXT::KeepUpright` (pcb_text.cpp:266 @8.0.4): `a ≡ a − 180`, justify negated. */
function uprightCanonical(text: SExprNode): void {
  const at = childNode(text, "at");
  if (!at || isUnlocked(text, at)) return;
  const angle = num(at[3]);
  if (angle === null || angle < 180) return;
  const upright = norm360Grid(angle - 180);
  if (upright === 0) at.splice(3, 1);
  else at[3] = upright;
  const justify = childNode(childNode(text, "effects") ?? [], "justify");
  if (!justify) return;
  for (let i = 1; i < justify.length; i += 1) {
    const flipped = OPPOSITE_JUSTIFY[String(justify[i])];
    if (flipped) justify[i] = flipped;
  }
}

/** KiCad 8 `(unlocked yes)`; KiCad 7 `(at x y a unlocked)` — keep-upright is off. */
function isUnlocked(text: SExprNode, at: SExprNode): boolean {
  if (at.includes("unlocked")) return true;
  return childNode(text, "unlocked")?.[1] === "yes";
}
