/**
 * Server-side output check for generated footprints (H15 §3.3): IPC presets
 * and parametric templates must not emit pads that overlap, holes that
 * overlap, degenerate pads, or one pad number on separate copper.
 *
 * Gaps are measured with the DRC's own exact kernel at identity placement
 * (`padOutlineWorldMm` → `padRoundedWorldMm` → `roundedGap`), and copper
 * layers come from THE pad→copper resolver, so a footprint that passes here
 * cannot short against itself in the DRC for a geometric reason this check
 * ignored.
 */
import type {
  PcbCopperLayerId,
  PcbLayerCount,
  PcbPlacedPart,
} from "../../../../sdks/designer";
import {
  copperLayersForCount,
  MAX_PCB_LAYER_COUNT,
} from "../../../../sdks/designer/stackup";
import {
  padOutlineWorldMm,
  padRoundedWorldMm,
  ringBounds,
  type RingBounds,
} from "../../../../shared/pcb-geometry/pad-outline";
import {
  roundedGap,
  roundedPoint,
  roundedSegment,
} from "../../../../shared/pcb-geometry/rounded-shape";
import type { RoundedShape } from "../../../../shared/pcb-geometry/rounded-shape-types";
import { GEOM_EPS_MM } from "../../../../shared/pcb-geometry/tolerance";
import { resolvePadCopperLayers } from "../../../../shared/rendering/pad-copper-layers";
import { footprintPadDrill } from "../../../../shared/rendering/pcb/pcb-drills";
import type {
  FootprintRenderSource,
  FootprintRenderSourcePad,
} from "../../../../shared/rendering/types";
import { UnqualifiedGeneratorError } from "./unqualified-generator-error";

export interface GeneratedGeometryDefect {
  readonly kind:
    | "non-positive-size"
    | "duplicate-pad-number"
    | "pad-overlap"
    | "drill-overlap";
  readonly padIds: readonly string[]; // ids, not numbers: numbers may be "" or repeated
  readonly padNumbers: readonly string[];
  readonly gapMm?: number;
}

/** Footprint-local frame: the pads exactly as the generator emitted them. */
const IDENTITY: PcbPlacedPart = {
  id: "generated-geometry",
  partId: "",
  componentId: "",
  reference: "",
  positionMm: { x: 0, y: 0 },
  rotationDeg: 0,
  mirrored: false,
  layer: "F.Cu",
  footprint: {
    footprintId: "",
    name: "",
    mountType: null,
    sourceHash: null,
    preview: null,
  },
};

const ALL_COPPER: ReadonlySet<PcbCopperLayerId> = new Set(
  copperLayersForCount(MAX_PCB_LAYER_COUNT as PcbLayerCount),
);

/** At most this many defects are spelled out in the error message. */
const MESSAGE_DEFECT_LIMIT = 5;

interface PadGeometry {
  readonly id: string;
  readonly number: string;
  /** null when the pad has a non-positive or non-finite size. */
  readonly copper: {
    readonly layers: ReadonlySet<PcbCopperLayerId>;
    readonly shape: RoundedShape;
    readonly bounds: RingBounds;
  } | null;
  readonly drill: { readonly shape: RoundedShape; readonly bounds: RingBounds } | null;
}

function positiveSize(pad: FootprintRenderSourcePad): boolean {
  return pad.widthMm > 0 && pad.heightMm > 0;
}

function drillShape(pad: FootprintRenderSourcePad): PadGeometry["drill"] {
  const drill = footprintPadDrill(pad, IDENTITY);
  if (!drill) return null;
  const r = drill.drillMm / 2;
  const shape = drill.slot
    ? roundedSegment(drill.slot.a, drill.slot.b, drill.slot.widthMm / 2)
    : roundedPoint(drill.centerMm, r);
  const xs = shape.core.map((p) => p.x);
  const ys = shape.core.map((p) => p.y);
  return {
    shape,
    bounds: {
      minX: Math.min(...xs) - shape.radiusMm,
      minY: Math.min(...ys) - shape.radiusMm,
      maxX: Math.max(...xs) + shape.radiusMm,
      maxY: Math.max(...ys) + shape.radiusMm,
    },
  };
}

function analyse(pad: FootprintRenderSourcePad): PadGeometry {
  const number = typeof pad.number === "string" ? pad.number : "";
  const id = typeof pad.id === "string" ? pad.id : "";
  if (!positiveSize(pad)) return { id, number, copper: null, drill: null };
  const ring = padOutlineWorldMm(IDENTITY, pad);
  return {
    id,
    number,
    copper: {
      layers: resolvePadCopperLayers(pad, IDENTITY, ALL_COPPER),
      shape: padRoundedWorldMm(IDENTITY, pad, ring),
      // The ring circumscribes the exact shape, so disjoint ring bounds prove
      // a positive gap.
      bounds: ringBounds(ring),
    },
    drill: drillShape(pad),
  };
}

/** Bounds farther apart than the tolerance cannot hold a defect. */
function apart(a: RingBounds, b: RingBounds): boolean {
  return (
    a.maxX + GEOM_EPS_MM < b.minX ||
    b.maxX + GEOM_EPS_MM < a.minX ||
    a.maxY + GEOM_EPS_MM < b.minY ||
    b.maxY + GEOM_EPS_MM < a.minY
  );
}

function sharesLayer(
  a: ReadonlySet<PcbCopperLayerId>,
  b: ReadonlySet<PcbCopperLayerId>,
): boolean {
  for (const layer of a) if (b.has(layer)) return true;
  return false;
}

