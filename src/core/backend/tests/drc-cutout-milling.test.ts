/**
 * S7 D12 — the advisory milling limits run over the CUTOUTS as well as the
 * outer outline: a cutout is routed with the same bit. The material is on the
 * OTHER side of a cutout ring, so which corners the bit cannot reach is
 * inverted: a sharp CONVEX corner of the void is un-millable, while a reflex
 * vertex is a tip of material the cutter passes around. Both codes are
 * location-hashed, so several hits sharing the single `boardEdge` anchor keep
 * distinct ids.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { filletCorner } from "../../../modules/designer/frontend/pcb/outline-corners";
import { verticesToContour } from "../../../modules/designer/frontend/pcb/sketch-geometry";
import { findSmallInternalRadii } from "../../../shared/rendering/pcb/outline-manufacturability";
import type {
  DesignerPcbProjection,
  DrcViolation,
  PcbBoardContour,
  PcbBoardCutout,
} from "../../../sdks/designer";
import { board, projection } from "./helpers/drc-fixtures";

// JLCPCB 2-layer (fab-presets.ts): min internal radius 0.8 mm, min slot 1.0 mm.
const FAB = "jlcpcb_2l" as const;

/** A 6 × 6 mm L: five convex vertices and one reflex tip at (dx+3, dy+3). */
function lRing(dx: number, dy: number): PcbBoardContour {
  return verticesToContour([
    { x: dx, y: dy },
    { x: dx + 6, y: dy },
    { x: dx + 6, y: dy + 3 },
    { x: dx + 3, y: dy + 3 },
    { x: dx + 3, y: dy + 6 },
    { x: dx, y: dy + 6 },
  ]);
}

function contourVertices(c: PcbBoardContour): Array<{ x: number; y: number }> {
  return [c.start, ...c.segments.slice(0, -1).map((s) => s.to)];
}

/**
 * The L with four of its five convex corners filleted well above the bit
 * radius, leaving exactly ONE sharp convex corner (at `dx, dy`) beside the one
 * reflex tip — the minimal shape that tells the two conventions apart.
 */
function lRingOneSharpConvex(dx: number, dy: number): PcbBoardContour {
  let shape = lRing(dx, dy);
  for (const [x, y] of [
    [dx + 6, dy],
    [dx + 6, dy + 3],
    [dx + 3, dy + 6],
    [dx, dy + 6],
  ]) {
    const index = contourVertices(shape).findIndex(
      (v) => v.x === x && v.y === y,
    );
    const filleted = index >= 0 ? filletCorner(shape, index, 1.2) : null;
    if (!filleted) throw new Error(`fillet failed at ${x},${y}`);
    shape = filleted;
  }
  return shape;
}

/** The default 50 × 30 board (rect outline: no hits of its own) + cutouts. */
function withCutouts(cutouts: PcbBoardCutout[]): DesignerPcbProjection {
  return projection({ board: board({ fabricator: FAB, cutouts }) });
}

function hitsOf(p: DesignerPcbProjection, code: string): DrcViolation[] {
  return runDrc(p).violations.filter((v) => v.code === code);
}

const radiusHits = (p: DesignerPcbProjection): DrcViolation[] =>
  hitsOf(p, "OUTLINE_INTERNAL_RADIUS");

const at = (v: DrcViolation): string =>
  `${v.locationMm!.x.toFixed(2)},${v.locationMm!.y.toFixed(2)}`;

