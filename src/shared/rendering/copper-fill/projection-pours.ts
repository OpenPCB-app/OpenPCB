// The ONE argument builder of the copper-pour kernel (OPENPCB-67 §3.8,
// zone/keepout contract §13.3). Gerber, DRC, connectivity, the snapshot, the
// trace cleanup, the 3D preview and the canvas all hand the kernel the argument
// set built here, so no consumer can pour against a narrower board (a `Pick` of
// the settings without net classes, the traces of one layer only) than the one
// the artwork ships.
//
// Backend-safe: no `three` import, like the kernel itself.

import type {
  PcbBoardSettings,
  PcbCopperLayerId,
  PcbFreeHole,
  PcbFreePad,
  PcbKeepout,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
  PcbZone,
} from "../../../sdks";
import { copperToHoleClearanceMm } from "../../drc/rule-resolver";
import {
  collectCopperZones,
  collectKeepouts,
  type EffectiveCopperZone,
} from "../../pcb-areas/copper-zones";
import {
  pourParamsForZone,
  type ZonePourNets,
} from "../../pcb-areas/pour-params";
import {
  buildCopperRecords,
  type CopperRecords,
} from "../../pcb-connectivity/copper-records";
import {
  buildCopperFillIslands,
  type CopperFillPourParams,
  type CopperFillResult,
} from "./copper-fill-geometry";

/**
 * Everything the kernel's board-wide argument set is built from. Structural, so
 * a caller that is not a projection (connectivity, a trace-cleanup candidate
 * board) can supply it. `board` is the FULL settings — never a `Pick`, never a
 * cast — because the rule resolver behind every halo reads its net classes and
 * rules.
 */
export interface PourBaseInput {
  board: PcbBoardSettings;
  placements: readonly PcbPlacedPart[];
  traces: readonly PcbTrace[];
  vias: readonly PcbVia[];
  freeHoles: readonly PcbFreeHole[];
  freePads: readonly PcbFreePad[];
  /** `${placementId}|${padNumber}` → netId. Required; `{}` is an explicit answer. */
  padNets: Readonly<Record<string, string>>;
}

export interface PourProjection extends PourBaseInput {
  zones: readonly PcbZone[];
  /** Required (§13.3): a keepout the canvas draws must carve every fill. */
  keepouts: readonly PcbKeepout[];
  netNames: Readonly<Record<string, string>>;
}

/** The board-wide half of `CopperFillPourParams` — everything not per zone. */
export type PourBaseParams = Pick<
  CopperFillPourParams,
  | "layerCount"
  | "outline"
  | "records"
  | "placements"
  | "traces"
  | "vias"
  | "padNetIds"
  | "copperToBoardEdgeMm"
  | "copperToHoleMm"
  | "cutouts"
  | "freeHoles"
  | "freePads"
>;

/**
 * The ONE kernel argument set every consumer passes: ALL traces and ALL vias of
 * the board, whatever layer is being poured — a via's tier net and span are
 * decided by copper on other layers too.
 */
export function pourBaseParams(
  p: PourBaseInput,
  records?: CopperRecords,
): PourBaseParams {
  const rules = p.board.designRules;
  return {
    layerCount: p.board.layerCount,
    outline: p.board.outline,
    ...(records ? { records } : {}),
    placements: p.placements,
    traces: p.traces,
    vias: p.vias,
    padNetIds: new Map(Object.entries(p.padNets)),
    copperToBoardEdgeMm: rules.clearance.copperToBoardEdgeMm,
    copperToHoleMm: copperToHoleClearanceMm(rules),
    cutouts: p.board.cutouts ?? [],
    freeHoles: p.freeHoles,
    freePads: p.freePads,
  };
}

/** One effective zone and the copper the kernel answered for it. */
export interface ProjectionPour {
  zone: EffectiveCopperZone;
  result: CopperFillResult;
}

export interface ProjectionPoursOptions {
  /** Required: `zonePourNets(p.board, p.netNames)`, or DRC's own resolver. */
  nets: ZonePourNets;
  /** The caller's records for the SAME copper; absent ⇒ built once here. */
  records?: CopperRecords;
  /** Fill only the zones on this layer. */
  layer?: PcbCopperLayerId;
  /** Checkpoint before every zone (execution contract 09 §6). */
  tick?: (index: number, total: number) => void;
}

/**
 * Every effective copper zone filled once, in derivation (fill) order —
 * net-less zones included. A `failed` result is returned as such: each consumer
 * decides whether that refuses (Gerber), reports (DRC) or draws nothing
 * (canvas).
 */
export function buildProjectionPours(
  p: PourProjection,
  opts: ProjectionPoursOptions,
): ProjectionPour[] {
  const layerCount = p.board.layerCount;
  const { zones } = collectCopperZones({
    zones: p.zones,
    layerCount,
    knownNetIds: new Set(Object.keys(p.netNames)),
  });
  const { keepouts } = collectKeepouts({ keepouts: p.keepouts, layerCount });
  const selected =
    opts.layer === undefined
      ? zones
      : zones.filter((zone) => zone.layer === opts.layer);
  if (selected.length === 0) return [];
  const base = pourBaseParams(p);
  const records =
    opts.records ??
    buildCopperRecords({
      layerCount,
      placements: p.placements,
      padNetIds: base.padNetIds,
      freePads: p.freePads,
      traces: p.traces,
      vias: p.vias,
    });
  const pours: ProjectionPour[] = [];
  for (let i = 0; i < selected.length; i += 1) {
    const zone = selected[i]!;
    opts.tick?.(i, selected.length);
    pours.push({
      zone,
      result: buildCopperFillIslands({
        ...base,
        records,
        ...pourParamsForZone(
          zone,
          p.board.designRules,
          keepouts,
          zones,
          opts.nets,
        ),
      }),
    });
  }
  return pours;
}
