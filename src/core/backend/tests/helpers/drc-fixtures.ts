/**
 * Shared DRC test fixture builders — the drc-engine.test.ts builder style,
 * exported so the P0 QA suites (determinism, epsilon matrix, audit
 * regressions, goldens) construct projections one way. Coordinates are mm
 * unless the name says Nm; trace points are given in mm and converted.
 */
import { createDefaultPcbBoardSettings } from "../../../../modules/designer/backend/pcb/pcb-defaults";
import type { FootprintRenderSourcePad } from "../../../../shared/rendering/types";
import type {
  DesignerPcbProjection,
  DrcReport,
  DrcRuleCode,
  PcbBoardSettings,
  PcbDesignRules,
  PcbDrcRule,
  PcbFreeHole,
  PcbFreePad,
  PcbNetClass,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
  RatsnestEndpoint,
  RatsnestSegment,
} from "../../../../sdks/designer";

export const FIXTURE_TS = "2026-01-01T00:00:00.000Z";
export const MM = 1_000_000;

/**
 * Fixtures are FLOOR-FREE (rule-semantics contract §12 item 5): new boards get
 * `minimums.clearanceMm = 0.1`, but every DRC fixture and every golden was
 * written before the floor existed and must keep resolving at exactly the
 * value its own rules state. A fixture that wants the floor sets it explicitly.
 */
function withoutClearanceFloor(settings: PcbBoardSettings): PcbBoardSettings {
  const { clearanceMm: _floor, ...minimums } = settings.designRules.minimums;
  return {
    ...settings,
    designRules: { ...settings.designRules, minimums },
  };
}

export function board(
  overrides: Partial<PcbBoardSettings> = {},
): PcbBoardSettings {
  return {
    ...withoutClearanceFloor(createDefaultPcbBoardSettings(FIXTURE_TS)),
    ...overrides,
  };
}

/** Board with deep-merged design-rule overrides. */
export function boardWithRules(rules: {
  clearance?: Partial<PcbDesignRules["clearance"]>;
  minimums?: Partial<PcbDesignRules["minimums"]>;
  netClasses?: PcbNetClass[];
  perNetClassAssignments?: Record<string, string>;
  fabricator?: PcbBoardSettings["fabricator"];
  layerCount?: PcbBoardSettings["layerCount"];
  boardThicknessMm?: number;
  drcRules?: PcbDrcRule[];
  outline?: PcbBoardSettings["outline"];
}): PcbBoardSettings {
  const base = withoutClearanceFloor(createDefaultPcbBoardSettings(FIXTURE_TS));
  return {
    ...base,
    ...(rules.drcRules !== undefined ? { drcRules: rules.drcRules } : {}),
    ...(rules.outline !== undefined ? { outline: rules.outline } : {}),
    ...(rules.fabricator !== undefined ? { fabricator: rules.fabricator } : {}),
    ...(rules.layerCount !== undefined ? { layerCount: rules.layerCount } : {}),
    ...(rules.boardThicknessMm !== undefined
      ? { boardThicknessMm: rules.boardThicknessMm }
      : {}),
    ...(rules.netClasses !== undefined ? { netClasses: rules.netClasses } : {}),
    ...(rules.perNetClassAssignments !== undefined
      ? { perNetClassAssignments: rules.perNetClassAssignments }
      : {}),
    designRules: {
      ...base.designRules,
      clearance: { ...base.designRules.clearance, ...rules.clearance },
      minimums: { ...base.designRules.minimums, ...rules.minimums },
    },
  };
}

export function projection(
  parts: Partial<DesignerPcbProjection> = {},
): DesignerPcbProjection {
  return {
    designId: "d1",
    revision: 1,
    board: parts.board ?? board(),
    placements: parts.placements ?? [],
    traces: parts.traces ?? [],
    vias: parts.vias ?? [],
    freeHoles: parts.freeHoles ?? [],
    freePads: parts.freePads ?? [],
    overlayTexts: parts.overlayTexts ?? [],
    overlayShapes: parts.overlayShapes ?? [],
    zones: parts.zones ?? [],
    keepouts: parts.keepouts ?? [],
    ratsnest: parts.ratsnest ?? [],
    netNames: parts.netNames ?? {},
    padNets: parts.padNets,
    warnings: [],
  };
}

export function trace(
  id: string,
  netId: string | null,
  pts: Array<[number, number]>,
  opts: {
    widthMm?: number;
    layer?: PcbTrace["layer"];
    netClassId?: string;
  } = {},
): PcbTrace {
  return {
    id,
    netId,
    netClassId: opts.netClassId ?? "default",
    layer: opts.layer ?? "F.Cu",
    widthMm: opts.widthMm ?? 0.2,
    pointsNm: pts.map(([x, y]) => ({
      x: Math.round(x * MM),
      y: Math.round(y * MM),
    })),
    segmentMode: "manhattan-90",
  };
}

