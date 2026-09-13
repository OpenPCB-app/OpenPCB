/**
 * Junction witnesses — WHERE two pieces of copper touch (SI contract 14 §1).
 *
 * The boolean `copperTouch` says a pair is joined; a routed length needs the
 * arc-length position of the join on each trace. Nothing here re-decides the
 * boolean: the collector is driven from the graph's own `copperTouch` site, and
 * every distance it measures is the primitive that verdict was made on
 * (`segmentToSegmentDistance` under `polylineToPolylineDistance`, the
 * closest-points form of the same kernel, the rounded-shape core).
 *
 * A contact component is a maximal run of touching (segment, segment) pairs,
 * merged when adjacent in BOTH index spaces, so one item pair can yield several
 * junctions (a trace crossed twice) and one trace can meet itself (§1, Astra #1).
 */
import type { PcbCopperLayerId, PcbPointMm } from "../../sdks/designer";
import {
  distance,
  projectPointToSegment,
  segmentClosestPoints,
  segmentToSegmentDistance,
} from "../pcb-geometry/pcb-trace-geometry";
import { segmentsCrossTransversally } from "../pcb-geometry/segment-predicates";
import type {
  CopperItem,
  PadCopperItem,
  TraceCopperItem,
  ViaCopperItem,
} from "./copper-items";
import {
  componentWitness,
  contactComponents,
  segmentPairs,
} from "./contact-components";
import type { Junction, JunctionInterval } from "./net-path-types";
import {
  attachParameter,
  centrelineSpans,
  convexTarget,
  terminalShape,
} from "./terminal-contact";
import { arcOf, farthestWithinReach, pointAtArc, traceArc } from "./trace-arc";
import { sharedLayers } from "./touch";

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

function orderedKeys(a: CopperItem, b: CopperItem): [CopperItem, CopperItem] {
  return a.key <= b.key ? [a, b] : [b, a];
}

/**
 * Accumulates junctions for one `computeConnectivity` run. One record per
 * unordered item pair per contact component; a pad / via pair visited once per
 * shared layer is collapsed onto its first shared layer (§1 hygiene).
 */
export class JunctionCollector {
  private readonly out: Junction[] = [];
  private readonly visitedPairs = new Set<string>();
  private readonly emitted = new Set<string>();
  /** Trace key → the `i,j` segment pairs `traceSelf` already owns a junction for. */
  private readonly selfPairs = new Map<string, Set<string>>();

  constructor(private readonly epsMm: number) {}

  /** Called at the graph's own `copperTouch` union site. */
  pair(first: CopperItem, second: CopperItem): void {
    // Pour islands are not edges of the path model (§2.6): `net-path.ts` reads
    // their membership from the items, so a pour pair emits nothing.
    if (first.kind === "pour" || second.kind === "pour") return;
    const [a, b] = orderedKeys(first, second);
    const pairKey = `${a.key}\u0000${b.key}`;
    if (this.visitedPairs.has(pairKey)) return;
    this.visitedPairs.add(pairKey);
    const layer = sharedLayers(a, b)[0];
    if (!layer) return;
    if (a.kind === "trace" && b.kind === "trace") {
      this.traceTrace(a, b, layer);
    } else if (a.kind === "trace" || b.kind === "trace") {
      const trace = (a.kind === "trace" ? a : b) as TraceCopperItem;
      const term = (a.kind === "trace" ? b : a) as
        | PadCopperItem
        | ViaCopperItem;
      this.terminal(a.key, b.key, trace, term, layer);
    } else {
      this.plain(a as PadCopperItem | ViaCopperItem, b as PadCopperItem | ViaCopperItem, layer);
    }
  }