describe("DRC — cutout milling advisories", () => {
  test("a rectangular cutout's four sharp corners each fire", () => {
    // `PcbBoardCutoutShape` has no `rect` arm, so a rectangular void is a
    // roundrect of radius 0 — four corners the 0.8 mm bit cannot reach into.
    const hits = radiusHits(
      withCutouts([
        {
          id: "c1",
          shape: {
            kind: "roundrect",
            widthMm: 4,
            heightMm: 4,
            centerMm: { x: -12, y: -2 },
            cornerRadiusMm: 0,
          },
        },
      ]),
    );
    expect(hits).toHaveLength(4);
    expect(hits.every((v) => v.measuredMm === 0)).toBe(true);
    expect(hits.map(at).sort()).toEqual([
      "-10.00,-4.00",
      "-10.00,0.00",
      "-14.00,-4.00",
      "-14.00,0.00",
    ]);
    expect(new Set(hits.map((v) => v.id)).size).toBe(4);
  });

  test("the `rect` outline arm behaves the same as a hole", () => {
    // Unreachable through a cutout (the union has no `rect`), so pinned on the
    // kernel directly — the arm exists because `PcbBoardOutline` carries it.
    const rect = {
      kind: "rect" as const,
      widthMm: 4,
      heightMm: 4,
      centerMm: { x: 0, y: 0 },
    };
    expect(findSmallInternalRadii(rect, 0.8, "outside")).toHaveLength(4);
    // As the board OUTLINE it is convex with the material inside: no hit.
    expect(findSmallInternalRadii(rect, 0.8)).toHaveLength(0);
  });

  test("a void's sharp convex corner fires; its reflex material tip does not", () => {
    const hits = radiusHits(
      withCutouts([{ id: "c1", shape: lRingOneSharpConvex(-15, -5) }]),
    );
    expect(hits).toHaveLength(1);
    expect(at(hits[0]!)).toBe("-15.00,-5.00"); // the convex corner
    expect(hits[0]!.measuredMm).toBe(0);
    expect(hits[0]!.message).toContain("Cutout 1 (c1) internal corner radius");
    expect(hits[0]!.message).toContain("JLCPCB");
    expect(hits[0]!.anchors).toEqual([{ kind: "boardEdge" }]);
    // Control: the SAME ring as the board outline reports the other corner —
    // the reflex tip at (-12, -2), a notch cut into the board.
    const asOutline = hitsOf(
      projection({
        board: board({
          fabricator: FAB,
          outline: lRingOneSharpConvex(-15, -5),
        }),
      }),
      "OUTLINE_INTERNAL_RADIUS",
    );
    expect(asOutline).toHaveLength(1);
    expect(at(asOutline[0]!)).toBe("-12.00,-2.00");
  });

  test("a roundrect cutout at or above the bit radius reports nothing", () => {
    expect(
      radiusHits(
        withCutouts([
          {
            id: "c1",
            shape: {
              kind: "roundrect",
              widthMm: 6,
              heightMm: 6,
              centerMm: { x: -12, y: -2 },
              cornerRadiusMm: 1,
            },
          },
        ]),
      ),
    ).toHaveLength(0);
  });

  test("a circular cutout narrower than the bit fires OUTLINE_SLOT_WIDTH", () => {
    const proj = withCutouts([
      {
        id: "c1",
        shape: {
          kind: "circle",
          widthMm: 0.8,
          heightMm: 0.8,
          centerMm: { x: -12, y: -2 },
        },
      },
    ]);
    const slots = hitsOf(proj, "OUTLINE_SLOT_WIDTH");
    expect(slots).toHaveLength(1);
    expect(slots[0]!.measuredMm).toBe(0.8);
    expect(slots[0]!.requiredMm).toBe(1);
    expect(slots[0]!.locationMm).toEqual({ x: -12, y: -2 });
    expect(slots[0]!.message).toContain("Cutout 1 (c1) slot / neck");
    // A circle has no corner at all.
    expect(radiusHits(proj)).toHaveLength(0);
  });

  test("a circular cutout the bit fits into reports nothing", () => {
    expect(
      hitsOf(
        withCutouts([
          {
            id: "c1",
            shape: {
              kind: "circle",
              widthMm: 2,
              heightMm: 2,
              centerMm: { x: -12, y: -2 },
            },
          },
        ]),
        "OUTLINE_SLOT_WIDTH",
      ),
    ).toHaveLength(0);
  });

  test("two cutouts → two violations with distinct ids", () => {
    const hits = radiusHits(
      withCutouts([
        { id: "cut-alpha", shape: lRingOneSharpConvex(-15, -5) },
        { id: "cut-beta", shape: lRingOneSharpConvex(5, -5) },
      ]),
    );
    expect(hits).toHaveLength(2);
    // The id is in the message, so reordering the array cannot make two hits
    // read as the same cutout.
    expect(hits.map((v) => v.message.slice(0, 19)).sort()).toEqual([
      "Cutout 1 (cut-al) i",
      "Cutout 2 (cut-be) i",
    ]);
    expect(new Set(hits.map((v) => v.id)).size).toBe(2);
  });

  test("a cutout-free board reports nothing, and `custom` fab is exempt", () => {
    expect(radiusHits(withCutouts([]))).toHaveLength(0);
    expect(
      hitsOf(
        projection({
          board: board({
            fabricator: "custom",
            cutouts: [{ id: "c1", shape: lRingOneSharpConvex(-15, -5) }],
          }),
        }),
        "OUTLINE_INTERNAL_RADIUS",
      ),
    ).toHaveLength(0);
  });

  test("the outer outline keeps its own wording (no `Cutout` prefix)", () => {
    const hits = hitsOf(
      projection({ board: board({ fabricator: FAB, outline: lRing(-3, -3) }) }),
      "OUTLINE_INTERNAL_RADIUS",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toStartWith("Internal corner radius 0.00 mm <");
  });
});
