/**
 * Assemble parsed DXF edges into closed loops and describe each as a board-shape
 * candidate. Returns every loop (outer + inner) with validity + geometry so the
 * caller (the inspect endpoint → import modal) can require an explicit choice
 * rather than silently picking the largest. Confirmation goes through the normal
 * `pcb_set_board_outline` command — this module never writes.
 */
import type { PcbBoardContour } from "../../../../../sdks";
import { chainEdgesToLoops, loopSignedArea } from "../../pcb/chain-edges";
import { validateContour } from "../../pcb/contour-validation";
import { computeOutlineBboxMm } from "../../pcb/outline-geometry";
// The loop flattener is shared with the courtyard region builder (DFM contract
// 11 §2.1), so it lives beside the chainer in `shared/rendering/pcb/`; this
// module keeps the name it published.
import { loopToContour } from "../../../../../shared/rendering/pcb/loop-ring";
import { parseDxfToEdges, type DxfParseOptions } from "./parse-dxf";

export { loopToContour };

/** Endpoint-merge tolerance (mm) when chaining DXF edges into loops. */
export const DXF_CHAIN_EPSILON_MM = 0.01;

export interface DxfLoopCandidate {
  index: number;
  role: "outer" | "inner";
  /** Edge/segment count of the closed loop. */
  segmentCount: number;
  areaMm2: number;
  widthMm: number;
  heightMm: number;
  valid: boolean;
  /** Validation messages when `valid` is false. */
  errors: string[];
  /** The normalized contour for this loop (the payload a confirm would send). */
  outline: PcbBoardContour;
}

export interface DxfInspectResult {
  loops: DxfLoopCandidate[];
  layers: string[];
  unitScaleMm: number;
  detectedUnits: string;
  openChainCount: number;
  diagnostics: string[];
}

/** Full pipeline: DXF text → loop candidates. Pure; performs no writes. */
export function inspectDxf(
  dxfText: string,
  opts?: DxfParseOptions,
): DxfInspectResult {
  const parsed = parseDxfToEdges(dxfText, opts);
  const chain = chainEdgesToLoops(parsed.edges, DXF_CHAIN_EPSILON_MM);

  const areas = chain.loops.map((l) => Math.abs(loopSignedArea(l)));
  const maxArea = areas.length > 0 ? Math.max(...areas) : 0;

  const loops: DxfLoopCandidate[] = chain.loops.map((loop, i) => {
    const outline = loopToContour(loop);
    const bbox = computeOutlineBboxMm(outline);
    const result = validateContour(outline);
    return {
      index: i,
      role: areas[i] === maxArea ? "outer" : "inner",
      segmentCount: outline.segments.length,
      areaMm2: areas[i]!,
      widthMm: bbox.widthMm,
      heightMm: bbox.heightMm,
      valid: result.ok,
      errors: result.ok ? [] : result.errors.map((e) => e.message),
      outline,
    };
  });

  return {
    loops,
    layers: parsed.layers,
    unitScaleMm: parsed.unitScaleMm,
    detectedUnits: parsed.detectedUnits,
    openChainCount: chain.openChainCount,
    diagnostics: [...parsed.diagnostics, ...chain.diagnostics],
  };
}
