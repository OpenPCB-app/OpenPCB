/**
 * H13 OP9 — `unplaceBoardFootprint` (H13 §3.8 steps 1-7; E9, E10, E11).
 *
 * Hand-written instances use the KiCad 8 board spelling (pcb_io_kicad_sexpr.cpp
 * @8.0.4: pad `(at)` relative position + absolute angle). Expected library forms
 * are worked by hand from the H13 rules. The synthetic round trip places/flips
 * with a test-side model of the same rules: REGRESSION only, not an oracle.
 * USBtoUART (tracked) and Chickadee (local corpus, skip-unless-present) are
 * real KiCad output.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  findNodes,
  parseKicadFootprint,
  parseSexpr,
  serializeSexpr,
  type SExpr,
} from "@openpcb/kicad-parsers";
import { resolveProjectFiles } from "../../../modules/designer/backend/import/kicad-project/inspect";
import {
  BOARD_FOOTPRINT_CHILD_UNSUPPORTED,
  flipLayerName,
  unplaceBoardFootprint,
} from "../../../shared/kicad-frame/board-footprint-unplace";

const sexpr = (src: string): SExpr[] => parseSexpr(src) as SExpr[];

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const v of value) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

function footprintsOf(pcbSource: string): SExpr[][] {
  return findNodes(parseSexpr(pcbSource), "footprint");
}

describe("flipLayerName", () => {
  test.each([
    ["F.Cu", 2, "B.Cu"],
    ["B.Cu", 2, "F.Cu"],
    ["F.SilkS", 2, "B.SilkS"],
    ["B.CrtYd", 4, "F.CrtYd"],
    ["F.Fab", 4, "B.Fab"],
    ["*.Cu", 4, "*.Cu"],
    ["F&B.Cu", 4, "F&B.Cu"],
    ["Edge.Cuts", 4, "Edge.Cuts"],
    ["User.1", 4, "User.1"],
    ["In1.Cu", 4, "In2.Cu"],
    ["In2.Cu", 4, "In1.Cu"],
    ["In1.Cu", 6, "In4.Cu"],
    ["In4.Cu", 6, "In1.Cu"],
    ["In2.Cu", 6, "In3.Cu"],
    ["In1.Cu", 2, "In1.Cu"],
    ["In3.Cu", 4, "In3.Cu"],
  ] as const)("%s on %i layers → %s", (name, n, want) => {
    expect(flipLayerName(name, n)).toBe(want);
  });
});

describe("front instance", () => {
  const R6 = sexpr(`(footprint "Resistor_SMD:R_0201_0603Metric" (layer "F.Cu") (uuid "u0") (at 157.5 135 180) locked
    (property "Reference" "R6" (at 0 1 0) (layer "F.SilkS") (uuid "u1"))
    (property "Value" "1K" (at 0 1.05 0) (layer "F.Fab"))
    (property "Sheetname" "Root")
    (path "/817f") (sheetname "Root") (sheetfile "a.kicad_sch") (placed yes)
    (attr smd)
    (fp_line (start 0.7 0.35) (end -0.7 0.35) (layer "F.CrtYd"))
    (fp_text user "\${REFERENCE}" (at 0 -0.68 0) (layer "F.Fab"))
    (pad "1" smd roundrect (at -0.32 0 180) (size 0.46 0.4) (layers "F.Cu" "F.Mask")
      (net 5 "/VBUS") (pinfunction "A") (pintype "passive") (uuid "p1")))`);

  test("drops instance data, relativises angles, keeps local geometry", () => {
    const u = unplaceBoardFootprint(deepFreeze(R6));
    expect(u.side).toBe("front");
    expect(u.orientationDeg).toBe(180);
    expect(u.libId).toBe("Resistor_SMD:R_0201_0603Metric");
    expect(u.warnings).toEqual([]);
    expect(u.node).toEqual(
      sexpr(`(footprint "Resistor_SMD:R_0201_0603Metric" (layer "F.Cu")
        (property "Reference" "REF**" (at 0 1 180) (layer "F.SilkS") (uuid "u1"))
        (property "Value" "R_0201_0603Metric" (at 0 1.05 180) (layer "F.Fab"))
        (attr smd)
        (fp_line (start 0.7 0.35) (end -0.7 0.35) (layer "F.CrtYd"))
        (fp_text user "\${REFERENCE}" (at 0 -0.68 180) (layer "F.Fab"))
        (pad "1" smd roundrect (at -0.32 0) (size 0.46 0.4) (layers "F.Cu" "F.Mask") (uuid "p1")))`),
    );
  });

  test("fractional θ is kept, never rounded (E2)", () => {
    const fp = sexpr(`(footprint "L:X" (layer "F.Cu") (at 1 2 22.5)
      (pad "1" smd rect (at 1 0 32.5) (size 1 1) (layers "F.Cu"))
      (pad "2" smd rect (at -1 0 22.6) (size 1 1) (layers "F.Cu")))`);
    const u = unplaceBoardFootprint(fp);
    expect(u.orientationDeg).toBe(22.5);
    expect(findNodes(u.node, "pad").map((p) => findNodes(p, "at")[0])).toEqual([
      ["at", 1, 0, 10],
      ["at", -1, 0, 0.1],
    ]);
  });

  test("rejects anything but a (footprint …) node", () => {
    expect(() => unplaceBoardFootprint(sexpr(`(module "x" (layer "F.Cu"))`))).toThrow(TypeError);
  });
});

describe("back instance (H13 §3.8 steps 3-6)", () => {
  // A front library footprint flipped by KiCad onto B.Cu of a 4-layer board, θ = 30.
  const BACK = sexpr(`(footprint "T:Probe" (layer "B.Cu") (uuid "u0") (at 50 40 30) locked
    (property "Reference" "U7" (at 0 2 30) (layer "B.SilkS") (uuid "u1")
      (effects (font (size 1 1)) (justify mirror)))
    (property "Value" "probe" (at 0 -2 210) (layer "B.Fab")
      (effects (font (size 1 1)) (justify left mirror)))
    (property "Sheetfile" "x.kicad_sch")
    (path "/abc") (sheetname "Root") (sheetfile "x.kicad_sch")
    (attr through_hole)
    (fp_line (start -1 0.5) (end 1 0.5) (stroke (width 0.12) (type solid)) (layer "B.SilkS") (uuid "u2"))
    (fp_arc (start 0 1) (mid 1 0) (end 0 -1) (layer "B.Fab"))
    (fp_poly (pts (xy 0 0) (xy 1 0.5) (xy 0 1)) (layer "B.CrtYd"))
    (fp_circle (center 2 -1) (end 2.5 -1) (layer "B.Fab"))
    (fp_line (start 0 0.2) (end 0 0.8) (layer "In1.Cu"))
    (fp_text user "\${REFERENCE}" (at 0 0.5 30) (layer "B.Fab") (effects (font (size 0.5 0.5))))
    (fp_text_box "note" (start -1 2) (end 1 3) (angle 20) (layer "B.Fab")
      (effects (font (size 1 1)) (justify mirror)))
    (pad "1" thru_hole rect (at -2 1 30) (size 1.5 1.5) (drill 0.8 (offset 0.1 0.2))
      (layers "*.Cu" "B.Mask") (net 1 "GND") (pinfunction "A") (pintype "passive") (uuid "p1"))
    (pad "2" smd roundrect (at 2 -1 120) (size 1 0.6) (layers "B.Cu" "B.Mask" "B.Paste" "In1.Cu")
      (chamfer_ratio 0.2) (chamfer top_left bottom_right) (rect_delta 0 0.1))
    (pad "3" smd custom (at 0 3 30) (size 0.5 0.5) (layers "B.Cu")
      (primitives (gr_poly (pts (xy 0 0) (xy 1 0.5) (xy 0 1))) (gr_line (start 0 0.25) (end 1 0.75))))
    (pad "MP" smd rect (at 3 2 30) (size 1 1) (layers "B.Cu") (uuid "mp-a"))
    (pad "MP" smd rect (at 3 -2 30) (size 1 1) (layers "B.Cu") (uuid "mp-b"))
    (zone (net 0) (layer "B.Cu"))
    (model "x.wrl" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0))))`);

  test("un-flips every child kind by hand-derived numbers", () => {
    const u = unplaceBoardFootprint(deepFreeze(BACK), { copperLayerCount: 4 });
    expect(u.side).toBe("back");
    expect(u.orientationDeg).toBe(30);
    expect(u.warnings.map((w) => w.code)).toEqual([BOARD_FOOTPRINT_CHILD_UNSUPPORTED]);
    expect(u.node).toEqual(
      sexpr(`(footprint "T:Probe" (layer "F.Cu")
        (property "Reference" "REF**" (at 0 -2) (layer "F.SilkS") (uuid "u1")
          (effects (font (size 1 1))))
        (property "Value" "Probe" (at 0 2 180) (layer "F.Fab")
          (effects (font (size 1 1)) (justify left)))
        (attr through_hole)
        (fp_line (start -1 -0.5) (end 1 -0.5) (stroke (width 0.12) (type solid)) (layer "F.SilkS") (uuid "u2"))
        (fp_arc (start 0 -1) (mid 1 0) (end 0 1) (layer "F.Fab"))
        (fp_poly (pts (xy 0 0) (xy 1 -0.5) (xy 0 -1)) (layer "F.CrtYd"))
        (fp_circle (center 2 1) (end 2.5 1) (layer "F.Fab"))
        (fp_line (start 0 -0.2) (end 0 -0.8) (layer "In2.Cu"))
        (fp_text user "\${REFERENCE}" (at 0 -0.5) (layer "F.Fab")
          (effects (font (size 0.5 0.5)) (justify mirror)))
        (fp_text_box "note" (start -1 -2) (end 1 -3) (angle 340) (layer "F.Fab")
          (effects (font (size 1 1))))
        (pad "1" thru_hole rect (at -2 -1) (size 1.5 1.5) (drill 0.8 (offset 0.1 -0.2))
          (layers "*.Cu" "F.Mask") (uuid "p1"))
        (pad "2" smd roundrect (at 2 1 270) (size 1 0.6) (layers "F.Cu" "F.Mask" "F.Paste" "In1.Cu")
          (chamfer_ratio 0.2) (chamfer bottom_left top_right) (rect_delta 0 -0.1))
        (pad "3" smd custom (at 0 -3) (size 0.5 0.5) (layers "F.Cu")
          (primitives (gr_poly (pts (xy 0 0) (xy 1 -0.5) (xy 0 -1))) (gr_line (start 0 -0.25) (end 1 -0.75))))
        (pad "MP" smd rect (at 3 -2) (size 1 1) (layers "F.Cu") (uuid "mp-a"))
        (pad "MP" smd rect (at 3 2) (size 1 1) (layers "F.Cu") (uuid "mp-b"))
        (zone (net 0) (layer "B.Cu"))
        (model "x.wrl" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0))))`),
    );
  });

  test("equal-number pads re-sort into front order (pad ids n:i match the front)", () => {
    // KiCad wrote these two on the back sorted by FLIPPED y; front order is y ascending.
    const fp = sexpr(`(footprint "C:USB" (layer "B.Cu") (at 0 0)
      (pad "S1" smd rect (at -4 -1) (size 1 2) (layers "B.Cu") (uuid "low"))
      (pad "S1" smd rect (at -4 1) (size 1 2) (layers "B.Cu") (uuid "high"))
      (pad "1" smd rect (at 0 0) (size 1 1) (layers "B.Cu")))`);
    const pads = findNodes(unplaceBoardFootprint(fp).node, "pad");
    expect(pads.map((p) => [p[1], findNodes(p, "uuid")[0]?.[1] ?? null])).toEqual([
      ["S1", "high"],
      ["S1", "low"],
      ["1", null],
    ]);
  });

  test("a KiCad 9 per-layer padstack on the back side is reported, not guessed", () => {
    const fp = sexpr(`(footprint "L:PS" (layer "B.Cu") (at 0 0)
      (pad "1" thru_hole circle (at 0 0) (size 1.7 1.7) (drill 1) (layers "*.Cu")
        (padstack (mode front_inner_back) (layer "B.Cu" (shape rect) (size 1.7 1.7)))))`);
    const u = unplaceBoardFootprint(fp);
    expect(u.warnings.map((w) => w.code)).toEqual([BOARD_FOOTPRINT_CHILD_UNSUPPORTED]);
    expect(unplaceBoardFootprint(sexpr(serializeSexpr(fp).replace(/B\.Cu/g, "F.Cu"))).warnings).toEqual([]);
  });

  test("inner-layer graphics stay put without a ≥4-layer count", () => {
    const u = unplaceBoardFootprint(BACK);
    const inner = findNodes(u.node, "fp_line").find((l) => findNodes(l, "layer")[0]?.[1] !== "F.SilkS");
    expect(findNodes(inner!, "layer")[0]).toEqual(["layer", "In1.Cu"]);
  });

  test("the H13 §3.1.3 worked example: a front part at 0 flipped L/R is θ = 180", () => {
    const back = sexpr(`(footprint "L:P" (layer "B.Cu") (at 10 5 180)
      (pad "1" smd rect (at -1 0 180) (size 1 1) (layers "B.Cu")))`);
    const front = sexpr(`(footprint "L:P" (layer "F.Cu") (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu")))`);
    expect(unplaceBoardFootprint(back).node).toEqual(front);
  });
});

// ── Synthetic round trip (regression only: the placement model shares the H13 rules) ──

const LIBRARY = `(footprint "S:Asym" (layer "F.Cu")
  (property "Reference" "REF**" (at 0 -2.5) (layer "F.SilkS") (effects (font (size 1 1))))
  (property "Value" "Asym" (at 0 2.5) (layer "F.Fab") (effects (font (size 1 1))))
  (fp_line (start -1.5 -1) (end 1.5 -1) (layer "F.SilkS"))
  (fp_arc (start -1 0.5) (mid 0 1.2) (end 1 0.5) (layer "F.Fab"))
  (fp_rect (start -2 -1.5) (end 2 1.5) (layer "F.CrtYd"))
  (fp_text user "+" (at -1.6 -0.8 90) (layer "F.SilkS") (effects (font (size 0.5 0.5)) (justify left)))
  (pad "1" thru_hole rect (at -1.27 -0.4 15) (size 1.2 0.8) (drill 0.6 (offset 0.1 0.05)) (layers "*.Cu" "F.Mask"))
  (pad "2" smd roundrect (at 1.27 0.6 90) (size 1 0.5) (layers "F.Cu" "F.Mask") (chamfer top_left) (rect_delta 0 0.05))
  (pad "EP" smd rect (at 0 -0.3) (size 0.4 0.4) (layers "F.Paste"))
  (pad "EP" smd rect (at 0 0.3) (size 0.4 0.4) (layers "F.Paste")))`;

type Node = SExpr[];
const at = (n: Node): Node | undefined => findNodes(n, "at")[0];
const norm = (d: number): number => {
  const r = ((d % 360) + 360) % 360;
  return Math.round(r * 1e9) / 1e9 % 360;
};
function setAngle(a: Node, deg: number): void {
  const x = a[1]!;
  const y = a[2]!;
  a.length = 0;
  a.push("at", x, y);
  if (norm(deg) !== 0) a.push(norm(deg));
}

/** Test-side KiCad placement: absolute child angles; a back side is the KiCad top/bottom flip. */
function place(lib: Node, theta: number, side: "front" | "back", ref: string): Node {
  const out = structuredClone(lib);
  const layer = findNodes(out, "layer")[0]!;
  layer[1] = side === "back" ? "B.Cu" : "F.Cu";
  out.splice(2, 0, ["at", 100, 50, theta], ["uuid", `fp-${ref}`]);
  for (const c of out) {
    if (!Array.isArray(c)) continue;
    const tag = c[0];
    if (tag === "property" && c[1] === "Reference") c[2] = ref;
    if (side === "back") {
      for (const point of c.filter((k): k is Node => Array.isArray(k) && ["start", "mid", "end"].includes(String(k[0])))) {
        point[2] = -(point[2] as number) || 0;
      }
      const l = findNodes(c, "layer")[0];
      if (l) l[1] = flipLayerName(String(l[1]), 2);
      const layers = findNodes(c, "layers")[0];
      if (layers) for (let i = 1; i < layers.length; i += 1) layers[i] = flipLayerName(String(layers[i]), 0);
      const offset = findNodes(findNodes(c, "drill")[0] ?? [], "offset")[0];
      if (offset) offset[2] = -(offset[2] as number) || 0;
      const delta = findNodes(c, "rect_delta")[0];
      if (delta) delta[2] = -(delta[2] as number) || 0;
      const chamfer = findNodes(c, "chamfer")[0];
      if (chamfer) chamfer[1] = String(chamfer[1]).replace("top", "bottom");
      const effects = findNodes(c, "effects")[0];
      if (effects && (tag === "property" || tag === "fp_text")) {
        const justify = findNodes(effects, "justify")[0];
        if (justify) justify.push("mirror");
        else effects.push(["justify", "mirror"]);
      }
    }
    const a = tag === "pad" || tag === "property" || tag === "fp_text" ? at(c) : undefined;
    if (a) {
      if (side === "back") a[2] = -(a[2] as number) || 0;
      const beta = typeof a[3] === "number" ? a[3] : 0;
      setAngle(a, side === "back" ? theta - beta : theta + beta);
    }
  }
  if (side === "back") {
    // KiCad's writer sorts equal-number pads by their (flipped) relative y.
    const idx = out.flatMap((c, i) => (Array.isArray(c) && c[0] === "pad" && c[1] === "EP" ? [i] : []));
    const eps = idx.map((i) => out[i] as Node).sort((p, q) => (at(p)![2] as number) - (at(q)![2] as number));
    idx.forEach((i, k) => (out[i] = eps[k]!));
  }
  return out;
}

