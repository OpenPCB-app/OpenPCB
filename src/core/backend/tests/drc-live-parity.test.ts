/**
 * S8 — the live-parity contract itself (docs/pcb-hardening/07-live-parity-contract.md
 * §1, §5, §6, §10), on top of WP3's hand-built pair-kind unit tests
 * (drc-legality.test.ts), which this file does not repeat.
 *
 * 1. Leave-one-out over the six goldens — the STABILITY clause (§1 clause 2):
 *    removing and re-attributing one item at a time never perturbs anything
 *    else the live code set reports.
 * 2. Hand-built boundary fixtures for the pair kinds / codes WP3 does not
 *    already cover — the ATTRIBUTION clause (§1 clause 1).
 * 3. The obstacle superset property (§5): a path that avoids every rect
 *    clears the gate on that layer.
 * 4. Server ↔ live parity through the real command-dispatch runtime (§6).
 * 5. The two B5 `test.todo` flips (drc-audit-b5.test.ts) — done in that file.
 * 6. E2E — tests/e2e/pcb-live-parity.spec.ts.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import * as path from "node:path";
import os from "node:os";

import { buildDrcItems } from "../../../shared/drc/drc-context";
import { runDrc } from "../../../shared/drc/drc-engine";
import {
  checkPendingCopper,
  refusedViolations,
  LIVE_CODES,
  REFUSE_CODES,
  type PendingCopper,
} from "../../../shared/drc/legality";
import { anchorKey } from "../../../shared/drc/violation-id";
import { copperToHoleClearanceMm } from "../../../shared/drc/rule-resolver";
import { buildRouteObstacles } from "../../../shared/pcb-routing/route-obstacles";
import { pathIntersectsAny } from "../../../shared/pcb-routing/collision";
import { aabbGap } from "../../../shared/drc/drc-context";
import type { ObstacleRectNm, PointNm } from "../../../shared/pcb-routing/types";
import type {
  DesignerPcbProjection,
  DesignerSDK,
  DrcAnchor,
  DrcRuleCode,
  DrcViolation,
  PcbFreeHole,
  PcbTrace,
  PcbVia,
} from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { fixtureToProjection } from "./helpers/drc-golden";
import {
  board,
  boardWithRules,
  freeHole,
  pad,
  placement,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";
import { keepoutRow } from "./helpers/pcb-zone-fixtures";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

const MM = 1_000_000;

/**
 * The live code set `L` (07 §3) must be exactly REFUSE_CODES plus the codes
 * this list names as warnings — written as a literal so a drift in either
 * direction (a code silently added to or dropped from either set) fails here
 * rather than only wherever `LIVE_CODES` happens to be consumed.
 */
const EXPECTED_WARNING_CODES = new Set<DrcRuleCode>([
  "FAB_CLEARANCE",
  "HOLE_TO_HOLE",
  "FAB_HOLE_TO_HOLE",
  "HOLE_TO_BOARD_EDGE",
  "VIA_DIAMETER_MIN",
  "VIA_DRILL_MIN",
  "DRILL_SIZE_MIN",
  "ANNULAR_RING_MIN",
  "VIA_ASPECT_RATIO",
  "FAB_TRACE_WIDTH",
  "FAB_DRILL",
  "FAB_ANNULAR_RING",
  "FAB_PAD",
  "NETCLASS_TRACE_WIDTH",
  "NETCLASS_VIA_DIAMETER",
  "NETCLASS_VIA_DRILL",
  "PAD_LAYER_MISMATCH",
]);

test("LIVE_CODES is exactly REFUSE_CODES plus the expected warning codes (07 §3)", () => {
  const expected = new Set<DrcRuleCode>([...REFUSE_CODES, ...EXPECTED_WARNING_CODES]);
  expect(new Set(LIVE_CODES)).toEqual(expected);
});

type Shape = Pick<
  DrcViolation,
  "id" | "code" | "layer" | "severity" | "measuredMm" | "requiredMm" | "message"
>;
type ShapeNoId = Omit<Shape, "id">;

function shape(v: DrcViolation): Shape {
  return {
    id: v.id,
    code: v.code,
    layer: v.layer,
    severity: v.severity,
    measuredMm: v.measuredMm,
    requiredMm: v.requiredMm,
    message: v.message,
  };
}
function shapeNoId(v: DrcViolation): ShapeNoId {
  const { id: _id, ...rest } = shape(v);
  return rest;
}

function multisetEqual<T>(a: T[], b: T[]): boolean {
  const as = a.map((x) => JSON.stringify(x)).sort();
  const bs = b.map((x) => JSON.stringify(x)).sort();
  if (as.length !== bs.length) return false;
  return as.every((v, i) => v === bs[i]);
}

/**
 * The net id an anchor's item carries in `p`, or `undefined` when the item
 * cannot be found (should not happen for an anchor drawn from `p` itself).
 * `pad` reads `padNets`: an ABSENT entry is unassigned (null), matching
 * `assemblePcbLegalityInput`'s own binding.
 */
function anchorNetId(
  p: DesignerPcbProjection,
  a: DrcAnchor,
): string | null | undefined {
  switch (a.kind) {
    case "trace":
      return p.traces.find((t) => t.id === a.traceId)?.netId;
    case "via":
      return p.vias.find((v) => v.id === a.viaId)?.netId;
    case "pad": {
      const key = `${a.placementId}|${a.padNumber}`;
      const nets = p.padNets ?? {};
      return key in nets ? nets[key]! : null;
    }
    case "freePad":
      return p.freePads.find((fp) => fp.id === a.freePadId)?.netId;
    default:
      return undefined;
  }
}

/**
 * A bridge violation's own (null-net) anchor and its bridged net set.
 *
 * `contract 07 §1 replaced(T)` scopes the exception to a NULL-net anchor —
 * an ordinary two-NAMED-net short also carries `{kind:"net"}` anchors (one
 * per side, `checks/clearance-judge.ts` `emit()`), so "has a net anchor" alone
 * is not sufficient: a bridge draft carries exactly ONE non-net anchor (the
 * null-net item; `bridgeDraft`), while an ordinary short carries TWO (one per
 * side). Both signals — exactly one non-net anchor, AND that anchor's own
 * item resolving to `netId === null` in `p` — must hold, or an ordinary short
 * that vanishes between R⁺/R⁻ would be wrongly excused from clause 2.
 */
