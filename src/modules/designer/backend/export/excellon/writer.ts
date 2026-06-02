import type {
  DesignerPcbProjection,
  PcbDrillSlot,
  PcbPointMm,
} from "../../../../../sdks/designer/types";
import { projectLocal } from "../transform";

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

  for (const placement of proj.placements) {
    const pads = placement.footprint.preview?.pads ?? [];
    for (const pad of pads) {
      const drill = pad.drillDiameterMm ?? 0;
      if (drill <= 0) continue;
      const center = projectLocal(placement, pad.centerMm);
      hits.push({ centerMm: center, diameterMm: drill, plated: true });
    }
  }

  for (const hole of proj.freeHoles) {
    // Free holes (F5 mounting holes) are NPTH by convention.
    if (hole.drillSlot) {
      hits.push(slotHit(hole.centerMm, hole.drillSlot, false));
    } else if (hole.drillMm > 0) {
      hits.push({
        centerMm: hole.centerMm,
        diameterMm: hole.drillMm,
        plated: false,
      });
    }
  }

  for (const pad of proj.freePads) {
    const plated = pad.padType === "std";
    if (pad.drillSlot) {
      hits.push(slotHit(pad.centerMm, pad.drillSlot, plated));
    } else if (pad.drillMm !== null && pad.drillMm > 0) {
      hits.push({
        centerMm: pad.centerMm,
        diameterMm: pad.drillMm,
        plated,
      });
    }
  }

  return hits;
}

export type { DrillHit };