  /**
   * A trace's own end cap resting on its body. The caller has already made the
   * verdict with the S1 fold-back BOOLEAN; this only locates it.
   *
   * The boolean's witness is the FARTHEST point of the body still within reach
   * — that is what makes `s − d` maximal and the verdict correct — but it is up
   * to `2·hw` away from where the copper actually meets. The junction is placed
   * by §1's point rule instead: the intersection when the cap's own segment
   * crosses the body, else their minimum-distance point pair.
   */
  selfCap(trace: TraceCopperItem, endIndex: 0 | 1): void {
    const points =
      endIndex === 0 ? trace.pointsMm : [...trace.pointsMm].reverse();
    const local = traceArc(points);
    const segmentCount = points.length - 1;
    const hw = trace.halfWidthMm;
    const reach = 2 * hw + this.epsMm;
    const p = points[0]!;
    let best: { distanceMm: number; sCap: number; sBody: number; j: number } | null =
      null;
    let arc = 0;
    for (let j = 0; j + 1 < points.length; j += 1) {
      const a = points[j]!;
      const b = points[j + 1]!;
      const length = distance(a, b);
      if (j > 0) {
        const t = farthestWithinReach(p, a, b, reach);
        if (t !== null) {
          const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          const d = distance(q, p);
          if (arc + length * t - d > 2 * hw) {
            // §1's point rule, measured from the CAP: the intersection when the
            // cap's own segment crosses the body, else the foot of the cap on
            // it. The boolean's farthest-in-reach witness is up to `2·hw` past
            // that and would put the join where no copper narrows.
            const candidate = segmentsCrossTransversally(
              points[0]!,
              points[1]!,
              a,
              b,
            )
              ? (() => {
                  const cp = segmentClosestPoints(points[0]!, points[1]!, a, b);
                  return {
                    distanceMm: cp.distance,
                    sCap: arcOf(local, 0, cp.a),
                    sBody: arcOf(local, j, cp.b),
                    j,
                  };
                })()
              : (() => {
                  const foot = projectPointToSegment(p, a, b);
                  return {
                    distanceMm: foot.distance,
                    sCap: 0,
                    sBody: arcOf(local, j, { x: foot.x, y: foot.y }),
                    j,
                  };
                })();
            if (best === null || candidate.distanceMm < best.distanceMm) {
              best = candidate;
            }
          }
        }
      }
      arc += length;
    }
    if (best === null) return;
    // ONE contact component, ONE junction: when the body segment is far enough
    // from the cap's own segment for `traceSelf` to see the pair, that junction
    // is already the record for this contact.
    const forward = (index: number): number =>
      endIndex === 0 ? index : segmentCount - 1 - index;
    const capSeg = forward(0);
    const bodySeg = forward(best.j);
    const covered = this.selfPairs.get(trace.key);
    if (
      covered?.has(
        `${Math.min(capSeg, bodySeg)},${Math.max(capSeg, bodySeg)}`,
      )
    ) {
      return;
    }
    const toForward = (s: number): number =>
      endIndex === 0 ? s : local.lengthMm - s;
    const ends = [toForward(best.sCap), toForward(best.sBody)].sort(
      (x, y) => x - y,
    );
    const arcForward = traceArc(trace.pointsMm);
    this.push({
      a: trace.key,
      b: trace.key,
      layer: trace.layer,
      kind: "self",
      sA: ends[0]!,
      sB: ends[1]!,
      pointMm: pointAtArc(arcForward, ends[0]!),
      inside: [],
      attachS: null,
    });
  }

  /** Two NON-ADJACENT segments of one trace touching (§1, Astra #1). */
  traceSelf(trace: TraceCopperItem): void {
    // Fewer than three segments cannot hold a non-adjacent pair at all.
    if (trace.pointsMm.length < 4) return;
    const arc = traceArc(trace.pointsMm);
    const reach = 2 * trace.halfWidthMm + this.epsMm;
    const covered = new Set<string>();
    this.selfPairs.set(trace.key, covered);
    for (const component of contactComponents(
      segmentPairs(arc, arc, reach, true),
    )) {
      for (const pair of component) covered.add(`${pair.i},${pair.j}`);
      const witness = componentWitness(arc, arc, component);
      this.push({
        a: trace.key,
        b: trace.key,
        layer: trace.layer,
        kind: "self",
        sA: Math.min(witness.sA, witness.sB),
        sB: Math.max(witness.sA, witness.sB),
        pointMm: witness.pointMm,
        inside: [],
        attachS: null,
      });
    }
  }