function bridgeInfo(
  v: DrcViolation,
  p: DesignerPcbProjection,
): { ownKey: string; nets: Set<string> } | null {
  if (v.code !== "NET_SHORT_CIRCUIT") return null;
  const netAnchors = v.anchors.filter(
    (a): a is Extract<DrcAnchor, { kind: "net" }> => a.kind === "net",
  );
  if (netAnchors.length === 0) return null;
  const nonNet = v.anchors.filter((a) => a.kind !== "net");
  if (nonNet.length !== 1) return null;
  const own = nonNet[0]!;
  if (anchorNetId(p, own) !== null) return null;
  return {
    ownKey: anchorKey(own),
    nets: new Set(netAnchors.map((a) => a.netId)),
  };
}

/**
 * `bridgeInfo` keyed by the null-net anchor. Asserts no two DIFFERENT items
 * hash to the same key — `finalizeReport` already dedupes to one draft per
 * null-net anchor, so a collision here would mean an `anchorKey` clash
 * between two distinct items, not a legitimate re-observation.
 */
function bridgeMap(
  vs: readonly DrcViolation[],
  p: DesignerPcbProjection,
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const v of vs) {
    const info = bridgeInfo(v, p);
    if (!info) continue;
    const existing = m.get(info.ownKey);
    if (existing) {
      expect(
        setEq(existing, info.nets),
        `bridgeMap: anchor key "${info.ownKey}" produced two different net sets — a real anchorKey collision`,
      ).toBe(true);
    }
    m.set(info.ownKey, info.nets);
  }
  return m;
}