describe("synthetic round trip (non-oracle)", () => {
  const lib = sexpr(LIBRARY);
  const cases = [0, 90, 180, -90, 22.5, 135.75].flatMap((theta) =>
    (["front", "back"] as const).map((side) => ({ theta, side })),
  );

  test.each(cases)("θ = $theta on $side returns the library form", ({ theta, side }) => {
    const u = unplaceBoardFootprint(place(lib, theta, side, "U1"));
    expect(u.side).toBe(side);
    expect(u.node).toEqual(lib);
  });

  test("every placement has one contentKey", () => {
    const keys = new Set(cases.map(({ theta, side }) => unplaceBoardFootprint(place(lib, theta, side, `U${theta}`)).contentKey));
    expect(keys.size).toBe(1);
  });
});

describe("contentKey", () => {
  const PAD1 = `(pad "1" smd rect (at -0.8 0) (size 0.8 0.9) (layers "F.Cu") (net 1 "A"))`;
  const PAD2 = `(pad "2" smd rect (at 0.8 0) (size 0.8 0.9) (layers "F.Cu") (net 2 "B"))`;
  const base = `(footprint "L:K" (layer "F.Cu") (at 5 5 0)
    (property "Reference" "R1" (at 0 -1) (layer "F.SilkS"))
    (fp_line (start -1 -0.5) (end 1 -0.5) (layer "F.SilkS") (uuid "a"))
    (fp_rect (start -2 -1) (end 2 1) (layer "F.CrtYd"))
    (fp_text user "x" (at 0 0.8) (layer "F.Fab") (effects (font (size 0.5 0.5)) (justify left)))
    ${PAD1}
    ${PAD2})`;
  const key = (src: string): string => unplaceBoardFootprint(sexpr(src)).contentKey;
  const k0 = key(base);

  test("ignores per-instance spellings", () => {
    const variants = [
      base.replace(`"R1" (at 0 -1)`, `"R99" (at 3 4 90)`),
      base.replace(`(uuid "a")`, `(uuid "b")`),
      base.replace(`(net 1 "A")`, `(net 7 "VCC")`),
      base.replace(`(start -1 -0.5) (end 1 -0.5)`, `(start 1 -0.5) (end -1 -0.5)`),
      base.replace(`(start -2 -1) (end 2 1)`, `(start 2 1) (end -2 -1)`),
      // keep-upright: KiCad stores the same text at 180° with justification negated
      base.replace(`(at 0 0.8) (layer "F.Fab") (effects (font (size 0.5 0.5)) (justify left))`,
        `(at 0 0.8 180) (layer "F.Fab") (effects (font (size 0.5 0.5)) (justify right))`),
      // KiCad sorts children by absolute position: order differs per instance
      base.replace(PAD1, "").replace(PAD2, `${PAD2}\n    ${PAD1}`),
    ];
    for (const v of variants) expect(key(v)).toBe(k0);
  });

  test("changes with land-pattern geometry", () => {
    const variants = [
      base.replace(`(at -0.8 0)`, `(at -0.81 0)`),
      base.replace(`(size 0.8 0.9) (layers "F.Cu") (net 1`, `(size 0.8 1) (layers "F.Cu") (net 1`),
      base.replace(`(start -1 -0.5)`, `(start -1 -0.6)`),
      base.replace(`(layer "F.CrtYd")`, `(layer "F.Fab")`),
      base.replace(`(at 0 0.8)`, `(at 0 0.8 90)`),
    ];
    for (const v of variants) expect(key(v)).not.toBe(k0);
  });

  test("negative control: a back instance read as front keys differently", () => {
    const backSrc = `(footprint "L:K" (layer "B.Cu") (at 5 5 0)
      (fp_line (start -1 0.5) (end 1 0.5) (layer "B.SilkS"))
      (pad "1" smd rect (at -0.8 0.3) (size 0.8 0.9) (layers "B.Cu")))`;
    const frontSrc = `(footprint "L:K" (layer "F.Cu") (at 5 5 0)
      (fp_line (start -1 -0.5) (end 1 -0.5) (layer "F.SilkS"))
      (pad "1" smd rect (at -0.8 -0.3) (size 0.8 0.9) (layers "F.Cu")))`;
    expect(key(backSrc)).toBe(key(frontSrc));
    expect(key(backSrc.replace(`(layer "B.Cu")`, `(layer "F.Cu")`))).not.toBe(key(frontSrc));
  });
});

