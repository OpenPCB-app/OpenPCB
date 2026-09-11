/**
 * THE flattener of an assembled edge loop (DFM contract 11 §2.1).
 *
 * `chainEdgesToLoops` returns loops whose edges may be arcs. Two consumers need
 * them as geometry: the DXF importer, which wants the canonical
 * `PcbBoardContour` the outline commands take, and the courtyard region
 * builder, which wants a plain mm ring. Both went through `loopToContour`,
 * which lived inside `modules/designer/backend/import/dxf/` — a module-private
 * helper the shared courtyard kernel may not import. It moves here, beside the
 * chainer, and `to-outline.ts` re-exports it.
 *
 * Arcs are sampled by the S2 kernel through `flattenOutline`, UNBIASED: a
 * courtyard is a declared boundary, not a clearance operand, so neither an
 * inscribed nor a circumscribed bias is the honest reading of it — the
 * vertices sit on the true curve (contract 02 §3).
 */
import type {
  PcbBoardContour,
  PcbOutlineSegment,
  PcbPointMm,
} from "../../../sdks";
import { flattenOutline } from "../../pcb-geometry/outline-geometry";
import type { AssembledLoop } from "./chain-edges";
import { normalizeContour } from "./contour-validation";

/**
 * One closed loop as the canonical contour form. `widthMm` / `heightMm` /
 * `centerMm` are placeholders — `normalizeContour` does not read them and every
 * caller recomputes the bbox from the geometry.
 */
export function loopToContour(loop: AssembledLoop): PcbBoardContour {
  const first = loop.edges[0];
  const start: PcbPointMm = first
    ? { x: first.from.x, y: first.from.y }
    : { x: 0, y: 0 };
  const segments: PcbOutlineSegment[] = loop.edges.map((e) =>
    e.arc
      ? {
          type: "arc",
          to: { x: e.to.x, y: e.to.y },
          centerMm: { x: e.arc.centerMm.x, y: e.arc.centerMm.y },
          cw: e.arc.cw,
        }
      : { type: "line", to: { x: e.to.x, y: e.to.y } },
  );
  return normalizeContour({
    kind: "contour",
    widthMm: 0,
    heightMm: 0,
    centerMm: { x: 0, y: 0 },
    start,
    segments,
  });
}

/**
 * One closed loop as an OPEN mm ring (no repeated closing vertex), arcs
 * flattened by the S2 chord kernel with no bias. An empty array means the loop
 * carried no usable geometry — the caller decides what that means.
 */
export function loopToRing(loop: AssembledLoop): PcbPointMm[] {
  if (loop.edges.length === 0) return [];
  return flattenOutline(loopToContour(loop));
}