function setEq(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function namesItem(
  v: DrcViolation,
  itemId: string,
  kind: "trace" | "via",
): boolean {
  return v.anchors.some(
    (a) =>
      (kind === "trace" && a.kind === "trace" && a.traceId === itemId) ||
      (kind === "via" && a.kind === "via" && a.viaId === itemId),
  );
}

// =============================================================================
// 1. Leave-one-out over the six goldens (stability, contract §1 clause 2)
// =============================================================================

describe("leave-one-out stability over the golden corpus (07 §1 clause 2)", () => {
  const GOLDEN_DIR = path.resolve(
    import.meta.dir,
    "fixtures/drc/golden",
  );
  const goldens = readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".expected.json"))
    .sort();

  /** Is `v`'s null-net anchor a footprint PAD (the multi-shape-pin case)? */
  function isNullNetPadBridge(v: DrcViolation, p: DesignerPcbProjection): boolean {
    if (!bridgeInfo(v, p)) return false;
    const own = v.anchors.find((a) => a.kind !== "net");
    return own?.kind === "pad";
  }

  /**
   * Multiset equality with the ONE declared leniency (07 §1): a mismatched
   * pair is allowed through ONLY when both sides are `NET_SHORT_CIRCUIT` on a
   * null-net PAD anchor (a multi-shape pin) and agree once `id` (the
   * location-hashed marker bucket) is dropped. Anything else — a different
   * code, a non-pad anchor, an ordinary two-named-net short — must match
   * exactly or the comparison fails.
   */
  function compareViolationSets(
    left: readonly DrcViolation[],
    leftP: DesignerPcbProjection,
    right: readonly DrcViolation[],
    rightP: DesignerPcbProjection,
  ): { ok: boolean; leniencyUsed: number; diagnostic: string } {
    const pool = [...right];
    let leniencyUsed = 0;
    for (const lv of left) {
      const exact = pool.findIndex(
        (rv) => JSON.stringify(shape(rv)) === JSON.stringify(shape(lv)),
      );
      if (exact !== -1) {
        pool.splice(exact, 1);
        continue;
      }
      if (isNullNetPadBridge(lv, leftP)) {
        const lenient = pool.findIndex(
          (rv) =>
            isNullNetPadBridge(rv, rightP) &&
            JSON.stringify(shapeNoId(rv)) === JSON.stringify(shapeNoId(lv)),
        );
        if (lenient !== -1) {
          pool.splice(lenient, 1);
          leniencyUsed += 1;
          continue;
        }
      }
      return {
        ok: false,
        leniencyUsed,
        diagnostic: `unmatched: ${JSON.stringify(shape(lv))}`,
      };
    }
    if (pool.length !== 0) {
      return {
        ok: false,
        leniencyUsed,
        diagnostic: `extra on the right: ${JSON.stringify(pool.map(shape))}`,
      };
    }
    return { ok: true, leniencyUsed, diagnostic: "" };
  }

  interface LeaveOneOutStats {
    itemsJudged: number;
    violationsCompared: number;
    leniencyUsed: number;
    replacedExcused: number;
  }

  function runLeaveOneOut(name: string, P: DesignerPcbProjection): LeaveOneOutStats {
    const stats: LeaveOneOutStats = {
      itemsJudged: 0,
      violationsCompared: 0,
      leniencyUsed: 0,
      replacedExcused: 0,
    };
    const Rplus = runDrc(P).violations;
    const plusBridges = bridgeMap(Rplus, P);

    const items: Array<{ kind: "trace" | "via"; id: string }> = [
      ...P.traces.map((t) => ({ kind: "trace" as const, id: t.id })),
      ...P.vias.map((v) => ({ kind: "via" as const, id: v.id })),
    ];

    for (const item of items) {
      stats.itemsJudged += 1;
      const Pminus: DesignerPcbProjection = {
        ...P,
        traces:
          item.kind === "trace"
            ? P.traces.filter((t) => t.id !== item.id)
            : P.traces,
        vias:
          item.kind === "via"
            ? P.vias.filter((v) => v.id !== item.id)
            : P.vias,
      };
      const ctxMinus = buildDrcItems(Pminus);
      const Rminus = runDrc(Pminus).violations;
      const minusBridges = bridgeMap(Rminus, Pminus);

      const pending: PendingCopper =
        item.kind === "trace"
          ? { traces: [P.traces.find((t) => t.id === item.id)!], vias: [] }
          : { traces: [], vias: [P.vias.find((v) => v.id === item.id)!] };
      const live = checkPendingCopper(ctxMinus, pending);

      // The only difference between P and P' is `item` itself, so ANY change
      // in a bridge's existence or net set between the two sides is
      // attributable to it — including a bridge that VANISHES entirely in R⁻
      // (its touched-net count drops below 2, so no draft is emitted at
      // all), which is why an absent entry defaults to the empty set rather
      // than "not touched".
      const touchesPlus = (v: DrcViolation): boolean => {
        if (namesItem(v, item.id, item.kind)) return true;
        const info = bridgeInfo(v, P);
        if (!info) return false;
        const prior = minusBridges.get(info.ownKey) ?? new Set<string>();
        return !setEq(prior, info.nets);
      };
      const replacedInMinus = (v: DrcViolation): boolean => {
        const info = bridgeInfo(v, Pminus);
        if (!info) return false;
        const after = plusBridges.get(info.ownKey) ?? new Set<string>();
        return !setEq(after, info.nets);
      };

      // --- clause 1: attribution -------------------------------------
      const attributed = Rplus.filter((v) => LIVE_CODES.has(v.code) && touchesPlus(v));
      stats.violationsCompared += live.length;
      const attrCmp = compareViolationSets(live, Pminus, attributed, P);
      expect(
        attrCmp.ok,
        `${name} / ${item.kind} ${item.id}: attribution mismatch — ${attrCmp.diagnostic}`,
      ).toBe(true);
      stats.leniencyUsed += attrCmp.leniencyUsed;

      // --- clause 2: non-perturbation ---------------------------------
      const plusOthers = Rplus.filter((v) => LIVE_CODES.has(v.code) && !touchesPlus(v));
      const minusOthers = Rminus.filter((v) => LIVE_CODES.has(v.code) && !replacedInMinus(v));
      const replacedCount = Rminus.filter(
        (v) => LIVE_CODES.has(v.code) && replacedInMinus(v),
      ).length;
      stats.replacedExcused += replacedCount;
      stats.violationsCompared += plusOthers.length;
      const nonPertCmp = compareViolationSets(plusOthers, P, minusOthers, Pminus);
      expect(
        nonPertCmp.ok,
        `${name} / ${item.kind} ${item.id}: non-perturbation mismatch — ${nonPertCmp.diagnostic}`,
      ).toBe(true);
      stats.leniencyUsed += nonPertCmp.leniencyUsed;
    }

    return stats;
  }

  test(
    "every trace and via of every golden is attributed, and nothing else moves",
    async () => {
      const totals: LeaveOneOutStats = {
        itemsJudged: 0,
        violationsCompared: 0,
        leniencyUsed: 0,
        replacedExcused: 0,
      };
      for (const file of goldens) {
        const fixture = JSON.parse(await Bun.file(path.join(GOLDEN_DIR, file)).text());
        const P: DesignerPcbProjection = fixtureToProjection(fixture);
        const s = runLeaveOneOut(file, P);
        totals.itemsJudged += s.itemsJudged;
        totals.violationsCompared += s.violationsCompared;
        totals.leniencyUsed += s.leniencyUsed;
        totals.replacedExcused += s.replacedExcused;
      }

      console.info(
        `[drc-live-parity leave-one-out] goldens=${goldens.length} itemsJudged=${totals.itemsJudged} violationsCompared=${totals.violationsCompared} idBucketLeniencyUsed=${totals.leniencyUsed} replacedExcused=${totals.replacedExcused}`,
      );
      expect(totals.itemsJudged).toBeGreaterThanOrEqual(40);
      expect(totals.violationsCompared).toBeGreaterThanOrEqual(30);
      // The real goldens have no multi-shape pin whose marker moves under a
      // leave-one-out probe — the leniency fallback exists for the hand-built
      // boards below, not this corpus.
      expect(totals.leniencyUsed).toBe(0);
    },
    60_000,
  );

  test("hand-built: a null-net bridge's net set growing is the `replaced(T)` exception", () => {
    // N (null-net) touches A, B and C. Leaving C out of the corpus makes R⁻'s
    // bridge {A, B} and R⁺'s {A, B, C} — the bridge is REPLACED, not
    // perturbed (07 §1 clause 2 `replaced(T)`).
    const p = projection({
      board: board(),
      netNames: { a: "A", b: "B", c: "C" },
      traces: [
        trace("bridgeN", null, [[0, 0], [10, 0]]),
        trace("ta", "a", [[0, 0], [0, -3]]),
        trace("tb", "b", [[5, 0], [5, -3]]),
        trace("tc", "c", [[10, 0], [10, -3]]),
      ],
    });
    const s = runLeaveOneOut("replaced(T)-fixture", p);
    console.info(
      `[drc-live-parity leave-one-out] replaced(T)-fixture: itemsJudged=${s.itemsJudged} replacedExcused=${s.replacedExcused} leniencyUsed=${s.leniencyUsed}`,
    );
    expect(s.replacedExcused).toBeGreaterThanOrEqual(1);
  });

  test("hand-built: a multi-shape pin's bridge marker moving is the id-bucket exception", () => {
    // A pin with two shapes of pad number "1" — shapeA at x=−5 (sorts
    // EARLIER), shapeB at x=5. t_b1/t_b2 (always present) touch shapeB on
    // nets b1/b2; T (the leave-one-out item, ALSO net b1 — a duplicate, so
    // the bridge's net set {b1, b2} never changes) touches shapeA. With T
    // present the marker is T's (x=−5, smallest); without T it falls back to
    // whichever of t_b1/t_b2 sorts first on shapeB — same code, same anchor,
    // same net set, different location bucket: the declared marker exception.
    const p = projection({
      board: board(),
      netNames: { b1: "B1", b2: "B2" },
      placements: [
        placement("U1", {
          pads: [
            pad("1", { x: -5, y: 0 }, 1, 1),
            pad("1", { x: 5, y: 0 }, 1, 1),
          ],
        }),
      ],
      traces: [
        trace("t_b1", "b1", [[5, 0], [5, -3]]),
        trace("t_b2", "b2", [[4.6, 0], [4.6, -3]]),
        trace("T", "b1", [[-5, 0], [-5, -3]]),
      ],
    });
    const s = runLeaveOneOut("marker-move-fixture", p);
    console.info(
      `[drc-live-parity leave-one-out] marker-move-fixture: itemsJudged=${s.itemsJudged} leniencyUsed=${s.leniencyUsed}`,
    );
    expect(s.leniencyUsed).toBe(1);
  });
});