export function via(
  id: string,
  opts: {
    netId?: string | null;
    netClassId?: string;
    center?: { x: number; y: number };
    diameterMm?: number;
    drillMm?: number;
    fromLayer?: PcbVia["fromLayer"];
    toLayer?: PcbVia["toLayer"];
    viaType?: PcbVia["viaType"];
  } = {},
): PcbVia {
  return {
    id,
    netId: opts.netId ?? null,
    netClassId: opts.netClassId ?? "default",
    centerMm: opts.center ?? { x: 0, y: 0 },
    diameterMm: opts.diameterMm ?? 0.8,
    drillMm: opts.drillMm ?? 0.4,
    fromLayer: opts.fromLayer ?? "F.Cu",
    toLayer: opts.toLayer ?? "B.Cu",
    viaType: opts.viaType ?? "through",
    protection: "tented",
    provenance: "route",
  };
}

export function freeHole(
  id: string,
  center: { x: number; y: number },
  drillMm: number,
): PcbFreeHole {
  return { id, centerMm: center, drillMm, lockedAt: null };
}

export function freePad(
  id: string,
  opts: {
    padType?: PcbFreePad["padType"];
    shape?: PcbFreePad["shape"];
    center?: { x: number; y: number };
    widthMm?: number;
    heightMm?: number;
    drillMm?: number | null;
    drillSlot?: PcbFreePad["drillSlot"];
    layer?: PcbFreePad["layer"];
    netId?: string | null;
    rotationDeg?: number;
    solderMaskExpansionMm?: number | null;
  } = {},
): PcbFreePad {
  return {
    id,
    centerMm: opts.center ?? { x: 0, y: 0 },
    rotationDeg: opts.rotationDeg ?? 0,
    padType: opts.padType ?? "smd",
    shape: opts.shape ?? "rect",
    widthMm: opts.widthMm ?? 1,
    heightMm: opts.heightMm ?? 1,
    drillMm: opts.drillMm ?? null,
    ...(opts.drillSlot !== undefined ? { drillSlot: opts.drillSlot } : {}),
    layer: opts.layer ?? "F.Cu",
    netId: opts.netId ?? null,
    solderMaskExpansionMm: opts.solderMaskExpansionMm ?? null,
    solderPasteExpansionMm: null,
    lockedAt: null,
  };
}

export function pad(
  number: string,
  center: { x: number; y: number },
  w: number,
  h: number,
  opts: {
    shape?: FootprintRenderSourcePad["shape"];
    rotationDeg?: number;
    drillDiameterMm?: number;
    layer?: string;
    roundrectRatio?: number;
    // The three S11 drill attributes (manufacturability contract 10 §2.1).
    // They are absent from the PINNED `@openpcb/rendering-core` pad type, so
    // they are attached structurally here exactly as a real render source
    // carries them; `padDrillFields` is the only place that reads them back.
    plated?: boolean;
    drillSlotMm?: { widthMm: number; heightMm: number };
    drillOffsetMm?: { x: number; y: number };
  } = {},
): FootprintRenderSourcePad {
  return {
    id: `pad-${number}`,
    number,
    shape: opts.shape ?? "rect",
    centerMm: center,
    widthMm: w,
    heightMm: h,
    rotationDeg: opts.rotationDeg ?? 0,
    ...(opts.drillDiameterMm !== undefined
      ? { drillDiameterMm: opts.drillDiameterMm }
      : {}),
    ...(opts.layer !== undefined ? { layer: opts.layer } : {}),
    ...(opts.roundrectRatio !== undefined
      ? { roundrectRatio: opts.roundrectRatio }
      : {}),
    ...(opts.plated !== undefined ? { plated: opts.plated } : {}),
    ...(opts.drillSlotMm !== undefined
      ? { drillSlotMm: opts.drillSlotMm }
      : {}),
    ...(opts.drillOffsetMm !== undefined
      ? { drillOffsetMm: opts.drillOffsetMm }
      : {}),
  };
}

export function placement(
  id: string,
  opts: {
    positionMm?: { x: number; y: number };
    rotationDeg?: number;
    layer?: PcbPlacedPart["layer"];
    mirrored?: boolean;
    pads?: FootprintRenderSourcePad[];
    reference?: string;
  } = {},
): PcbPlacedPart {
  return {
    id,
    partId: id,
    componentId: "c",
    reference: opts.reference ?? id,
    positionMm: opts.positionMm ?? { x: 0, y: 0 },
    rotationDeg: opts.rotationDeg ?? 0,
    mirrored: opts.mirrored ?? false,
    layer: opts.layer ?? "F.Cu",
    footprint: {
      footprintId: "fp",
      name: "FP",
      mountType: null,
      sourceHash: null,
      preview: {
        kind: "footprint",
        units: "mm",
        name: "FP",
        pads: opts.pads ?? [],
        graphics: [],
        labels: [],
        bounds: null,
        warnings: [],
      },
    },
  };
}

export function ratsSeg(
  netId: string,
  fromMm: { x: number; y: number },
  toMm: { x: number; y: number },
  opts: { from?: RatsnestEndpoint; to?: RatsnestEndpoint } = {},
): RatsnestSegment {
  return {
    netId,
    netClassId: "default",
    fromMm,
    toMm,
    from: opts.from ?? { kind: "pad", placementId: "U1", padNumber: "1" },
    to: opts.to ?? { kind: "pad", placementId: "U2", padNumber: "1" },
  };
}

export function codes(report: DrcReport): DrcRuleCode[] {
  return report.violations.map((v) => v.code);
}

export function sortedIds(report: DrcReport): string[] {
  return report.violations.map((v) => v.id).sort();
}