/** Copper gap, or null when the pads share no copper layer. NaN fails closed. */
function copperGap(a: PadGeometry, b: PadGeometry): number | null {
  if (!a.copper || !b.copper) return null;
  if (!sharesLayer(a.copper.layers, b.copper.layers)) return null;
  if (apart(a.copper.bounds, b.copper.bounds)) return Infinity;
  return roundedGap(a.copper.shape, b.copper.shape);
}

function drillGap(a: PadGeometry, b: PadGeometry): number | null {
  if (!a.drill || !b.drill) return null;
  if (apart(a.drill.bounds, b.drill.bounds)) return Infinity;
  return roundedGap(a.drill.shape, b.drill.shape);
}

/** A defect is a gap ≤ GEOM_EPS_MM; `!(gap > eps)` also catches NaN. */
function touching(gap: number | null): gap is number {
  return gap !== null && !(gap > GEOM_EPS_MM);
}

/** Same non-empty number on copper that does not connect: two pads, one pin. */
function duplicateNumberDefects(
  geometry: readonly PadGeometry[],
): GeneratedGeometryDefect[] {
  const groups = new Map<string, number[]>();
  geometry.forEach((pad, index) => {
    if (pad.number === "") return;
    const group = groups.get(pad.number);
    if (group) group.push(index);
    else groups.set(pad.number, [index]);
  });
  const defects: GeneratedGeometryDefect[] = [];
  for (const [number, members] of groups) {
    if (members.length < 2) continue;
    // A stack (KiCad EP sub-pads) is allowed: same-number pads whose copper
    // touches form ONE pad. Union-find over touching members.
    const parent = members.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
      return i;
    };
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const gap = copperGap(geometry[members[i]!]!, geometry[members[j]!]!);
        if (touching(gap)) parent[find(i)] = find(j);
      }
    }
    if (new Set(members.map((_, i) => find(i))).size < 2) continue;
    defects.push({
      kind: "duplicate-pad-number",
      padIds: members.map((index) => geometry[index]!.id),
      padNumbers: members.map(() => number),
    });
  }
  return defects;
}

/**
 * Every unordered pair EXCEPT two pads with the same non-empty number (a
 * stack). Empty numbers mean "no electrical pad" (mounting arrays): they are
 * exempt from the duplicate check but not from the overlap and drill checks.
 */
export function generatedGeometryDefects(
  pads: readonly FootprintRenderSourcePad[],
): GeneratedGeometryDefect[] {
  const geometry = pads.map(analyse);
  const defects: GeneratedGeometryDefect[] = geometry
    .filter((pad) => !pad.copper)
    .map((pad) => ({
      kind: "non-positive-size",
      padIds: [pad.id],
      padNumbers: [pad.number],
    }));
  defects.push(...duplicateNumberDefects(geometry));
  for (let i = 0; i < geometry.length; i += 1) {
    const a = geometry[i]!;
    for (let j = i + 1; j < geometry.length; j += 1) {
      const b = geometry[j]!;
      if (a.number !== "" && a.number === b.number) continue;
      const pair = { padIds: [a.id, b.id], padNumbers: [a.number, b.number] };
      const copper = copperGap(a, b);
      if (touching(copper)) {
        defects.push({ kind: "pad-overlap", ...pair, gapMm: copper });
      }
      const drill = drillGap(a, b);
      if (touching(drill)) {
        defects.push({ kind: "drill-overlap", ...pair, gapMm: drill });
      }
    }
  }
  return defects;
}

function padLabel(id: string, number: string): string {
  return number !== "" ? number : `"${id}"`;
}

function describeDefect(defect: GeneratedGeometryDefect): string {
  const labels = defect.padIds.map((id, i) =>
    padLabel(id, defect.padNumbers[i] ?? ""),
  );
  // A negative gap is a lower bound on the overlap; 0 can also mean overlap
  // (two r = 0 polygons that intersect), so only a negative value is printed.
  const gap =
    defect.gapMm !== undefined && defect.gapMm < 0
      ? ` (gap ${defect.gapMm.toFixed(3)} mm)`
      : "";
  switch (defect.kind) {
    case "non-positive-size":
      return `pad ${labels[0]} has a non-positive size`;
    case "duplicate-pad-number":
      return `pad number ${defect.padNumbers[0]} is used by ${labels.length} pads that do not connect`;
    case "pad-overlap":
      return `pads ${labels[0]} and ${labels[1]} overlap${gap}`;
    case "drill-overlap":
      return `the holes of pads ${labels[0]} and ${labels[1]} overlap${gap}`;
  }
}

/** One sentence naming at most five defects. */
export function describeGeneratedGeometryDefects(
  defects: readonly GeneratedGeometryDefect[],
): string {
  const named = defects.slice(0, MESSAGE_DEFECT_LIMIT).map(describeDefect);
  const more = defects.length - named.length;
  return `${named.join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
}

/** Throws UnqualifiedGeneratorError (422) when the generated pads are unsafe. */
export function assertGeneratedGeometry(source: FootprintRenderSource): void {
  const defects = generatedGeometryDefects(source.pads);
  if (defects.length === 0) return;
  throw new UnqualifiedGeneratorError(
    `The generated footprint is not manufacturable: ${describeGeneratedGeometryDefects(defects)}. Regenerate it with non-overlapping parameters.`,
  );
}
