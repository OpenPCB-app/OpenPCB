import type {
  PcbCopperLayerId,
  PcbFreeHole,
  PcbFreePad,
  PcbOverlayText,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbVia,
} from "../../../../sdks";
import { placementMirrorX } from "../../../../sdks/designer/pcb-helpers";

const PAD_HIT_PAD_MM = 0.4;

/** Local→world transform mirroring backend pad-geometry.transformPadCenterMm. */
function transformLocal(
  localMm: PcbPointMm,
  rotationDeg: number,
  mirrored: boolean,
): PcbPointMm {
  const r = (((Math.round(rotationDeg / 90) * 90) % 360) + 360) % 360;
  const mx = mirrored ? -localMm.x : localMm.x;
  const my = localMm.y;
  switch (r) {
    case 90:
      return { x: -my, y: mx };
    case 180:
      return { x: -mx, y: -my };
    case 270:
      return { x: my, y: -mx };
    default:
      return { x: mx, y: my };
  }
}

export interface PadHit {
  placementId: string;
  padNumber: string;
  worldMm: PcbPointMm;
}

/** Hit-test pads across all placements; returns the first within `tolerance + halfDim`. */
export function hitPad(
  placements: readonly PcbPlacedPart[],
  cursorMm: PcbPointMm,
): PadHit | null {
  for (const placement of placements) {
    const pads = placement.footprint.preview?.pads ?? [];
    for (const pad of pads) {
      const offset = transformLocal(
        pad.centerMm,
        placement.rotationDeg,
        placementMirrorX(placement),
      );
      const cx = placement.positionMm.x + offset.x;
      const cy = placement.positionMm.y + offset.y;
      const halfW = pad.widthMm / 2 + PAD_HIT_PAD_MM;
      const halfH = pad.heightMm / 2 + PAD_HIT_PAD_MM;
      if (
        Math.abs(cursorMm.x - cx) <= halfW &&
        Math.abs(cursorMm.y - cy) <= halfH
      ) {
        return {
          placementId: placement.id,
          padNumber: pad.number,
          worldMm: { x: cx, y: cy },
        };
      }
    }
  }
  return null;
}

function inverseTransform(
  worldDelta: PcbPointMm,
  rotationDeg: number,
  mirrored: boolean,
): PcbPointMm {
  const r = (((Math.round(rotationDeg / 90) * 90) % 360) + 360) % 360;
  let local: PcbPointMm;
  switch (r) {
    case 90:
      local = { x: worldDelta.y, y: -worldDelta.x };
      break;
    case 180:
      local = { x: -worldDelta.x, y: -worldDelta.y };
      break;
    case 270:
      local = { x: -worldDelta.y, y: worldDelta.x };
      break;
    default:
      local = { x: worldDelta.x, y: worldDelta.y };
  }
  return mirrored ? { x: -local.x, y: local.y } : local;
}

const TRACE_HIT_MM = 0.2;

export interface TraceHit {
  trace: PcbTrace;
  segmentIndex: number;
  closestMm: PcbPointMm;
  distanceMm: number;
}

function projectPointToSegment(
  point: PcbPointMm,
  start: PcbPointMm,
  end: PcbPointMm,
): { closest: PcbPointMm; distance: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ddx = point.x - start.x;
    const ddy = point.y - start.y;
    return { closest: start, distance: Math.sqrt(ddx * ddx + ddy * ddy) };
  }
  const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lenSq;
  const t = Math.max(0, Math.min(1, rawT));
  const closest = { x: start.x + dx * t, y: start.y + dy * t };
  const ddx = point.x - closest.x;
  const ddy = point.y - closest.y;
  return { closest, distance: Math.sqrt(ddx * ddx + ddy * ddy) };
}

/**
 * Hit-test traces on the active copper layer. Returns the closest trace whose
 * distance to the cursor is within (trace.widthMm/2 + TRACE_HIT_MM).
 */
export function hitTrace(
  traces: readonly PcbTrace[],
  cursorMm: PcbPointMm,
  activeLayer: PcbCopperLayerId,
): TraceHit | null {
  let best: TraceHit | null = null;
  for (const trace of traces) {
    if (trace.layer !== activeLayer) continue;
    const tolerance = trace.widthMm / 2 + TRACE_HIT_MM;
    for (let i = 1; i < trace.pointsNm.length; i += 1) {
      const a = {
        x: trace.pointsNm[i - 1]!.x / 1_000_000,
        y: trace.pointsNm[i - 1]!.y / 1_000_000,
      };
      const b = {
        x: trace.pointsNm[i]!.x / 1_000_000,
        y: trace.pointsNm[i]!.y / 1_000_000,
      };
      const proj = projectPointToSegment(cursorMm, a, b);
      if (
        proj.distance <= tolerance &&
        (!best || proj.distance < best.distanceMm)
      ) {
        best = {
          trace,
          segmentIndex: i - 1,
          closestMm: proj.closest,
          distanceMm: proj.distance,
        };
      }
    }
  }
  return best;
}