// =============================================================================
// 2. Attribution on hand-built fixtures (contract §1 clause 1) — the pair
//    kinds / codes NOT already covered by drc-legality.test.ts (WP3).
// =============================================================================

const NETS = { a: "NET_A", b: "NET_B" };

function expectParity(
  p: DesignerPcbProjection,
  t: PendingCopper,
  replaces: string[] = [],
): DrcViolation[] {
  const live = checkPendingCopper(buildDrcItems(p), t, { replaces });
  const committed: DesignerPcbProjection = {
    ...p,
    traces: [...p.traces.filter((x) => !replaces.includes(x.id)), ...t.traces],
    vias: [...p.vias.filter((x) => !replaces.includes(x.id)), ...t.vias],
  };
  const traceIds = new Set(t.traces.map((x) => x.id));
  const viaIds = new Set(t.vias.map((x) => x.id));
  const batch = runDrc(committed).violations.filter(
    (v) =>
      LIVE_CODES.has(v.code) &&
      v.anchors.some(
        (a) =>
          (a.kind === "trace" && traceIds.has(a.traceId)) ||
          (a.kind === "via" && viaIds.has(a.viaId)),
      ),
  );
  expect(live.map(shape)).toEqual(batch.map(shape));
  return live;
}
function codesOf(vs: readonly DrcViolation[]): DrcRuleCode[] {
  return vs.map((v) => v.code);
}

describe("FAB_CLEARANCE on a jlcpcb board", () => {
  // Rule clearance below the fab minimum (0.1 mm), so the rule tier passes
  // and only the fab warning tier fires.
  const p = projection({
    board: boardWithRules({
      fabricator: "jlcpcb_2l",
      clearance: { traceToTraceMm: 0.05 },
      netClasses: [
        {
          id: "default",
          name: "default",
          traceWidthMm: 0.2,
          clearanceMm: 0.05,
          viaDiameterMm: 0.8,
          viaDrillMm: 0.4,
          color: "#000",
          defaultViaProtection: "tented",
        },
      ],
    }),
    netNames: NETS,
    traces: [trace("bt", "a", [[0, 0], [10, 0]])],
  });
  // Trace copper is 0.2 mm wide (half 0.1); rule-required gap is 0.05, the
  // fab minimum is 0.1.
  const pending = (y: number): PendingCopper => ({
    traces: [trace("p1", "b", [[0, y], [10, y]])],
    vias: [],
  });

  test("0.07 mm gap clears the 0.05 mm rule but is below the fab minimum", () => {
    const live = expectParity(p, pending(0.27));
    expect(codesOf(live)).toEqual(["FAB_CLEARANCE"]);
  });

  test("0.10 mm clears the fab minimum too", () => {
    const live = expectParity(p, pending(0.3));
    expect(codesOf(live)).not.toContain("FAB_CLEARANCE");
  });
});

describe("COPPER_TO_HOLE — slotted NPTH", () => {
  const slot: PcbFreeHole = {
    id: "h1",
    centerMm: { x: 0, y: 0 },
    drillMm: 1.0,
    drillSlot: { lengthMm: 2, widthMm: 1, angleDeg: 0 },
    lockedAt: null,
  };
  const p = projection({ board: board(), netNames: NETS, freeHoles: [slot] });
  const over = (y: number): PendingCopper => ({
    traces: [trace("p1", "b", [[-5, y], [5, y]])],
    vias: [],
  });

  test("copper too close to the slot's long axis violates", () => {
    const live = expectParity(p, over(0.9));
    expect(codesOf(live)).toContain("COPPER_TO_HOLE");
  });

  test("far from the slot clears", () => {
    const live = expectParity(p, over(2.0));
    expect(codesOf(live)).not.toContain("COPPER_TO_HOLE");
  });
});

describe("HOLE_OFF_BOARD for a pending via", () => {
  const p = projection({ board: board(), netNames: NETS });

  test("a via placed past the outline is off-board", () => {
    const live = expectParity(p, {
      traces: [],
      vias: [via("pv", { netId: "b", center: { x: 24.9, y: 0 } })],
    });
    expect(codesOf(live)).toContain("HOLE_OFF_BOARD");
  });

  test("a via well inside the board is not", () => {
    const live = expectParity(p, {
      traces: [],
      vias: [via("pv", { netId: "b", center: { x: 5, y: 0 } })],
    });
    expect(codesOf(live)).not.toContain("HOLE_OFF_BOARD");
  });
});

describe("KEEPOUT_VIOLATION — vias restriction", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 8, y: 0 },
    { x: 8, y: 8 },
    { x: 0, y: 8 },
  ];
  const p = projection({
    board: board(),
    netNames: NETS,
    keepouts: [
      keepoutRow("k1", ["F.Cu"], square, {
        tracks: false,
        vias: true,
        pads: false,
        copperPour: false,
        footprints: false,
      }),
    ],
  });

  test("a via dropped inside a vias keepout is reported", () => {
    const live = expectParity(p, {
      traces: [],
      vias: [via("pv", { netId: "b", center: { x: 4, y: 4 } })],
    });
    expect(codesOf(live)).toContain("KEEPOUT_VIOLATION");
  });

  test("a via outside it is not", () => {
    const live = expectParity(p, {
      traces: [],
      vias: [via("pv", { netId: "b", center: { x: -4, y: 4 } })],
    });
    expect(codesOf(live)).not.toContain("KEEPOUT_VIOLATION");
  });
});

