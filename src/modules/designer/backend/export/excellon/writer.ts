import type {
  DesignerPcbProjection,
  PcbDrillSlot,
  PcbPointMm,
} from "../../../../../sdks/designer/types";
import {
  footprintPadDrill,
  freeHoleDrill,
  freePadDrill,
} from "../../../../../shared/rendering/pcb/pcb-drills";
import { placementPads } from "../../../../../shared/pcb-geometry/pad-geometry";

/**
 * Excellon 2 drill file writer.
 *
 * Header:
 *   M48                       — program start
 *   ;FILE_FORMAT=4:6          — informational
 *   FMAT,2                    — Excellon-2 format
 *   METRIC,LZ                 — units mm, leading zeros kept
 *   T1C0.300                  — tool 1, diameter 0.300 mm
 *   …
 *   %                         — end of header
 *
 * Body (per tool):
 *   T1
 *   X<int>Y<int>              — drill hit
 *   …
 *
 * Trailer:
 *   M30                       — program end
 *
 * Coordinates are scaled to 6 decimal places (matches Gerber FS X4.6).
 */

const NL = "\r\n";

interface DrillHit {
  centerMm: PcbPointMm;
  diameterMm: number;
  plated: boolean;
  /**
   * When set, the hit is a routed slot from `centerMm` to `slotEndMm` cut with
   * a `diameterMm`-wide tool (emitted as a `G85` canned slot). Round hits leave
   * this undefined.
   */
  slotEndMm?: PcbPointMm;
}

/**
 * Slot endpoints from an oblong-drill descriptor: a `widthMm`-wide tool routed
 * between two centers `(lengthMm − widthMm)` apart along `angleDeg`. Tool
 * diameter is the slot width; round-end caps come from the tool radius.
 */
function slotHit(
  center: PcbPointMm,
  slot: PcbDrillSlot,
  plated: boolean,
): DrillHit {
  const half = Math.max(0, (slot.lengthMm - slot.widthMm) / 2);
  const a = (slot.angleDeg * Math.PI) / 180;
  const dx = half * Math.cos(a);
  const dy = half * Math.sin(a);
  return {
    centerMm: { x: center.x - dx, y: center.y - dy },
    slotEndMm: { x: center.x + dx, y: center.y + dy },
    diameterMm: slot.widthMm,
    plated,
  };
}

/**
 * Build one Excellon drill file. When `kind === "PTH"` only plated holes
 * (vias, plated component pads, plated free pads) are emitted; when
 * `kind === "NPTH"` only unplated holes (mounting holes, unplated free
 * pads) are emitted. Splitting the two files matches fab-house
 * expectations (most fabs price PTH and NPTH separately and reject a
 * combined file or treat everything as plated).
 */
export function buildExcellonDrill(
  proj: DesignerPcbProjection,
  _warnings: string[],
  kind: "PTH" | "NPTH" = "PTH",
): string {
  const allHits = collectDrillHits(proj);
  const hits = allHits.filter((h) => (kind === "PTH" ? h.plated : !h.plated));
  // Group hits by diameter (sub-µm precision). Within one kind file all
  // tools have the same plating, so the key collapses to diameter alone.
  const tools = new Map<
    string,
    { code: number; diameterMm: number; hits: DrillHit[] }
  >();
  let nextTool = 1;
  for (const hit of hits) {
    const key = hit.diameterMm.toFixed(4);
    let bucket = tools.get(key);
    if (!bucket) {
      bucket = {
        code: nextTool++,
        diameterMm: hit.diameterMm,
        hits: [],
      };
      tools.set(key, bucket);
    }
    bucket.hits.push(hit);
  }

  const lines: string[] = [];
  // Header
  lines.push("M48");
  lines.push(`; OpenPCB Excellon drill file — ${kind}`);
  // X2 FileFunction attribute embedded as a CAM-readable comment (KiCad-style
  // `#@!` marker). Span = layer 1 → bottom; plated flag matches the file kind.
  const lastLayer = Math.max(2, proj.board.layerCount ?? 2);
  lines.push(
    kind === "PTH"
      ? `; #@! TF.FileFunction,Plated,1,${lastLayer},PTH,Drill*`
      : `; #@! TF.FileFunction,NonPlated,1,${lastLayer},NPTH,Drill*`,
  );
  // Explicit-decimal coordinate format eliminates the leading/trailing-zero
  // ambiguity that is the single most common drill-file rejection cause.
  lines.push(";FORMAT={-:-/ absolute / metric / decimal}");
  lines.push("FMAT,2");
  lines.push("METRIC");
  // Tool definitions
  const sortedTools = Array.from(tools.values()).sort(
    (a, b) => a.code - b.code,
  );
  for (const tool of sortedTools) {
    lines.push(`T${tool.code}C${tool.diameterMm.toFixed(3)}`);
  }
  lines.push("%");
  // Body
  lines.push("G90"); // absolute coordinates
  lines.push("G05"); // drill mode
  for (const tool of sortedTools) {
    lines.push(`; ${kind} ${tool.diameterMm.toFixed(3)} mm`);
    lines.push(`T${tool.code}`);
    for (const hit of tool.hits) {
      if (hit.slotEndMm) {
        // G85 canned slot: route from start to end with the current tool.
        lines.push(
          `X${coord(hit.centerMm.x)}Y${coord(hit.centerMm.y)}G85X${coord(
            hit.slotEndMm.x,
          )}Y${coord(hit.slotEndMm.y)}`,
        );
      } else {
        lines.push(`X${coord(hit.centerMm.x)}Y${coord(hit.centerMm.y)}`);
      }
    }
  }
  lines.push("T0");
  lines.push("M30");
  return lines.join(NL) + NL;
}