export interface TraceVertexHit {
  trace: PcbTrace;
  /** Interior vertex index (1 .. pointsNm.length-2). */
  vertexIndex: number;
  /** Vertex position in world mm. */
  pointMm: PcbPointMm;
}

/**
 * Hit-test the INTERIOR vertices (bends) of one trace. Endpoints are pads and
 * are excluded — they're never draggable. `toleranceMm` is a constant
 * on-screen radius converted to mm by the caller (`(hitPx/2)/zoom`) so handles
 * stay grabbable at any zoom (cf. `hitDrcMarker`).
 */
export function hitTraceVertex(
  trace: PcbTrace,
  cursorMm: PcbPointMm,
  toleranceMm: number,
): TraceVertexHit | null {
  let best: TraceVertexHit | null = null;
  let bestSq = toleranceMm * toleranceMm;
  for (let i = 1; i < trace.pointsNm.length - 1; i += 1) {
    const vx = trace.pointsNm[i]!.x / 1_000_000;
    const vy = trace.pointsNm[i]!.y / 1_000_000;
    const dx = cursorMm.x - vx;
    const dy = cursorMm.y - vy;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestSq) {
      bestSq = d2;
      best = { trace, vertexIndex: i, pointMm: { x: vx, y: vy } };
    }
  }
  return best;
}

/** Hit-test free standalone holes. Uses drill radius + small padding. */
export function hitFreeHole(
  freeHoles: readonly PcbFreeHole[],
  cursorMm: PcbPointMm,
): PcbFreeHole | null {
  for (const hole of freeHoles) {
    const r = hole.drillMm / 2 + 0.3;
    const dx = cursorMm.x - hole.centerMm.x;
    const dy = cursorMm.y - hole.centerMm.y;
    if (dx * dx + dy * dy <= r * r) return hole;
  }
  return null;
}

/** Hit-test free standalone pads. Bounding-box test with rotation support. */
export function hitFreePad(
  freePads: readonly PcbFreePad[],
  cursorMm: PcbPointMm,
): PcbFreePad | null {
  for (const pad of freePads) {
    const delta = {
      x: cursorMm.x - pad.centerMm.x,
      y: cursorMm.y - pad.centerMm.y,
    };
    const local = transformLocal(
      { x: delta.x, y: delta.y },
      -pad.rotationDeg,
      false,
    );
    const halfW = pad.widthMm / 2 + 0.1;
    const halfH = pad.heightMm / 2 + 0.1;
    if (Math.abs(local.x) <= halfW && Math.abs(local.y) <= halfH) return pad;
  }
  return null;
}

/** Hit-test overlay text objects. Uses a fixed bounding box approximation. */
export function hitOverlayText(
  texts: readonly PcbOverlayText[],
  cursorMm: PcbPointMm,
): PcbOverlayText | null {
  for (const text of texts) {
    const halfW = (text.fontSizeMm * text.text.length * 0.6) / 2 + 0.5;
    const halfH = text.fontSizeMm / 2 + 0.3;
    if (
      Math.abs(cursorMm.x - text.positionMm.x) <= halfW &&
      Math.abs(cursorMm.y - text.positionMm.y) <= halfH
    ) {
      return text;
    }
  }
  return null;
}

/** Hit-test through-vias. Bounds-check against via outer diameter. */
export function hitVia(
  vias: readonly PcbVia[],
  cursorMm: PcbPointMm,
): PcbVia | null {
  for (const via of vias) {
    const r = via.diameterMm / 2;
    const dx = cursorMm.x - via.centerMm.x;
    const dy = cursorMm.y - via.centerMm.y;
    if (dx * dx + dy * dy <= r * r) return via;
  }
  return null;
}

/**
 * Aggregate hit-test result: an ordered list of candidates under the cursor,
 * paint order first (closest visible thing first). Used for Alt+click
 * disambiguation popups so the user can cycle through stacked items.
 *
 * Order: pad → trace → via → placement. Mirrors plain-click priority but
 * returns ALL matches so the UI can render a chooser.
 */
export type PcbHitCandidate =
  | { kind: "pad"; hit: PadHit }
  | { kind: "trace"; hit: TraceHit }
  | { kind: "via"; via: PcbVia }
  | { kind: "placement"; placement: PcbPlacedPart };

export interface HitAllInput {
  placements: readonly PcbPlacedPart[];
  traces: readonly PcbTrace[];
  vias: readonly PcbVia[];
  cursorMm: PcbPointMm;
  activeLayer: PcbCopperLayerId;
  selectionFilter?: {
    traces: boolean;
    vias: boolean;
    pads: boolean;
    placements: boolean;
  };
}

