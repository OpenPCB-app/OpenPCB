/**
 * Deterministic (LCG-seeded) synthetic PCB projection generator for the WP4
 * broad-phase oracle harness (contract 08 §7). Never `Math.random`, never
 * `Date` — every `opts` maps to one exact projection, forever.
 *
 * Mix per `items` (approximate, seed-driven): ~60% traces (45° doglegs + axis
 * runs), ~20% vias, ~15% footprint pads (8-pad parts on a grid of
 * placements), ~5% NPTH free holes (some slots), plus a handful of free pads.
 * At least 5% of vertices land on an exact multiple of `CELL_MM = 2` so the
 * corpus exercises cell-boundary arithmetic.
 */
import { createDefaultPcbBoardSettings } from "../../../../modules/designer/backend/pcb/pcb-defaults";
import type { FootprintRenderSourcePad } from "../../../../shared/rendering/types";
import type {
  DesignerPcbProjection,
  PcbBoardCutout,
  PcbBoardOutline,
  PcbBoardSettings,
  PcbDrcRule,
  PcbFabricatorId,
  PcbFreeHole,
  PcbFreePad,
  PcbKeepout,
  PcbNetClass,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
  PcbZone,
} from "../../../../sdks/designer";
import {
  freeHole,
  freePad,
  pad,
  placement,
  trace,
  via,
} from "./drc-fixtures";

/** Deterministic LCG — same algorithm as drc-legality.test.ts L692-698. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export interface SynthesizeOpts {
  seed: number;
  items: number;
  outline?: "rect" | "roundrect" | "contour";
  cutouts?: number;
  keepouts?: number;
  hvNets?: boolean;
  areaRules?: boolean;
  netRules?: boolean;
  longDiagonals?: boolean;
  offBoard?: boolean;
  zones?: boolean;
  suppressions?: boolean;
  fabricator?: PcbFabricatorId;
  nonFinite?: boolean;
  degenerateTraces?: boolean;
  /** A second `DrcPad` shape under pad number "1" of the first placement. */
  duplicatePadNumber?: boolean;
}

function snap2(v: number): number {
  return Math.round(v / 2) * 2;
}

function makeOutline(
  kind: "rect" | "roundrect" | "contour",
  halfW: number,
  halfH: number,
): PcbBoardOutline {
  const w = halfW * 2;
  const h = halfH * 2;
  if (kind === "roundrect") {
    return {
      kind: "roundrect",
      widthMm: w,
      heightMm: h,
      centerMm: { x: 0, y: 0 },
      cornerRadiusMm: Math.min(5, halfW / 4, halfH / 4),
    };
  }
  if (kind === "contour") {
    return {
      kind: "contour",
      widthMm: w,
      heightMm: h,
      centerMm: { x: 0, y: 0 },
      start: { x: -halfW, y: -halfH },
      segments: [
        { type: "line", to: { x: halfW, y: -halfH } },
        { type: "line", to: { x: halfW, y: halfH } },
        { type: "line", to: { x: -halfW, y: halfH } },
        { type: "line", to: { x: -halfW, y: -halfH } },
      ],
    };
  }
  return { kind: "rect", widthMm: w, heightMm: h, centerMm: { x: 0, y: 0 } };
}

/**
 * Deterministic synthetic board. Same `opts` (deep-equal) always produces the
 * same projection: only `lcg(opts.seed)` supplies randomness, drawn in a
 * fixed order.
 */