function coord(mm: number): string {
  if (!Number.isFinite(mm)) {
    throw new Error(`Excellon coord: non-finite ${mm}`);
  }
  // Explicit decimal point (4 dp = 0.1 µm), sign preserved. With a literal
  // decimal point the format is unambiguous regardless of zero-suppression.
  return mm.toFixed(4);
}

function collectDrillHits(proj: DesignerPcbProjection): DrillHit[] {
  const hits: DrillHit[] = [];

  for (const via of proj.vias) {
    if (via.drillMm > 0) {
      hits.push({
        centerMm: via.centerMm,
        diameterMm: via.drillMm,
        plated: true,
      });
    }
  }

  // THE one footprint-pad drill derivation (`footprintPadDrill`, contract 10
  // §1.1 / §6.3): the drill OFFSET is already in the centre, an oblong drill
  // becomes a `G85` routed hit with the tool = slot width, and an unplated pad
  // goes to the NPTH file. The old loop read `drillDiameterMm` directly,
  // snapped the placement rotation to 90° steps and called every footprint
  // hole plated.
  for (const placement of proj.placements) {
    for (const pad of placementPads(placement)) {
      const drill = footprintPadDrill(pad, placement);
      if (!drill) continue;
      hits.push(
        drill.slot
          ? {
              centerMm: drill.slot.a,
              slotEndMm: drill.slot.b,
              diameterMm: drill.slot.widthMm,
              plated: drill.plated,
            }
          : {
              centerMm: drill.centerMm,
              diameterMm: drill.drillMm,
              plated: drill.plated,
            },
      );
    }
  }

  // Free holes (F5 mounting holes) are NPTH by convention — THE one free-hole
  // derivation, so the tool is the slot width and a degenerate slot is a round
  // hit of that width, exactly as DRC models it (Astra run 2b #1).
  for (const hole of proj.freeHoles) {
    const drill = freeHoleDrill(hole);
    if (!drill) continue;
    hits.push(
      drill.slot
        ? {
            centerMm: drill.slot.a,
            slotEndMm: drill.slot.b,
            diameterMm: drill.slot.widthMm,
            plated: false,
          }
        : { centerMm: drill.centerMm, diameterMm: drill.drillMm, plated: false },
    );
  }

  // THE one free-pad drill derivation (`freePadDrill`), so the drill file, the
  // pour's apertures and DRC's holes are the same set of hits — plating
  // included: only `std` is plated, every other type's drill is an NPTH.
  for (const pad of proj.freePads) {
    const drill = freePadDrill(pad);
    if (!drill) continue;
    hits.push(
      drill.slot
        ? {
            centerMm: drill.slot.a,
            slotEndMm: drill.slot.b,
            diameterMm: drill.slot.widthMm,
            plated: drill.plated,
          }
        : {
            centerMm: pad.centerMm,
            diameterMm: drill.drillMm,
            plated: drill.plated,
          },
    );
  }

  return hits;
}

export type { DrillHit };