export function hitAll(input: HitAllInput): PcbHitCandidate[] {
  const out: PcbHitCandidate[] = [];
  const sf = input.selectionFilter;
  // Pads — every match (not just first) so the user can cycle near stacked
  // BGA pads. Hit-test re-uses hitPad's bounds check inline.
  if (!sf || sf.pads || sf.placements) {
    for (const placement of input.placements) {
      const pads = placement.footprint.preview?.pads ?? [];
      for (const pad of pads) {
        const offset = transformLocal(
          pad.centerMm,
          placement.rotationDeg,
          placementMirrorX(placement),
        );
        const cx = placement.positionMm.x + offset.x;
        const cy = placement.positionMm.y + offset.y;
        const halfW = pad.widthMm / 2 + PAD_HIT_PAD_MM;
        const halfH = pad.heightMm / 2 + PAD_HIT_PAD_MM;
        if (
          Math.abs(input.cursorMm.x - cx) <= halfW &&
          Math.abs(input.cursorMm.y - cy) <= halfH
        ) {
          out.push({
            kind: "pad",
            hit: {
              placementId: placement.id,
              padNumber: pad.number,
              worldMm: { x: cx, y: cy },
            },
          });
        }
      }
    }
  }
  // Traces on the active copper layer.
  if (!sf || sf.traces) {
    for (const trace of input.traces) {
      if (trace.layer !== input.activeLayer) continue;
      const tolerance = trace.widthMm / 2 + TRACE_HIT_MM;
      let best: TraceHit | null = null;
      for (let i = 1; i < trace.pointsNm.length; i += 1) {
        const a = {
          x: trace.pointsNm[i - 1]!.x / 1_000_000,
          y: trace.pointsNm[i - 1]!.y / 1_000_000,
        };
        const b = {
          x: trace.pointsNm[i]!.x / 1_000_000,
          y: trace.pointsNm[i]!.y / 1_000_000,
        };
        const proj = projectPointToSegment(input.cursorMm, a, b);
        if (
          proj.distance <= tolerance &&
          (!best || proj.distance < best.distanceMm)
        ) {
          best = {
            trace,
            segmentIndex: i - 1,
            closestMm: proj.closest,
            distanceMm: proj.distance,
          };
        }
      }
      if (best) out.push({ kind: "trace", hit: best });
    }
  }
  // Vias — all matches.
  if (!sf || sf.vias) {
    for (const via of input.vias) {
      const r = via.diameterMm / 2;
      const dx = input.cursorMm.x - via.centerMm.x;
      const dy = input.cursorMm.y - via.centerMm.y;
      if (dx * dx + dy * dy <= r * r) {
        out.push({ kind: "via", via });
      }
    }
  }
  // Placements — bounding-box match.
  if (!sf || sf.placements) {
    for (const placement of input.placements) {
      const bounds = placement.footprint.preview?.bounds;
      if (!bounds) continue;
      const delta = {
        x: input.cursorMm.x - placement.positionMm.x,
        y: input.cursorMm.y - placement.positionMm.y,
      };
      const local = inverseTransform(
        delta,
        placement.rotationDeg,
        placementMirrorX(placement),
      );
      if (
        local.x >= bounds.minX &&
        local.x <= bounds.maxX &&
        local.y >= bounds.minY &&
        local.y <= bounds.maxY
      ) {
        out.push({ kind: "placement", placement });
      }
    }
  }
  return out;
}

/**
 * Hit-test DRC violation markers. Markers render at a constant on-screen size,
 * so the caller passes a `toleranceMm` derived from the live zoom
 * (`(hitPx/2)/zoom`). Returns the closest marker within tolerance (circular,
 * forgiving) or null. Generic over the marker shape so it works directly with
 * the shared `DrcMarker` list (waived already excluded by the builder).
 */
export function hitDrcMarker<M extends { x: number; y: number }>(
  markers: readonly M[],
  cursorMm: PcbPointMm,
  toleranceMm: number,
): M | null {
  let best: M | null = null;
  let bestSq = toleranceMm * toleranceMm;
  for (const m of markers) {
    const dx = cursorMm.x - m.x;
    const dy = cursorMm.y - m.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestSq) {
      bestSq = d2;
      best = m;
    }
  }
  return best;
}

export function hitPlacement(
  placements: readonly PcbPlacedPart[],
  cursorMm: PcbPointMm,
): PcbPlacedPart | null {
  for (const placement of placements) {
    const bounds = placement.footprint.preview?.bounds;
    if (!bounds) continue;
    const delta = {
      x: cursorMm.x - placement.positionMm.x,
      y: cursorMm.y - placement.positionMm.y,
    };
    const local = inverseTransform(
      delta,
      placement.rotationDeg,
      placementMirrorX(placement),
    );
    if (
      local.x >= bounds.minX &&
      local.x <= bounds.maxX &&
      local.y >= bounds.minY &&
      local.y <= bounds.maxY
    ) {
      return placement;
    }
  }
  return null;
}