export function synthesizeBoard(opts: SynthesizeOpts): DesignerPcbProjection {
  const rnd = lcg(opts.seed);
  const items = Math.max(1, opts.items);

  // Board sized so the item density stays roughly constant across sizes, and
  // large enough for `longDiagonals` (>60mm span) to fit with margin.
  let side = Math.max(60, Math.sqrt(items) * 3.2);
  if (opts.longDiagonals) side = Math.max(side, 140);
  const halfW = side / 2;
  const halfH = side / 2;
  const margin = 4;

  const board: PcbBoardSettings = createDefaultPcbBoardSettings(
    "2026-01-01T00:00:00.000Z",
  );
  // Floor-free, like every other DRC fixture (drc-fixtures.ts convention).
  delete board.designRules.minimums.clearanceMm;
  board.outline = makeOutline(opts.outline ?? "rect", halfW, halfH);

  if (opts.fabricator) board.fabricator = opts.fabricator;

  const cutouts: PcbBoardCutout[] = [];
  for (let i = 0; i < (opts.cutouts ?? 0); i += 1) {
    const cx = (rnd() * 2 - 1) * (halfW - 10);
    const cy = (rnd() * 2 - 1) * (halfH - 10);
    cutouts.push({
      id: `cut${i}`,
      shape: {
        kind: "circle",
        centerMm: { x: cx, y: cy },
        widthMm: 4,
        heightMm: 4,
      },
    });
  }
  if (cutouts.length > 0) board.cutouts = cutouts;

  // Net pool. At least 4, growing with item count so clearance/creepage pair
  // enumeration sees real net diversity.
  const netCount = Math.max(4, Math.floor(items / 60));
  const netIds = Array.from({ length: netCount }, (_, i) => `n${i}`);
  const netNames: Record<string, string> = {};
  for (const id of netIds) netNames[id] = id.toUpperCase();

  const netClasses: PcbNetClass[] = [
    {
      id: "default",
      name: "Default",
      traceWidthMm: 0.2,
      clearanceMm: 0.2,
      viaDiameterMm: 0.8,
      viaDrillMm: 0.4,
      color: "#888",
      defaultViaProtection: "tented",
    },
  ];
  if (opts.hvNets) {
    netClasses.push(
      {
        id: "hv-neg",
        name: "HV-",
        traceWidthMm: 0.3,
        clearanceMm: 0.3,
        viaDiameterMm: 0.8,
        viaDrillMm: 0.4,
        color: "#f00",
        defaultViaProtection: "tented",
        voltageV: -400,
      },
      {
        id: "hv-zero",
        name: "HV0",
        traceWidthMm: 0.3,
        clearanceMm: 0.3,
        viaDiameterMm: 0.8,
        viaDrillMm: 0.4,
        color: "#0f0",
        defaultViaProtection: "tented",
        voltageV: 0,
      },
      {
        id: "hv-pos",
        name: "HV+",
        traceWidthMm: 0.3,
        clearanceMm: 0.3,
        viaDiameterMm: 0.8,
        viaDrillMm: 0.4,
        color: "#00f",
        defaultViaProtection: "tented",
        voltageV: 400,
      },
    );
  }
  board.netClasses = netClasses;

  const perNetClassAssignments: Record<string, string> = {};
  if (opts.hvNets) {
    // Bind three real nets to the HV classes so a creepage-bearing pair
    // actually exists on the board.
    perNetClassAssignments[netIds[0]!] = "hv-neg";
    perNetClassAssignments[netIds[1 % netIds.length]!] = "hv-zero";
    perNetClassAssignments[netIds[2 % netIds.length]!] = "hv-pos";
  }
  if (Object.keys(perNetClassAssignments).length > 0) {
    board.perNetClassAssignments = perNetClassAssignments;
  }

  const drcRules: PcbDrcRule[] = [];
  if (opts.areaRules) {
    drcRules.push(
      {
        id: "area-relax",
        name: "Area relax",
        enabled: true,
        priority: 10,
        scopes: [
          {
            kind: "area",
            polygonMm: [
              { x: -halfW + margin, y: -halfH + margin },
              { x: -halfW + margin + 12, y: -halfH + margin },
              { x: -halfW + margin + 12, y: -halfH + margin + 12 },
              { x: -halfW + margin, y: -halfH + margin + 12 },
            ],
          },
        ],
        constraint: { kind: "clearance", mm: 0.15 },
      },
      {
        id: "area-tighten",
        name: "Area tighten",
        enabled: true,
        priority: 11,
        scopes: [
          {
            kind: "area",
            polygonMm: [
              { x: halfW - margin - 12, y: halfH - margin - 12 },
              { x: halfW - margin, y: halfH - margin - 12 },
              { x: halfW - margin, y: halfH - margin },
              { x: halfW - margin - 12, y: halfH - margin },
            ],
          },
        ],
        constraint: { kind: "clearance", mm: 0.8 },
      },
      // A net-scoped `edgeClearance` rule, enabled AND disabled (WP4 R2
      // finding: the generator emitted no `edgeClearance` / `holeToHole`
      // rules at all, so `maxEdgeBoundMm` / `scalar("edgeClearance", …)` and
      // `maxHoleBoundMm` / `scalarPair("holeToHole", …)` were never exercised
      // against a real scoped rule — only the board's own flat value). Both
      // values are ABOVE the board's `copperToBoardEdgeMm` (0.5mm default),
      // and the disabled one is larger still: disabled rules must still
      // widen `maxEdgeBoundMm` (a bound is superset-safe over every enabled
      // OR disabled rule, contract 08 §5).
      {
        id: "edge-enabled",
        name: "Edge enabled",
        enabled: true,
        priority: 15,
        scopes: [{ kind: "net", netIds: [netIds[0]!] }],
        constraint: {
          kind: "edgeClearance",
          minMm: board.designRules.clearance.copperToBoardEdgeMm + 0.3,
        },
      },
      {
        id: "edge-disabled",
        name: "Edge disabled",
        enabled: false,
        priority: 16,
        scopes: [{ kind: "net", netIds: [netIds[0]!] }],
        constraint: {
          kind: "edgeClearance",
          minMm: board.designRules.clearance.copperToBoardEdgeMm + 1.0,
        },
      },
    );
  }
  if (opts.netRules) {
    drcRules.push(
      {
        id: "net-relax",
        name: "Net relax",
        enabled: true,
        priority: 20,
        scopes: [{ kind: "net", netIds: [netIds[0]!] }],
        constraint: { kind: "clearance", mm: 0.12 },
      },
      {
        id: "net-tighten",
        name: "Net tighten",
        enabled: true,
        priority: 21,
        scopes: [{ kind: "net", netIds: [netIds[netIds.length - 1]!] }],
        constraint: { kind: "clearance", mm: 0.6 },
      },
      // Enabled and disabled `holeToHole` rules — same reasoning as the
      // edge-clearance pair above, for `maxHoleBoundMm`.
      {
        id: "holetohole-enabled",
        name: "HoleToHole enabled",
        enabled: true,
        priority: 25,
        scopes: [],
        constraint: { kind: "holeToHole", minMm: 0.35 },
      },
      {
        id: "holetohole-disabled",
        name: "HoleToHole disabled",
        enabled: false,
        priority: 26,
        scopes: [],
        constraint: { kind: "holeToHole", minMm: 0.9 },
      },
    );
  }
  if (drcRules.length > 0) board.drcRules = drcRules;

  if (opts.suppressions) {
    board.drcSeverityOverrides = {
      TRACE_WIDTH_MIN: "warning",
      FAB_ANNULAR_RING: "ignore",
    };
    board.viewState = {
      displayMode: "normal",
      viewSide: "top",
      perLayerOpacity: {},
      layerPreset: "custom",
      ratsnestVisible: true,
      drcIgnoredRuleClasses: ["signal-integrity"],
      drcWaivedViolationIds: [],
    };
  }

  const nTraces = Math.round(items * 0.6);
  const nVias = Math.round(items * 0.2);
  const nPlacements = Math.max(1, Math.round((items * 0.15) / 8));
  const nHoles = Math.round(items * 0.05);
  const nFreePads = Math.max(2, Math.round(items * 0.02));

  const traces: PcbTrace[] = [];
  const vias: PcbVia[] = [];
  const placements: PcbPlacedPart[] = [];
  const freeHoles: PcbFreeHole[] = [];
  const freePads: PcbFreePad[] = [];
  const padNets: Record<string, string> = {};

  const pickNet = (): string => netIds[Math.floor(rnd() * netIds.length)]!;
  const inBoard = (v: number, half: number): number =>
    Math.max(-half + margin, Math.min(half - margin, v));

  let longDiagonalCount = 0;
  const minLongDiagonals = opts.longDiagonals
    ? Math.max(1, Math.ceil(nTraces * 0.02))
    : 0;

  for (let i = 0; i < nTraces; i += 1) {
    let x0 = inBoard((rnd() * 2 - 1) * halfW, halfW);
    let y0 = inBoard((rnd() * 2 - 1) * halfH, halfH);
    // 5%+ of vertices on an exact 2mm grid multiple.
    if (rnd() < 0.15) x0 = snap2(x0);
    if (rnd() < 0.15) y0 = snap2(y0);

    let x1: number;
    let y1: number;
    if (opts.longDiagonals && longDiagonalCount < minLongDiagonals) {
      // A span strictly > 60mm, chosen to fit the board's own diagonal
      // capacity (`side` is floored at 140mm whenever this flag is set) —
      // and x0/y0 are picked HERE, reserving room in the chosen direction,
      // so `inBoard`'s clamp below can never shorten the endpoint under
      // 60mm and silently defeat the flag (WP4 R2 finding: the old version
      // picked x0/y0 first, generically, then clamped the endpoint).
      const usableHalfW = halfW - margin;
      const usableHalfH = halfH - margin;
      const maxSpan = Math.hypot(usableHalfW * 2, usableHalfH * 2) * 0.9;
      const span = Math.min(61 + rnd() * 20, maxSpan);
      const ang = rnd() * Math.PI * 2;
      const dx = span * Math.cos(ang);
      const dy = span * Math.sin(ang);
      const rangeFor = (halfExtent: number, delta: number): [number, number] => {
        const lo = Math.max(-halfExtent, -halfExtent - delta);
        const hi = Math.min(halfExtent, halfExtent - delta);
        return hi > lo ? [lo, hi] : [0, 0];
      };
      const [xLo, xHi] = rangeFor(usableHalfW, dx);
      const [yLo, yHi] = rangeFor(usableHalfH, dy);
      x0 = xLo + rnd() * (xHi - xLo);
      y0 = yLo + rnd() * (yHi - yLo);
      x1 = x0 + dx;
      y1 = y0 + dy;
      longDiagonalCount += 1;
    } else if (rnd() < 0.5) {
      // Axis-aligned run.
      const len = 1 + rnd() * 10;
      x1 = rnd() < 0.5 ? inBoard(x0 + len, halfW) : x0;
      y1 = rnd() < 0.5 ? inBoard(y0 + len, halfH) : y0;
      if (x1 === x0 && y1 === y0) x1 = inBoard(x0 + len, halfW);
    } else {
      // 45° dogleg-ish diagonal.
      const len = 1 + rnd() * 8;
      const dir = Math.floor(rnd() * 4) * (Math.PI / 4) + Math.PI / 4;
      x1 = inBoard(x0 + len * Math.cos(dir), halfW);
      y1 = inBoard(y0 + len * Math.sin(dir), halfH);
    }
    if (rnd() < 0.15) x1 = snap2(x1);
    if (rnd() < 0.15) y1 = snap2(y1);

    const netId = rnd() < 0.85 ? pickNet() : null;
    const layer = rnd() < 0.5 ? "F.Cu" : "B.Cu";
    const width = [0.15, 0.2, 0.25, 0.3][Math.floor(rnd() * 4)]!;
    traces.push(
      trace(`gt${i}`, netId, [
        [x0, y0],
        [x1, y1],
      ], { widthMm: width, layer: layer as PcbTrace["layer"] }),
    );
  }

  for (let i = 0; i < nVias; i += 1) {
    const cx = inBoard((rnd() * 2 - 1) * halfW, halfW);
    const cy = inBoard((rnd() * 2 - 1) * halfH, halfH);
    const netId = rnd() < 0.85 ? pickNet() : null;
    vias.push(
      via(`gv${i}`, {
        netId,
        center: { x: cx, y: cy },
        diameterMm: 0.6 + rnd() * 0.4,
        drillMm: 0.3 + rnd() * 0.2,
      }),
    );
  }

  // Nonzero-only pool: the OLD gate combined a 15% "rotate at all" roll with
  // a pool that was HALF zeros (3 of 6 choices), so the actual rotated
  // fraction was 0.15 * 0.5 = 7.5% — under the "10%+" the brief asks for
  // (WP4 R2 finding). The gate alone now decides rotated-or-not, and every
  // choice in the pool is a real rotation.
  const rotationChoices = [30, 45, 90];
  for (let i = 0; i < nPlacements; i += 1) {
    const px = inBoard((rnd() * 2 - 1) * halfW, halfW);
    const py = inBoard((rnd() * 2 - 1) * halfH, halfH);
    const rotationDeg =
      rnd() < 0.15 ? rotationChoices[Math.floor(rnd() * rotationChoices.length)]! : 0;
    const pads = [];
    for (let k = 0; k < 8; k += 1) {
      const col = k % 4;
      const row = Math.floor(k / 4);
      const localX = -3 + col * 2;
      const localY = row === 0 ? -2 : 2;
      const isTht = rnd() < 0.2;
      const shapeRoll = rnd();
      const shape: FootprintRenderSourcePad["shape"] =
        shapeRoll < 0.15
          ? "circle"
          : shapeRoll < 0.3
            ? "oval"
            : shapeRoll < 0.45
              ? "roundrect"
              : shapeRoll < 0.55
                ? "trapezoid"
                : "rect";
      const p = pad(`${k + 1}`, { x: localX, y: localY }, 1.2, 0.6, {
        shape,
        ...(isTht ? { drillDiameterMm: 0.4 } : {}),
      });
      pads.push(p);
      const netId = rnd() < 0.9 ? pickNet() : null;
      if (netId) padNets[`gp${i}|${p.number}`] = netId;
    }
    if (opts.duplicatePadNumber && i === 0) {
      // A second shape under pad NUMBER "1" — one logical anchor
      // (`{placementId, padNumber}`), two `DrcPad` shapes, the multi-shape
      // pin the id-collapsing / worse-witness machinery has to handle
      // (contract 08 §7 R2 finding).
      pads.push(
        pad("1", { x: -3, y: -2.05 }, 1.4, 0.7, { shape: "rect" }),
      );
    }
    placements.push(
      placement(`gp${i}`, {
        positionMm: { x: px, y: py },
        rotationDeg,
        pads,
        reference: `U${i}`,
      }),
    );
  }

  for (let i = 0; i < nHoles; i += 1) {
    const hx = inBoard((rnd() * 2 - 1) * halfW, halfW);
    const hy = inBoard((rnd() * 2 - 1) * halfH, halfH);
    const drill = 0.5 + rnd() * 0.6;
    const isSlot = rnd() < 0.25;
    const h = freeHole(`gh${i}`, { x: hx, y: hy }, drill);
    if (isSlot) {
      h.drillSlot = {
        lengthMm: 1 + rnd() * 2,
        widthMm: drill,
        angleDeg: rnd() * 180,
      };
    }
    freeHoles.push(h);
  }

  for (let i = 0; i < nFreePads; i += 1) {
    const fx = inBoard((rnd() * 2 - 1) * halfW, halfW);
    const fy = inBoard((rnd() * 2 - 1) * halfH, halfH);
    freePads.push(
      freePad(`gf${i}`, {
        center: { x: fx, y: fy },
        netId: rnd() < 0.7 ? pickNet() : null,
        widthMm: 1,
        heightMm: 1,
      }),
    );
  }

  if (opts.offBoard) {
    const fx = halfW + 20;
    traces.push(
      trace("off-trace", pickNet(), [
        [fx, 0],
        [fx + 4, 0],
      ]),
    );
    vias.push(
      via("off-via", { center: { x: fx, y: 6 }, netId: pickNet() }),
    );
    freeHoles.push(freeHole("off-hole", { x: fx, y: 12 }, 0.6));
  }

  if (opts.longDiagonals && longDiagonalCount === 0) {
    // Guarantee at least one, regardless of the ratio roll above.
    traces.push(
      trace("forced-long-diag", pickNet(), [
        [-halfW + margin, -halfH + margin],
        [halfW - margin, halfH - margin],
      ]),
    );
  }

  if (opts.degenerateTraces) {
    traces.push(trace("zero-len", pickNet(), [[0, 0], [0, 0]]));
    traces.push(trace("one-point", pickNet(), [[1, 1]]));
  }

  if (opts.nonFinite) {
    const bad = trace("nonfinite", pickNet(), [
      [0, 0],
      [1, 1],
    ]);
    bad.pointsNm[1]!.x = NaN;
    traces.push(bad);
  }

  const keepouts: PcbKeepout[] = [];
  for (let i = 0; i < (opts.keepouts ?? 0); i += 1) {
    const kx = inBoard((rnd() * 2 - 1) * halfW, halfW);
    const ky = inBoard((rnd() * 2 - 1) * halfH, halfH);
    keepouts.push({
      id: `gk${i}`,
      name: `Keepout ${i}`,
      enabled: true,
      lockedAt: null,
      layers: ["F.Cu"],
      pointsMm: [
        { x: kx - 3, y: ky - 3 },
        { x: kx + 3, y: ky - 3 },
        { x: kx + 3, y: ky + 3 },
        { x: kx - 3, y: ky + 3 },
      ],
      restrictions: {
        tracks: true,
        vias: true,
        pads: true,
        copperPour: true,
        footprints: false,
      },
    });
  }

  const zones: PcbZone[] = [];
  if (opts.zones) {
    for (const layer of ["F.Cu", "B.Cu"] as const) {
      zones.push({
        id: `gz-${layer}`,
        name: `Zone ${layer}`,
        enabled: true,
        lockedAt: null,
        layer,
        netId: netIds[0]!,
        netName: netNames[netIds[0]!]!,
        region: { kind: "board" },
        priority: 0,
      });
    }
  }

  return {
    designId: `synthetic-${opts.seed}-${items}`,
    revision: 1,
    board,
    placements,
    traces,
    vias,
    freeHoles,
    freePads,
    overlayTexts: [],
    overlayShapes: [],
    zones,
    keepouts,
    ratsnest: [],
    netNames,
    padNets,
    warnings: [],
  };
}