describe("VIA_LAYER_SPAN on a pending via", () => {
  const p = projection({ board: board(), netNames: NETS });

  test("a blind-through span on a 2-layer board is flagged", () => {
    const live = expectParity(p, {
      traces: [],
      vias: [
        via("pv", {
          netId: "a",
          center: { x: 0, y: 0 },
          fromLayer: "In1.Cu",
          toLayer: "In2.Cu",
        }),
      ],
    });
    expect(codesOf(live)).toContain("VIA_LAYER_SPAN");
  });

  test("F.Cu → B.Cu is valid on the same board", () => {
    const live = expectParity(p, {
      traces: [],
      vias: [via("pv", { netId: "a", center: { x: 0, y: 0 } })],
    });
    expect(codesOf(live)).not.toContain("VIA_LAYER_SPAN");
  });
});

describe("TRACE_LAYER_MISMATCH on a pending trace", () => {
  const p = projection({ board: board(), netNames: NETS });

  test("In1.Cu is not routable on a 2-layer board", () => {
    const live = expectParity(p, {
      traces: [trace("p1", "a", [[0, 0], [10, 0]], { layer: "In1.Cu" })],
      vias: [],
    });
    expect(codesOf(live)).toContain("TRACE_LAYER_MISMATCH");
  });

  test("F.Cu is fine", () => {
    const live = expectParity(p, {
      traces: [trace("p1", "a", [[0, 0], [10, 0]])],
      vias: [],
    });
    expect(codesOf(live)).not.toContain("TRACE_LAYER_MISMATCH");
  });
});

describe("NETCLASS_TRACE_WIDTH on a pending trace", () => {
  const p = projection({
    board: boardWithRules({
      netClasses: [
        {
          id: "default",
          name: "default",
          traceWidthMm: 0.2,
          clearanceMm: 0.2,
          viaDiameterMm: 0.8,
          viaDrillMm: 0.4,
          color: "#000",
          defaultViaProtection: "tented",
        },
        {
          id: "wide",
          name: "wide",
          traceWidthMm: 0.5,
          clearanceMm: 0.2,
          viaDiameterMm: 0.8,
          viaDrillMm: 0.4,
          color: "#000",
          defaultViaProtection: "tented",
        },
      ],
      perNetClassAssignments: { a: "wide" },
    }),
    netNames: NETS,
  });

  test("a narrower trace on an explicitly-classed net is flagged", () => {
    const live = expectParity(p, {
      traces: [
        trace("p1", "a", [[0, 0], [10, 0]], {
          widthMm: 0.2,
          netClassId: "wide",
        }),
      ],
      vias: [],
    });
    expect(codesOf(live)).toContain("NETCLASS_TRACE_WIDTH");
  });

  test("meeting the class width clears", () => {
    const live = expectParity(p, {
      traces: [
        trace("p1", "a", [[0, 0], [10, 0]], {
          widthMm: 0.5,
          netClassId: "wide",
        }),
      ],
      vias: [],
    });
    expect(codesOf(live)).not.toContain("NETCLASS_TRACE_WIDTH");
  });
});

describe("replaces — a truncated/re-routed geometry is judged fresh (Astra run 1 #2)", () => {
  test("a straight replacement that now crosses a foreign via is caught", () => {
    // t1 originally dodges AROUND the via at (5, 0) with a detour; the tune
    // replaces it with a straight 2-point line that runs straight through the
    // via's clearance halo — a vertex subsequence would miss this because the
    // new SEGMENT (not a subset of the old ones) is what collides (07 §6).
    const p = projection({
      board: board(),
      netNames: NETS,
      traces: [
        trace("t1", "a", [
          [0, 0],
          [0, 3],
          [10, 3],
          [10, 0],
        ]),
      ],
      // Offset off the straight line: default via (0.8 mm dia, r=0.4) bottom
      // edge at y=0.55−0.4=0.15; the 0.2 mm-wide replacement's top edge at
      // y=0.1 — a 0.05 mm gap, short of the 0.25 mm default clearance but
      // NOT overlapping (a real clearance breach, not a short).
      vias: [via("v1", { netId: "b", center: { x: 5, y: 0.55 } })],
    });
    const live = expectParity(
      p,
      { traces: [trace("t1", "a", [[0, 0], [10, 0]])], vias: [] },
      ["t1"],
    );
    expect(codesOf(live)).toContain("TRACE_TO_VIA_CLEARANCE");
  });
});

describe("area-scoped relaxation — two-hotspot geometry (live-drc.test.ts)", () => {
  // Mirrors live-drc.test.ts's "ONE segment pair with a second hotspot
  // outside the area is refused": the closest approach is constant along the
  // overlap and the naive single-resolution witness sits INSIDE the relaxing
  // area, so splitting both sides at the area ring is what exposes the
  // outside half.
  const areaRule = {
    id: "area-relax",
    name: "Area relax",
    enabled: true,
    priority: 10,
    scopes: [
      {
        kind: "area" as const,
        polygonMm: [
          { x: 0, y: -1 },
          { x: 5, y: -1 },
          { x: 5, y: 1 },
          { x: 0, y: 1 },
        ],
      },
    ],
    constraint: { kind: "clearance" as const, mm: 0.05 },
  };
  const p = projection({
    board: boardWithRules({ drcRules: [areaRule] }),
    netNames: NETS,
    traces: [trace("bt", "a", [[3, 0.3], [8, 0.3]])],
  });

  test("the outside-area hotspot still refuses at the class tier", () => {
    const live = expectParity(p, {
      traces: [trace("p1", "b", [[0, 0], [10, 0]])],
      vias: [],
    });
    const hit = live.find((v) => v.code === "TRACE_TO_TRACE_CLEARANCE");
    expect(hit).toBeDefined();
    expect(hit!.requiredMm).toBeGreaterThan(0.05);
  });
});

