import { ringsIntersect, ringStrictlyInside } from "../../pcb/board-region";
import { ringSelfIntersects } from "../../pcb/segment-predicates";
import { ringSignedArea } from "../../pcb/ring-utils";
import type { Point } from "../../pcb/pcb-trace-geometry";
import type { DrcContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";

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

export function checkOutline(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const outline = ctx.outlineRing;

  const emit = (message: string, locationMm: Point) => {
    out.push({
      code: "BOARD_OUTLINE_INVALID",
      ruleClass: "constraint",
      message,
      anchors: [{ kind: "boardEdge" }],
      locationMm,
    });
  };

  if (!ringIsFinite(outline)) {
    emit("Board outline has a non-finite coordinate", outline[0] ?? { x: 0, y: 0 });
    return out;
  }
  if (outline.length < 3 || Math.abs(ringSignedArea(outline)) < 1e-6) {
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
      Math.abs(ringSignedArea(cut)) < 1e-6,
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
        emit(
          `Cutouts ${i + 1} and ${j + 1} touch or overlap`,
          ctx.cutoutRings[i]![0] ?? outline[0]!,
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
