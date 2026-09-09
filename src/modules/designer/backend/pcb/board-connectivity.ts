// Board-level copper connectivity: a PCB projection's copper (pads, free pads,
// traces, vias) plus its filled pour islands, resolved into the shared
// connectivity kernel's items and components.
//
// This is the module-layer adapter between the projection and
// `src/shared/pcb-connectivity/`. The kernel itself cannot call the fill kernel
// (shared/rendering depends on clipper2 and on the pour policy), so the pour
// nodes are built here and handed in as ordinary items. Contract:
// docs/pcb-hardening/01-connectivity-contract.md §1–§3.

import type {
  PcbBoardCutout,
  PcbBoardOutline,
  PcbCopperLayerId,
  PcbDesignRules,
  PcbFreeHole,
  PcbFreePad,
  PcbLayerCount,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
} from "../../../../sdks/designer";
import { copperToHoleClearanceMm } from "../../../../shared/drc/rule-resolver";
import {
  pourParamsForZone,
  type EffectiveCopperZone,
  type EffectiveKeepout,
  type ZonePourNets,
  type ZonePourParams,
} from "../../../../shared/pcb-areas";
import {
  buildCopperRecords,
  computeConnectivity,
  pourCopperItem,
  toCopperItems,
  type ConnectivityResult,
  type CopperItem,
  type CopperRecords,
} from "../../../../shared/pcb-connectivity";
import {
  buildCopperFillIslands,
  type CopperFillResult,
} from "../../../../shared/rendering/copper-fill/copper-fill-geometry";

/**
 * One net-bound pour to fill: exactly the zone tier `pourParamsForZone` composed
 * (zone/keepout contract §6, copper-pour contract §2), with the pour's net made
 * non-null. STRUCTURALLY the zone params — no field of it is optional-with-a-
 * fallback any more: every fallback this type used to carry was a second,
 * silently divergent policy next to the derivation's (Astra run 1 #1).
 */
export type BoardPourSpec = Omit<ZonePourParams, "pourNetId"> & {
  netId: string;
};

/**
 * Effective copper zones (`collectCopperZones`) → connectivity pour specs, in
 * derivation order — the pour index in `pour:<layer>:<net>:<pourIndex>:<island>`
 * is the position in THIS list. A net-less zone (contract §3.2) pours copper but
 * joins no net graph, so it contributes no connectivity node. `keepouts` has no
 * default (§13.3): every fill site pours the same copper only if it subtracts
 * the same `copperPour` keepouts.
 */
export function boardPourSpecs(
  zones: ReadonlyArray<EffectiveCopperZone>,
  designRules: PcbDesignRules,
  keepouts: ReadonlyArray<EffectiveKeepout>,
  nets: ZonePourNets,
): BoardPourSpec[] {
  const specs: BoardPourSpec[] = [];
  for (const zone of zones) {
    const netId = zone.netId;
    if (netId === null) continue;
    const { pourNetId: _pourNetId, ...overrides } = pourParamsForZone(
      zone,
      designRules,
      keepouts,
      zones,
      nets,
    );
    specs.push({ ...overrides, netId });
  }
  return specs;
}

/** The board-wide half of a pour — everything that is not per-zone. */
export interface BoardFillInput {
  outline: PcbBoardOutline;
  designRules: PcbDesignRules;
  cutouts?: ReadonlyArray<PcbBoardCutout>;
  freeHoles?: ReadonlyArray<PcbFreeHole>;
  pours: ReadonlyArray<BoardPourSpec>;
}

/** The copper every pour and every record is built from. */
export interface BoardCopperInput {
  layerCount: PcbLayerCount;
  placements: ReadonlyArray<PcbPlacedPart>;
  /** `${placementId}|${padNumber}` → netId (authoritative schematic map). */
  padNetIds: ReadonlyMap<string, string>;
  freePads: ReadonlyArray<PcbFreePad>;
  traces: ReadonlyArray<PcbTrace>;
  vias: ReadonlyArray<PcbVia>;
}