export interface SyntheticCorpusEntry {
  name: string;
  opts: SynthesizeOpts;
}

/**
 * The corpus the oracle test iterates (contract 08 §7): ≥ 12 seeds × sizes
 * 300 / 1500 / 5000, with every feature flag on for at least two boards each.
 * Kept ≤ 2 seeds at 5000 items (30s Bun timeout, contract constraint).
 */
export const SYNTHETIC_CORPUS: SyntheticCorpusEntry[] = [
  // Base seeds at every size, plain (no extra features) — the density/mix
  // baseline every stats inequality is measured against.
  { name: "s1-300-plain", opts: { seed: 1, items: 300 } },
  {
    name: "s2-300-nonfinite",
    opts: { seed: 2, items: 300, nonFinite: true },
  },
  { name: "s3-300-hv", opts: { seed: 3, items: 300, hvNets: true } },
  {
    name: "s4-300-area",
    opts: { seed: 4, items: 300, areaRules: true, duplicatePadNumber: true },
  },
  { name: "s5-300-net", opts: { seed: 5, items: 300, netRules: true } },
  {
    name: "s6-300-diag",
    opts: { seed: 6, items: 300, longDiagonals: true },
  },
  { name: "s7-300-off", opts: { seed: 7, items: 300, offBoard: true } },
  { name: "s8-300-zones", opts: { seed: 8, items: 300, zones: true } },
  {
    name: "s9-300-suppress",
    opts: { seed: 9, items: 300, suppressions: true },
  },
  {
    name: "s10-300-cutouts-keepouts",
    opts: { seed: 10, items: 300, cutouts: 2, keepouts: 2 },
  },
  {
    name: "s11-300-roundrect",
    opts: { seed: 11, items: 300, outline: "roundrect", cutouts: 1 },
  },
  {
    name: "s12-300-contour-fab",
    opts: {
      seed: 12,
      items: 300,
      outline: "contour",
      fabricator: "jlcpcb_2l",
    },
  },
  // Every feature on together, ≥ 2 boards, at a mid size.
  {
    name: "s13-1500-everything-a",
    opts: {
      seed: 13,
      items: 1500,
      outline: "roundrect",
      cutouts: 2,
      keepouts: 2,
      hvNets: true,
      areaRules: true,
      netRules: true,
      longDiagonals: true,
      offBoard: true,
      zones: true,
      suppressions: true,
      fabricator: "pcbway_std",
      degenerateTraces: true,
    },
  },
  {
    name: "s14-1500-everything-b",
    opts: {
      seed: 14,
      items: 1500,
      outline: "contour",
      cutouts: 1,
      keepouts: 3,
      hvNets: true,
      areaRules: true,
      netRules: true,
      longDiagonals: true,
      offBoard: true,
      zones: true,
      suppressions: true,
      fabricator: "jlcpcb_4l",
      degenerateTraces: true,
    },
  },
  {
    name: "s15-1500-nonfinite",
    opts: { seed: 15, items: 1500, nonFinite: true },
  },
  {
    name: "s16-1500-diag-hv",
    opts: {
      seed: 16,
      items: 1500,
      longDiagonals: true,
      hvNets: true,
      duplicatePadNumber: true,
    },
  },
  // Dense 5000-item boards, ≤ 2 seeds (30s timeout budget).
  {
    name: "s17-5000-dense",
    opts: {
      seed: 17,
      items: 5000,
      longDiagonals: true,
      hvNets: true,
      areaRules: true,
      netRules: true,
    },
  },
  {
    name: "s18-5000-dense-b",
    opts: {
      seed: 18,
      items: 5000,
      longDiagonals: true,
      offBoard: true,
      cutouts: 1,
      keepouts: 1,
      zones: true,
    },
  },
];