  finish(): readonly Junction[] {
    this.out.sort(
      (x, y) =>
        (x.a < y.a ? -1 : x.a > y.a ? 1 : 0) ||
        (x.b < y.b ? -1 : x.b > y.b ? 1 : 0) ||
        (x.layer < y.layer ? -1 : x.layer > y.layer ? 1 : 0) ||
        (x.sA ?? -Infinity) - (y.sA ?? -Infinity) ||
        (x.sB ?? -Infinity) - (y.sB ?? -Infinity) ||
        (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0),
    );
    return Object.freeze(this.out.map((j) => Object.freeze(j)));
  }

  private push(junction: Junction): void {
    const id = `${junction.kind}|${junction.a}|${junction.b}|${junction.sA}|${junction.sB}`;
    if (this.emitted.has(id)) return;
    this.emitted.add(id);
    this.out.push(junction);
  }

  private traceTrace(
    a: TraceCopperItem,
    b: TraceCopperItem,
    layer: PcbCopperLayerId,
  ): void {
    const arcA = traceArc(a.pointsMm);
    const arcB = traceArc(b.pointsMm);
    const reach = a.halfWidthMm + b.halfWidthMm + this.epsMm;
    for (const component of contactComponents(
      segmentPairs(arcA, arcB, reach, false),
    )) {
      const witness = componentWitness(arcA, arcB, component);
      this.push({
        a: a.key,
        b: b.key,
        layer,
        kind: "point",
        sA: witness.sA,
        sB: witness.sB,
        pointMm: witness.pointMm,
        inside: [],
        attachS: null,
      });
    }
  }

  private terminal(
    keyA: string,
    keyB: string,
    trace: TraceCopperItem,
    term: PadCopperItem | ViaCopperItem,
    layer: PcbCopperLayerId,
  ): void {
    const shape = terminalShape(term);
    const core = shape.core.length > 0 ? shape.core : [term.center];
    const target = convexTarget(core);
    const arc = traceArc(trace.pointsMm);
    const traceIsA = keyA === trace.key;
    if (!target) return;
    // Every DISCONNECTED stretch of contact is its own component and gets its
    // own record. A trace that runs past the same via twice touches it twice;
    // resolving the pair once — or once per pair with any INSIDE span at all —
    // attached the first contact and dropped the rest, which silently turned a
    // closed loop through the via into one long open chain.
    const touch = centrelineSpans(
      arc,
      target,
      shape.radiusMm + trace.halfWidthMm + this.epsMm,
    );
    const inside = centrelineSpans(arc, target, shape.radiusMm);
    // The S1 predicate IS the TOUCH condition, so an empty set here is the ulp
    // window at the boundary, not a missing contact: fall back to the whole
    // centreline and let the attach point be its closest approach.
    const components: JunctionInterval[] =
      touch.length > 0 ? touch : [{ s0: 0, s1: arc.lengthMm }];
    for (const span of components) {
      const enclosed = inside.filter(
        (iv) => iv.s0 >= span.s0 && iv.s1 <= span.s1,
      );
      const attachS =
        enclosed.length > 0 ? null : attachParameter(arc, core, span);
      const sTrace = enclosed.length > 0 ? enclosed[0]!.s0 : attachS!;
      this.push({
        a: keyA,
        b: keyB,
        layer,
        kind: "terminal",
        sA: traceIsA ? sTrace : null,
        sB: traceIsA ? null : sTrace,
        pointMm: pointAtArc(arc, sTrace),
        inside: enclosed,
        attachS,
      });
    }
  }

  private plain(
    a: PadCopperItem | ViaCopperItem,
    b: PadCopperItem | ViaCopperItem,
    layer: PcbCopperLayerId,
  ): void {
    // Neither side is a trace, so the contact carries no arc-length parameter:
    // it is a zero-weight edge between two nodes and its location is reported,
    // never measured.
    this.push({
      a: a.key,
      b: b.key,
      layer,
      kind: "terminal",
      sA: null,
      sB: null,
      pointMm: {
        x: (a.center.x + b.center.x) / 2,
        y: (a.center.y + b.center.y) / 2,
      },
      inside: [],
      attachS: null,
    });
  }
}