describe("clean boundary twins (equal passes — clearanceViolated semantics)", () => {
  test("COPPER_TO_HOLE: copper exactly at the required clearance clears", () => {
    const p = projection({
      board: board(),
      netNames: NETS,
      freeHoles: [freeHole("h1", { x: 0, y: 0 }, 1.0)],
    });
    const ctx = buildDrcItems(p);
    const requiredMm = copperToHoleClearanceMm(ctx.designRules);
    // hole radius 0.5, trace half-width 0.1: gap = y - 0.5 - 0.1.
    const y = requiredMm + 0.6;
    const live = expectParity(p, {
      traces: [trace("p1", "b", [[-5, y], [5, y]])],
      vias: [],
    });
    expect(codesOf(live)).not.toContain("COPPER_TO_HOLE");
  });

  test("HOLE_OFF_BOARD: a via's drill edge exactly on the board edge is inside, not off", () => {
    const p = projection({ board: board(), netNames: NETS });
    const ctx = buildDrcItems(p);
    // board() is 50×30 mm centred at (0,0): the right edge is at x=25. A via's
    // off-board hole radius is its DRILL (0.4 mm default → drillMm 0.4 ⇒
    // radius 0.2), so its edge sits exactly on the board edge at x = 25 − 0.2.
    const outline = ctx.board.outline;
    const edgeX = outline.centerMm.x + outline.widthMm / 2;
    const drillRadiusMm = 0.2;
    const live = expectParity(p, {
      traces: [],
      vias: [via("pv", { netId: "b", center: { x: edgeX - drillRadiusMm, y: 0 } })],
    });
    expect(codesOf(live)).not.toContain("HOLE_OFF_BOARD");
  });

  test("KEEPOUT_VIOLATION: a via's edge exactly touching the boundary is outside, not inside", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
      { x: 0, y: 8 },
    ];
    const p = projection({
      board: board(),
      netNames: NETS,
      keepouts: [
        keepoutRow("k1", ["F.Cu"], square, {
          tracks: false,
          vias: true,
          pads: false,
          copperPour: false,
          footprints: false,
        }),
      ],
    });
    // Default via: diameterMm 0.8 ⇒ radius 0.4; centre at x=-0.4 puts its
    // copper edge exactly on the keepout's x=0 boundary.
    const live = expectParity(p, {
      traces: [],
      vias: [via("pv", { netId: "b", center: { x: -0.4, y: 4 } })],
    });
    expect(codesOf(live)).not.toContain("KEEPOUT_VIOLATION");
  });

  test("FAB_HOLE_TO_HOLE: two vias below the fab floor but above the (relaxed) board rule", () => {
    // jlcpcb_2l's holeToHoleViaMm floor is 0.2 mm; a board rule of 0.05 mm
    // lets a 0.1 mm gap pass the board tier while still tripping the fab one.
    const p = projection({
      board: boardWithRules({
        fabricator: "jlcpcb_2l",
        minimums: { holeToHoleMm: 0.05 },
      }),
      netNames: NETS,
      vias: [via("bv", { netId: "a", center: { x: 0, y: 0 }, drillMm: 0.4 })],
    });
    // Drill radii 0.2 each; gap = x − 0.2 − 0.2 = 0.1 ⇒ x = 0.5.
    const live = expectParity(p, {
      traces: [],
      vias: [via("pv", { netId: "b", center: { x: 0.5, y: 0 }, drillMm: 0.4 })],
    });
    expect(codesOf(live)).toContain("FAB_HOLE_TO_HOLE");
    expect(codesOf(live)).not.toContain("HOLE_TO_HOLE");
  });
});

// =============================================================================
// 3. Obstacle superset property (contract §5)
// =============================================================================

const BLOCKING_CODES: DrcRuleCode[] = [
  "TRACE_TO_TRACE_CLEARANCE",
  "TRACE_TO_PAD_CLEARANCE",
  "TRACE_TO_VIA_CLEARANCE",
  "NET_SHORT_CIRCUIT",
  "COPPER_TO_HOLE",
  "KEEPOUT_VIOLATION",
];

/** A net that exists on no board copper — see the probe-net pass (07 §5). */
const PROBE_NET_ID = "probe-net";