/**
 * One net-bound pour's fill verdict. `pourIndex` in the item key
 * `pour:<layer>:<net>:<pourIndex>:<island>` is the position in the array these
 * come in, so the array must stay in pour (derivation) order.
 */
export interface BoardPourFill {
  layer: PcbCopperLayerId;
  netId: string;
  result: CopperFillResult;
}

export interface BoardConnectivityInput extends BoardCopperInput {
  /**
   * Filled pours (contract §9): connectivity NEVER runs the fill kernel itself,
   * so the copper it reasons about is provably the copper the caller shipped to
   * the artwork. Absent or empty ⇒ no pour nodes.
   */
  pours?: ReadonlyArray<BoardPourFill>;
}

/**
 * The ONE fill of every net-bound pour (contract §9). `records` is the caller's
 * already-built records for the SAME copper when it has them (DRC does); absent
 * ⇒ the kernel builds its own.
 */
export function buildBoardPourFills(
  copper: BoardCopperInput,
  fill: BoardFillInput,
  records?: CopperRecords,
): BoardPourFill[] {
  const fills: BoardPourFill[] = [];
  for (const pour of fill.pours) {
    const { netId, ...zoneParams } = pour;
    fills.push({
      layer: pour.layer,
      netId,
      result: buildCopperFillIslands({
        layerCount: copper.layerCount,
        outline: fill.outline,
        placements: copper.placements,
        traces: copper.traces,
        vias: copper.vias,
        padNetIds: copper.padNetIds,
        copperToBoardEdgeMm: fill.designRules.clearance.copperToBoardEdgeMm,
        copperToHoleMm: copperToHoleClearanceMm(fill.designRules),
        cutouts: fill.cutouts ?? [],
        freeHoles: fill.freeHoles ?? [],
        freePads: copper.freePads,
        ...(records ? { records } : {}),
        ...zoneParams,
        pourNetId: netId,
      }),
    });
  }
  return fills;
}

/**
 * Pour nodes from ALREADY-filled pours. A `failed` pour carries no islands
 * (contract §8), so it contributes no node and the graph reports the open —
 * `checks/copper-pour.ts` is what turns the failure itself into
 * `ZONE_FILL_FAILED`.
 */
function pourItems(pours: ReadonlyArray<BoardPourFill>): CopperItem[] {
  const items: CopperItem[] = [];
  for (const [pourIndex, pour] of pours.entries()) {
    // Island index = position in the kernel's own total order, so a pour node's
    // key never depends on clipper's internal ordering (contract §6). The pour
    // ordinal keeps two pours of the same net+layer from claiming the same key.
    pour.result.islands.forEach((island, index) => {
      items.push(
        pourCopperItem({
          layer: pour.layer,
          netId: pour.netId,
          pourIndex,
          index,
          rings: island.rings,
          memberKeys: island.memberKeys,
        }),
      );
    });
  }
  return items;
}

/** The copper records of a board's primitives — one build, shared. */
export function boardCopperRecords(input: BoardCopperInput): CopperRecords {
  return buildCopperRecords({
    layerCount: input.layerCount,
    placements: input.placements,
    padNetIds: input.padNetIds,
    freePads: input.freePads,
    traces: input.traces,
    vias: input.vias,
  });
}

/** Every piece of copper on the board as a connectivity-graph node. */
export function buildBoardCopperItems(
  input: BoardConnectivityInput,
): CopperItem[] {
  return [
    ...toCopperItems(boardCopperRecords(input)),
    ...pourItems(input.pours ?? []),
  ];
}

/**
 * Items, components, and the RECORDS the items came from. The records are part
 * of the result because items are lossy by design: degenerate copper (a zero-
 * area pad ring) produces no item, and a consumer that reasons about logical
 * pins — the ratsnest — must still see that pin, or a two-pad net silently
 * becomes a one-pad net and its open is never reported (contract §2).
 */
export function computeBoardConnectivity(input: BoardConnectivityInput): {
  items: CopperItem[];
  result: ConnectivityResult;
  records: CopperRecords;
} {
  const records = boardCopperRecords(input);
  const items = [...toCopperItems(records), ...pourItems(input.pours ?? [])];
  return { items, result: computeConnectivity(items), records };
}