describe("USBtoUART (KiCad 8.0.4, tracked fixture)", () => {
  const zip = path.resolve(import.meta.dir, "../../../../data/KiCad_Example_Project_USBtoUART.zip");
  const pcb = resolveProjectFiles(new Uint8Array(readFileSync(zip))).pcbContent;
  const footprints = footprintsOf(pcb);

  test("every instance of a lib_id unplaces to one contentKey", () => {
    const keysByLib = new Map<string, Set<string>>();
    for (const fp of footprints) {
      const u = unplaceBoardFootprint(fp);
      keysByLib.set(u.libId, (keysByLib.get(u.libId) ?? new Set()).add(u.contentKey));
    }
    expect(footprints.length).toBe(19);
    expect(keysByLib.size).toBe(7);
    for (const [libId, keys] of keysByLib) expect({ libId, keys: keys.size }).toEqual({ libId, keys: 1 });
  });

  test("library forms parse as .kicad_mod with every pad, REF** and no instance data", () => {
    for (const fp of footprints) {
      const u = unplaceBoardFootprint(fp);
      const text = serializeSexpr(u.node);
      expect(text).toContain("REF**");
      expect(text).not.toMatch(/\((net|path|sheetfile|pintype) /);
      expect(parseKicadFootprint(text).pads.length).toBe(findNodes(fp, "pad").length);
    }
  });
});

// O4 corpus (H13 §7.2 N5): gitignored, local only. OPENPCB_REQUIRE_KICAD_REF=1 turns the skip into a failure.
const CORPUS_DIR = process.env.OPENPCB_KICAD_CORPUS_DIR
  ? path.resolve(process.env.OPENPCB_KICAD_CORPUS_DIR)
  : path.resolve(import.meta.dir, "../../../../../cloud-workspace/cloud-auto-layout");
const CHICKADEE = path.join(
  CORPUS_DIR,
  "workspace/external/writeback_check_r2/0400_laptimer58_Chickadee/semantic.kicad_pcb",
);
const REQUIRE_REF = process.env.OPENPCB_REQUIRE_KICAD_REF === "1";

describe("Chickadee corpus (skip-unless-present)", () => {
  test.skipIf(!existsSync(CHICKADEE) && !REQUIRE_REF)(
    "F and B R_0603_HandSoldering instances have one contentKey",
    () => {
      expect(existsSync(CHICKADEE)).toBe(true);
      const instances = footprintsOf(readFileSync(CHICKADEE, "utf8"))
        .map((fp) => unplaceBoardFootprint(fp))
        .filter((u) => u.libId === "Resistors_SMD:R_0603_HandSoldering");
      const sides = new Set(instances.map((u) => u.side));
      expect(sides).toEqual(new Set(["front", "back"]));
      expect(new Set(instances.map((u) => u.contentKey)).size).toBe(1);
    },
  );
});