describe("obstacle superset: a path that avoids every rect clears the gate (07 §5)", () => {
  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  /** The board outline's bounding half-extent (mm) — the real sampling window. */
  function outlineHalfExtentMm(
    p: DesignerPcbProjection,
  ): { cx: number; cy: number; halfX: number; halfY: number } {
    const o = p.board.outline;
    return {
      cx: o.centerMm.x,
      cy: o.centerMm.y,
      halfX: o.widthMm / 2,
      halfY: o.heightMm / 2,
    };
  }

  function randomPointMm(
    rnd: () => number,
    win: { cx: number; cy: number; halfX: number; halfY: number },
  ): PointNm {
    return {
      x: Math.round((win.cx + (rnd() * 2 - 1) * win.halfX) * MM),
      y: Math.round((win.cy + (rnd() * 2 - 1) * win.halfY) * MM),
    };
  }

  /** A point on a random rect's boundary, jittered outward by ≤ 2× `clearanceMm`. */
  function pointNearRectBoundary(
    rnd: () => number,
    rect: ObstacleRectNm,
    clearanceMm: number,
  ): PointNm {
    const edge = Math.floor(rnd() * 4);
    const jitterNm = Math.round(rnd() * 2 * clearanceMm * MM);
    let x: number;
    let y: number;
    if (edge === 0 || edge === 1) {
      x = rect.minX + rnd() * (rect.maxX - rect.minX);
      y = edge === 0 ? rect.minY - jitterNm : rect.maxY + jitterNm;
    } else {
      y = rect.minY + rnd() * (rect.maxY - rect.minY);
      x = edge === 2 ? rect.minX - jitterNm : rect.maxX + jitterNm;
    }
    return { x: Math.round(x), y: Math.round(y) };
  }

  /**
   * A path avoiding every rect: half the attempts start ON a random rect's
   * jittered boundary (real proximity, not just "somewhere on the board"),
   * the rest are pure random points in the outline window.
   */
  function randomAvoidingPath(
    rnd: () => number,
    rects: readonly ObstacleRectNm[],
    win: { cx: number; cy: number; halfX: number; halfY: number },
    clearanceMm: number,
    points: 2 | 3,
    biasToward: boolean,
  ): PointNm[] | null {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const path: PointNm[] = [];
      if (biasToward && rects.length > 0) {
        const rect = rects[Math.floor(rnd() * rects.length)]!;
        path.push(pointNearRectBoundary(rnd, rect, clearanceMm));
      } else {
        path.push(randomPointMm(rnd, win));
      }
      for (let i = path.length; i < points; i += 1) {
        path.push(randomPointMm(rnd, win));
      }
      if (!pathIntersectsAny(path, rects)) return path;
    }
    return null;
  }

  function rectBoundsMm(r: ObstacleRectNm) {
    return { minX: r.minX / MM, minY: r.minY / MM, maxX: r.maxX / MM, maxY: r.maxY / MM };
  }
  function pathBoundsMm(pts: readonly PointNm[]) {
    const xs = pts.map((p) => p.x / MM);
    const ys = pts.map((p) => p.y / MM);
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }

  function checkBoard(name: string, p: DesignerPcbProjection): void {
    test(
      `${name}: seeded paths that avoid every rect never hit the live gate`,
      () => {
        const ctx = buildDrcItems(p);
        const win = outlineHalfExtentMm(p);
        const clearanceMm = ctx.resolver.boardClearanceByPairKind.traceToTrace;
        const rnd = lcg(20260909 + name.length);
        let accepted = 0;
        let near = 0;

        for (const probeNetId of [null, PROBE_NET_ID] as const) {
          for (const layer of ["F.Cu", "B.Cu"] as const) {
            const rects = buildRouteObstacles({
              ctx,
              layer,
              netId: probeNetId,
              routeWidthMm: 0.2,
            });
            for (let i = 0; i < 300; i += 1) {
              const pointCount: 2 | 3 = i % 3 === 0 ? 3 : 2;
              const path = randomAvoidingPath(
                rnd,
                rects,
                win,
                clearanceMm,
                pointCount,
                i % 2 === 0,
              );
              if (!path) continue;
              accepted += 1;
              if (probeNetId === null) {
                const pathBounds = pathBoundsMm(path);
                const gapMm = Math.min(
                  ...(rects.length > 0
                    ? rects.map((r) => aabbGap(pathBounds, rectBoundsMm(r)))
                    : [Infinity]),
                );
                if (gapMm <= 2 * clearanceMm) near += 1;
              }
              const pendingTrace: PcbTrace = {
                id: "pending:trace:0",
                netId: probeNetId,
                netClassId: "default",
                layer,
                widthMm: 0.2,
                pointsNm: path,
                segmentMode: "manhattan-45",
              };
              const violations = checkPendingCopper(ctx, {
                traces: [pendingTrace],
                vias: [],
              });
              const blocked = violations.filter((v) => BLOCKING_CODES.includes(v.code));
              expect(
                blocked,
                `${name} net=${probeNetId} ${layer} path ${i}: ${JSON.stringify(blocked)}`,
              ).toEqual([]);
            }
          }
        }
        console.info(
          `[obstacle-superset] ${name}: accepted=${accepted} nearWithin2xClearance=${near}`,
        );
        expect(accepted).toBeGreaterThanOrEqual(200);
        // Proximity, not just "somewhere on the board" (null-net pass only —
        // the probe-net pass judges the SAME accepted paths again).
        expect(near).toBeGreaterThanOrEqual(150);
      },
      30_000,
    );
  }

  const censusFixture = JSON.parse(
    require("node:fs").readFileSync(
      path.join(
        import.meta.dir,
        "fixtures/drc/golden/golden-census-2l.json",
      ),
      "utf8",
    ),
  );
  checkBoard("golden-census-2l", fixtureToProjection(censusFixture));

  checkBoard(
    "hand-built: keepouts + rotated pads + NPTH slot + THT",
    projection({
      // Big enough to actually contain the -18..-14 keepout below (the
      // default 50×30 fixture board does not) — the sampling window now
      // follows the real outline (item 2), so obstacles off the outline
      // would otherwise never be sampled near.
      board: boardWithRules({
        outline: { kind: "rect", widthMm: 60, heightMm: 60, centerMm: { x: 0, y: 0 } },
      }),
      netNames: NETS,
      placements: [
        placement("U1", {
          positionMm: { x: -8, y: -8 },
          rotationDeg: 90,
          pads: [
            pad("1", { x: 0, y: 0 }, 2.0, 0.5),
            pad("2", { x: 3, y: 0 }, 1, 1, { drillDiameterMm: 0.5 }),
          ],
        }),
      ],
      padNets: { "U1|1": "a", "U1|2": "b" },
      freeHoles: [
        {
          id: "h1",
          centerMm: { x: 6, y: 6 },
          drillMm: 1.0,
          drillSlot: { lengthMm: 2, widthMm: 1, angleDeg: 30 },
          lockedAt: null,
        },
      ],
      keepouts: [
        keepoutRow(
          "k1",
          ["F.Cu", "B.Cu"],
          [
            { x: -18, y: -18 },
            { x: -14, y: -18 },
            { x: -14, y: -14 },
            { x: -18, y: -14 },
          ],
          { tracks: true, vias: true, pads: false, copperPour: false, footprints: false },
        ),
      ],
    }),
  );
});

// =============================================================================
// 4. Server ↔ live parity through the runtime (07 §6, harness from B2-9)
// =============================================================================

function isolateTestDb(testLabel: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${testLabel}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

async function createRuntime() {
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: repoRoot,
  });
  await moduleRuntime.bootstrap();
  createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  return { moduleRuntime };
}

