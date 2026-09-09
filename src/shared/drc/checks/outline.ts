import { ringsIntersect, ringStrictlyInside } from "../../pcb-geometry/board-region";
import { ringSelfIntersects } from "../../pcb-geometry/segment-predicates";
import { DEGENERATE_AREA_MM2, ringSignedArea } from "../../pcb-geometry/ring-utils";
import {
  boundsIntersectionCenter,
  boundsOfPoints,
} from "../../pcb-geometry/region-rings";
import type { Point } from "../../pcb-geometry/pcb-trace-geometry";
import type { DrcContext, LegalityContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";

/** Everything the outline verdict reads — no items, no rules, no projection. */
type OutlineInput = Pick<
  LegalityContext,
  "outlineRing" | "cutoutRings" | "boardRegion"
>;

/**
 * Board-outline validity (resurrects the dead BOARD_OUTLINE_INVALID code —
 * audit B4-5). Runs FIRST so a malformed outline contextualizes the noise the
 * edge/off-board checks would otherwise emit. Self-intersection and zero-area
 * run on the UNBIASED, refined rings (§4 table — bias itself can introduce
 * crossings); cutout-in-outline and cutout-separation run on the BIASED rings
 * (§4, §6 — conservative: a true breach or contact is always caught).
 */
function ringIsFinite(ring: readonly Point[]): boolean {
  return ring.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/**
 * The `BOARD_OUTLINE_INVALID` drafts of a board — the ONE outline verdict.
 * `buildDrcItems` runs it once for `ctx.outlineInvalid` (07 §6: with an invalid
 * outline the commit gate reports rather than refuses the off-board tier) and
 * `checkOutline` returns exactly this list, so the gate and the report can
 * never disagree about whether the outline is broken.
 */
export function outlineProblems(ctx: OutlineInput): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const outline = ctx.outlineRing;

  const emit = (message: string, locationMm: Point) => {
    out.push({
      code: "BOARD_OUTLINE_INVALID",
      message,
      anchors: [{ kind: "boardEdge" }],
      locationMm,
    });
  };

  if (!ringIsFinite(outline)) {
    emit("Board outline has a non-finite coordinate", outline[0] ?? { x: 0, y: 0 });
    return out;
  }
  if (
    outline.length < 3 ||
    Math.abs(ringSignedArea(outline)) < DEGENERATE_AREA_MM2
  ) {
    emit("Board outline is empty or has zero area", outline[0] ?? { x: 0, y: 0 });
    return out; // nothing else is meaningful without a valid outer ring
  }
  if (ringSelfIntersects(outline)) {
    emit("Board outline self-intersects", outline[0]!);
  }

  const degenerate = ctx.cutoutRings.map(
    (cut) =>
      !ringIsFinite(cut) ||
      cut.length < 3 ||
      Math.abs(ringSignedArea(cut)) < DEGENERATE_AREA_MM2,
  );
  ctx.cutoutRings.forEach((cut, i) => {
    const where = cut[0] ?? outline[0]!;
    if (!ringIsFinite(cut)) {
      emit(`Cutout ${i + 1} has a non-finite coordinate`, where);
      return;
    }
    if (degenerate[i]) {
      emit(`Cutout ${i + 1} is empty or has zero area`, where);
      return;
    }
    if (ringSelfIntersects(cut)) {
      emit(`Cutout ${i + 1} self-intersects`, where);
    }
    // Cutout must lie strictly inside the outer outline, on the biased rings —
    // touching or crossing the edge leaves a zero-width or negative web.
    if (!ringStrictlyInside(ctx.boardRegion.holes[i]!, ctx.boardRegion.outer)) {
      emit(`Cutout ${i + 1} touches or extends outside the board outline`, where);
    }
  });
  // Cutouts must not touch or overlap each other, on the biased rings. Every
  // eligible pair is tested and reported, independent of the per-cutout early
  // returns above, so the violation multiset does not depend on authoring order.
  for (let i = 0; i < ctx.cutoutRings.length; i += 1) {
    if (degenerate[i]) continue;
    for (let j = i + 1; j < ctx.cutoutRings.length; j += 1) {
      if (degenerate[j]) continue;
      if (
        ringsIntersect(ctx.boardRegion.holes[i]!, ctx.boardRegion.holes[j]!)
      ) {
        // Marker = the centre of the two rings' box overlap: symmetric in the
        // pair and distinct per pair, so two pairs sharing one cutout get two
        // ids (the code is location-hashed, contract 06 §6).
        emit(
          `Cutouts ${i + 1} and ${j + 1} touch or overlap`,
          boundsIntersectionCenter(
            boundsOfPoints(ctx.boardRegion.holes[i]!),
            boundsOfPoints(ctx.boardRegion.holes[j]!),
          ),
        );
      }
    }
  }

  // A ring whose biased flattening still self-crossed even at the refinement
  // cap: below any manufacturable web, treated as invalid (§3, §6).
  for (const idx of ctx.boardRegion.fallbacks) {
    const message =
      idx === 0
        ? "Board outline is finer than the outline tolerance (0.01 mm)"
        : `Cutout ${idx} is finer than the outline tolerance (0.01 mm)`;
    emit(message, outline[0] ?? { x: 0, y: 0 });
  }

  return out;
}

/**
 * The outline verdict `buildDrcItems` already computed (R1 #5) — a copy, so a
 * caller that mutates the returned array cannot corrupt the context's cache.
 */
export function checkOutline(ctx: DrcContext): DrcViolationDraft[] {
  return [...ctx.outlineDrafts];
}
