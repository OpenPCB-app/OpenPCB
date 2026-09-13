/**
 * Where the S1 model's contacts ARE, and what a net's routed copper path is
 * (SI contract 14 §1, §2.7). Components answer "is this copper joined"; a
 * routed length needs the LOCATION of every join, so `computeConnectivity`
 * emits junctions on request and `net-path.ts` walks them.
 */
import type { PcbCopperLayerId, PcbPointMm } from "../../sdks/designer";
import type { CopperPadAnchor } from "./copper-records";

/** A closed arc-length span (mm) along one trace's centreline. */
export interface JunctionInterval {
  readonly s0: number;
  readonly s1: number;
}

/**
 * ONE contact component between two copper items on one layer (contract §1).
 *
 * `a` / `b` are item keys in canonical (lexicographic) order, so every
 * unordered pair is witnessed exactly once. `sA` / `sB` are arc-length
 * positions along that side's centreline and are null whenever the side is not
 * a trace — a pad or via contributes a node, not a parameter.
 *
 * - `point` — two traces. The centrelines' contact, exact where they cross.
 * - `self`  — one trace against itself: an end cap on its own body, or two
 *   NON-ADJACENT segments touching. `a === b`.
 * - `terminal` — a contact with a pad or a via (§2.2). When one side is a
 *   trace, `inside` carries the merged spans of that trace's centreline lying
 *   INSIDE the terminal's copper (clipped out of the path, both boundaries
 *   attached) and `attachS` the single TOUCH-only attach parameter used when
 *   `inside` is empty. A pad–pad / pad–via / via–via contact carries neither.
 *
 * Pour islands are never junctions: they are not edges of the path model
 * (§2.6), and `net-path.ts` reads their membership from the items instead.
 */
export interface Junction {
  readonly a: string;
  readonly b: string;
  readonly layer: PcbCopperLayerId;
  readonly kind: "point" | "self" | "terminal";
  readonly sA: number | null;
  readonly sB: number | null;
  /** Canonical location: a point on `a`'s copper (world mm). */
  readonly pointMm: PcbPointMm;
  readonly inside: readonly JunctionInterval[];
  readonly attachS: number | null;
}

/** A terminal of a net path: a LOGICAL pin, never one copper shape (§2.1). */
export type PinRef = CopperPadAnchor;

/** One retained copper edge of the measured subtree, in walk order. */
export interface PathSegment {
  readonly layer: PcbCopperLayerId;
  /** The centreline between `s0` and `s1`, endpoints included. */
  readonly pointsMm: readonly PcbPointMm[];
  /** Arc-length span on the trace this edge came from. */
  readonly s0: number;
  readonly s1: number;
  /**
   * Item key of the trace this edge is part of, and THAT trace's half width.
   *
   * Both are carried rather than recovered: a consumer matching a segment back
   * to a trace by its endpoints picks the wrong record wherever two traces
   * meet, and a pruned narrow branch then lends its width to a retained wide
   * segment — which is how a real diff-pair gap verdict went silent.
   */
  readonly traceKey: string;
  readonly halfWidthMm: number;
}

/**
 * Why a net has no single routed length (§2.7). `unresolved` is the honest
 * answer for copper S1 calls connected that the path model could not locate a
 * route through — reported, never passed silently.
 */
export type NetPathUndefinedReason =
  | "open"
  | "terminals"
  | "loop"
  | "pour"
  | "via"
  | "unresolved";

export type NetPath =
  | {
      readonly kind: "defined";
      /** `copperLengthMm + viaLengthMm`. */
      readonly lengthMm: number;
      readonly copperLengthMm: number;
      readonly viaLengthMm: number;
      readonly viaCount: number;
      readonly terminals: readonly PinRef[];
      readonly topology: "chain" | "tree";
      /** Copper of the net's component that the subtree does not span. */
      readonly branchLengthMm: number;
      readonly segments: readonly PathSegment[];
    }
  | { readonly kind: "undefined"; readonly reason: NetPathUndefinedReason };