describe("server ↔ live parity through the command runtime (07 §6)", () => {
  test("report: the ok result's refused count matches the batch report on the new copper", async () => {
    isolateTestDb("drc-live-parity-report");
    const { moduleRuntime } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await designerSdk.createDesign({ name: "live-parity report" });
    const initial = await designerSdk.getPcbProjection(design.id);
    const netClassId = initial!.board.netClasses[0]!.id;

    // Seed an obstacle the new route will violate clearance against.
    const seeded = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-seed",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: initial!.revision,
      issuedAt: Date.now(),
      command: {
        type: "pcb_add_trace",
        layer: "F.Cu",
        pointsNm: [{ x: 0, y: 0 }, { x: 10 * MM, y: 0 }],
        widthMm: 0.2,
        netId: null,
        netClassId,
        segmentMode: "manhattan-90",
        legality: "off",
      },
    });
    expect(seeded.ok).toBe(true);
    const beforeRoute = await designerSdk.getPcbProjection(design.id);
    const beforeTraceIds = new Set(beforeRoute!.traces.map((t) => t.id));

    const routed = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-route-report",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: beforeRoute!.revision,
      issuedAt: Date.now(),
      command: {
        type: "pcb_commit_route",
        traces: [
          {
            layer: "F.Cu",
            pointsNm: [{ x: 0, y: 0.22 * MM }, { x: 10 * MM, y: 0.22 * MM }],
            widthMm: 0.2,
            netId: null,
            netClassId,
            segmentMode: "manhattan-90",
          },
        ],
        vias: [],
        legality: "report",
      },
    });
    expect(routed.ok).toBe(true);
    if (!routed.ok) throw new Error("unreachable");
    expect(routed.legality?.refused).toBeGreaterThan(0);

    const after = await designerSdk.getPcbProjection(design.id);
    const newTraceIds = new Set(
      after!.traces.map((t) => t.id).filter((id) => !beforeTraceIds.has(id)),
    );
    expect(newTraceIds.size).toBeGreaterThan(0);

    const report = runDrc(after!);
    const onNewCopper = report.violations.filter(
      (v) =>
        REFUSE_CODES.has(v.code) &&
        v.anchors.some((a) => a.kind === "trace" && newTraceIds.has(a.traceId)),
    );
    expect(onNewCopper.length).toBe(routed.legality!.refused);

    // Code-level correspondence, not just a matching total: the live verdict
    // computed on the PRE-commit projection (what the server actually gated
    // on) must name the exact same multiset of refused codes as the batch
    // violations anchored on the committed copper.
    const ctxBefore = buildDrcItems(beforeRoute!);
    const pendingBefore: PcbTrace = {
      id: "pending:trace:0",
      netId: null,
      netClassId,
      layer: "F.Cu",
      widthMm: 0.2,
      pointsNm: [{ x: 0, y: 0.22 * MM }, { x: 10 * MM, y: 0.22 * MM }],
      segmentMode: "manhattan-90",
    };
    const liveRefusedCodes = refusedViolations(
      ctxBefore,
      checkPendingCopper(ctxBefore, { traces: [pendingBefore], vias: [] }),
    )
      .map((v) => v.code)
      .sort();
    const batchCodes = onNewCopper.map((v) => v.code).sort();
    expect(batchCodes).toEqual(liveRefusedCodes);
    expect(batchCodes.length).toBe(routed.legality!.refused);
  });

  test("refuse: the refusal's violations equal checkPendingCopper's pre-commit verdict", async () => {
    isolateTestDb("drc-live-parity-refuse");
    const { moduleRuntime } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await designerSdk.createDesign({ name: "live-parity refuse" });
    const initial = await designerSdk.getPcbProjection(design.id);
    const netClassId = initial!.board.netClasses[0]!.id;

    const seeded = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-seed",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: initial!.revision,
      issuedAt: Date.now(),
      command: {
        type: "pcb_add_trace",
        layer: "F.Cu",
        pointsNm: [{ x: 0, y: 0 }, { x: 10 * MM, y: 0 }],
        widthMm: 0.2,
        netId: null,
        netClassId,
        segmentMode: "manhattan-90",
        legality: "off",
      },
    });
    expect(seeded.ok).toBe(true);
    const preCommit = await designerSdk.getPcbProjection(design.id);

    // The pre-commit verdict, computed the way the client would.
    const ctx = buildDrcItems(preCommit!);
    const pendingTrace: PcbTrace = {
      id: "pending:trace:0",
      netId: null,
      netClassId,
      layer: "F.Cu",
      widthMm: 0.2,
      pointsNm: [{ x: 0, y: 0.22 * MM }, { x: 10 * MM, y: 0.22 * MM }],
      segmentMode: "manhattan-90",
    };
    const live = refusedViolations(
      ctx,
      checkPendingCopper(ctx, { traces: [pendingTrace], vias: [] }),
    );
    expect(live.length).toBeGreaterThan(0);

    const rejected = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-route-refuse",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: preCommit!.revision,
      issuedAt: Date.now(),
      command: {
        type: "pcb_commit_route",
        traces: [
          {
            layer: "F.Cu",
            pointsNm: [{ x: 0, y: 0.22 * MM }, { x: 10 * MM, y: 0.22 * MM }],
            widthMm: 0.2,
            netId: null,
            netClassId,
            segmentMode: "manhattan-90",
          },
        ],
        vias: [],
        legality: "refuse",
      },
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("unreachable");
    expect(rejected.code).toBe("PCB_COPPER_ILLEGAL");
    const rejectedViolations = (rejected as { violations: DrcViolation[] }).violations;

    // The pending id never matches the assigned one, so the bijection is
    // matched on every OTHER field (07 §1).
    expect(
      multisetEqual(live.map(shapeNoId), rejectedViolations.map(shapeNoId)),
    ).toBe(true);

    // Nothing persisted.
    const untouched = await designerSdk.getPcbProjection(design.id);
    expect(untouched!.traces.length).toBe(preCommit!.traces.length);
  });
});
