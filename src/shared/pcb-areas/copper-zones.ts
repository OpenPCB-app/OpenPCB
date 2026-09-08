/**
 * The ONE derivation of "which copper areas exist" (zone/keepout contract
 * §3.1) and its keepout twin. Every consumer — projection, connectivity, DRC,
 * fill, Gerber, snapshot, canvas, 3D — reads this list instead of assembling
 * its own, so the board-zone policy and the override resolution live in
 * exactly one place.
 *
 * Since S3b it reads persisted zone rows ONLY: the per-layer copper fill is a
 * persisted board zone row (`region: { kind: "board" }`, id `board:<layer>`),
 * not a view-state toggle, so there is no view-state input and no legacy
 * board-fill policy to keep in sync.
 *
 * Pure and deterministic: two calls with the same values (permuted input
 * included) return deep-equal output.
 */
import type {
  PcbCopperLayerId,
  PcbKeepout,
  PcbLayerCount,
  PcbZone,
  PcbZoneIslandRemoval,
  PcbZonePadConnection,
  PcbZoneRegion,
} from "../../sdks/designer";
import { copperLayersForCount } from "../../sdks/designer";
import { canonicalizeRing, ensureCcwRing } from "../pcb-geometry/ring-utils";
import {
  isZoneHoleInvalidity,
  zoneRegionValidity,
  zoneRingValidity,
} from "./zone-parse";

export type CopperAreaWarningCode =
  | "zone_layer_off_stackup"
  | "zone_ring_invalid"
  | "zone_hole_invalid"
  | "zone_net_unresolved"
  | "zone_net_stale"
  | "zone_board_id_mismatch"
  | "zone_id_reserved"
  | "zone_id_duplicate"
  | "board_zone_no_net"
  | "keepout_layer_off_stackup"
  | "keepout_ring_invalid"
  | "keepout_id_duplicate";

export interface CopperAreaWarning {
  code: CopperAreaWarningCode;
  /** Zone or keepout id the warning is about. */
  id: string | null;
  detail: string;
}

/**
 * A copper area that actually pours, with every default resolved. `region`,
 * `thermal` and `islandRemoval` ALIAS the input row's objects (the derivation
 * copies nothing); consumers must treat them as read-only.
 */
export interface EffectiveCopperZone {
  id: string;
  sourceKind: "board" | "zone";
  name: string | null;
  layer: PcbCopperLayerId;
  netId: string | null;
  region: PcbZoneRegion;
  priority: number;
  padConnection: PcbZonePadConnection;
  /**
   * RAW zone overrides, not yet composed with the board rules — feed them to
   * `pourParamsForZone` (which applies the §6 `max(board, zone)` rule); never
   * pass them to the fill kernel directly.
   */
  clearanceMm?: number | null;
  minWidthMm?: number | null;
  thermal?: { gapMm: number; spokeWidthMm: number } | null;
  islandRemoval?: PcbZoneIslandRemoval;
}

/** A keepout that actually restricts: layers on the stackup, ring canonical. */
export type EffectiveKeepout = PcbKeepout;

/** Board zones rank below every explicit zone, whose priority is an integer ≥ 0. */
const BOARD_ZONE_PRIORITY = -1;

/** Reserved id prefix: only a board row may carry it (§3.1). */
export const BOARD_ZONE_ID_PREFIX = "board:";

/** The one id a board zone on `layer` may have. Derived, never client-chosen. */
export function boardZoneId(layer: PcbCopperLayerId): string {
  return `${BOARD_ZONE_ID_PREFIX}${layer}`;
}

/** The constant pad-connection default (§6); there is no board-level setting. */
export const BOARD_PAD_CONNECTION: PcbZonePadConnection = "solid";

export interface CollectCopperZonesInput {
  zones: readonly PcbZone[];
  layerCount: PcbLayerCount;
  /**
   * The schematic's net ids. REQUIRED since S4 (§13.3): a zone whose persisted
   * `netId` names no current net is UNBOUND (pours nothing, `zone_net_stale`)
   * instead of pouring a phantom net (§3.2). Mandatory so a consumer cannot
   * silently pour a net the schematic dropped; pass an empty set only when the
   * board genuinely has no nets.
   */
  knownNetIds: ReadonlySet<string>;
}

export interface CollectCopperZonesResult {
  zones: EffectiveCopperZone[];
  warnings: CopperAreaWarning[];
}

/**
 * Code-unit order, never `localeCompare`: the derivation must sort identically
 * on every machine (pour keys and Gerber order depend on it).
 */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `""` is not a net id: treat it exactly like `null` (§3.2 has only set / null). */
function netIdOrNull(value: string | null | undefined): string | null {
  return value ? value : null;
}

/** A zone naming a net that no schematic net resolves pours nothing (§3.2). */
function isNetUnbound(netId: string | null, netName: string | null): boolean {
  return netId === null && netName !== null && netName.trim() !== "";
}

/** Integer ≥ 0 whatever the producer wrote (NaN / Infinity would break the total order). */
function normalisePriority(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function compareWarnings(a: CopperAreaWarning, b: CopperAreaWarning): number {
  return (
    compareIds(a.code, b.code) ||
    compareIds(a.id ?? "", b.id ?? "") ||
    compareIds(a.detail, b.detail)
  );
}

/** Ids that appear more than once among the enabled input rows (zones or keepouts). */
function duplicateIds(
  rows: readonly { id: string; enabled: boolean }[],
): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const row of rows) {
    if (!row.enabled) continue;
    if (seen.has(row.id)) dup.add(row.id);
    seen.add(row.id);
  }
  return dup;
}

/** The raw (uncomposed) override fields, present only when the row carries them. */
function rawOverrides(
  zone: PcbZone,
): Pick<
  EffectiveCopperZone,
  "clearanceMm" | "minWidthMm" | "thermal" | "islandRemoval"
> {
  return {
    ...(zone.clearanceMm === undefined ? {} : { clearanceMm: zone.clearanceMm }),
    ...(zone.minWidthMm === undefined ? {} : { minWidthMm: zone.minWidthMm }),
    ...(zone.thermal === undefined ? {} : { thermal: zone.thermal }),
    ...(zone.islandRemoval === undefined
      ? {}
      : { islandRemoval: zone.islandRemoval }),
  };
}

export function collectCopperZones(
  input: CollectCopperZonesInput,
): CollectCopperZonesResult {
  const stackup = copperLayersForCount(input.layerCount);
  const stackupIndex = new Map<PcbCopperLayerId, number>(
    stackup.map((layer, index) => [layer, index]),
  );
  const warnings: CopperAreaWarning[] = [];
  const explicit: EffectiveCopperZone[] = [];
  const board: EffectiveCopperZone[] = [];
  const duplicates = duplicateIds(input.zones);
  const reportedDuplicates = new Set<string>();

  for (const zone of input.zones) {
    if (!zone.enabled) continue;
    // Ids are the sort tie-breaker and the snapshot / violation anchor: a
    // duplicated id makes the order input-dependent (and two board rows on one
    // layer collide here). Every holder drops — fail-closed, no copper.
    if (duplicates.has(zone.id)) {
      if (!reportedDuplicates.has(zone.id)) {
        reportedDuplicates.add(zone.id);
        warnings.push({
          code: "zone_id_duplicate",
          id: zone.id,
          detail: "Zone id is not unique; every zone with this id is skipped.",
        });
      }
      continue;
    }

    const netId = netIdOrNull(zone.netId);

    if (zone.region.kind === "board") {
      // The id is derived from the layer, so a row that disagrees with its own
      // layer would let two board rows coexist on one layer.
      if (zone.id !== boardZoneId(zone.layer)) {
        warnings.push({
          code: "zone_board_id_mismatch",
          id: zone.id,
          detail: `Board zone on ${zone.layer} must have the id "${boardZoneId(zone.layer)}".`,
        });
        continue;
      }
      if (!stackupIndex.has(zone.layer)) {
        warnings.push({
          code: "zone_layer_off_stackup",
          id: zone.id,
          detail: `Zone layer ${zone.layer} is not on a ${input.layerCount}-layer stackup.`,
        });
        continue;
      }
      if (netId !== null && !input.knownNetIds.has(netId)) {
        warnings.push({
          code: "zone_net_stale",
          id: zone.id,
          detail: `Zone net id "${netId}" names no current schematic net.`,
        });
        continue;
      }
      if (isNetUnbound(netId, zone.netName)) {
        warnings.push({
          code: "zone_net_unresolved",
          id: zone.id,
          detail: `Zone net "${zone.netName ?? ""}" does not resolve to a schematic net.`,
        });
        continue;
      }
      if (netId === null) {
        // Nobody draws a board plane meaning "net-less copper" — an unset net
        // is an unfinished edit, so the plane pours nothing (§3.1).
        warnings.push({
          code: "board_zone_no_net",
          id: zone.id,
          detail: `Copper fill is enabled on ${zone.layer} but no net is assigned; it pours nothing.`,
        });
        continue;
      }
      board.push({
        id: zone.id,
        sourceKind: "board",
        name: zone.name,
        layer: zone.layer,
        netId,
        region: zone.region,
        // Forced, whatever the row says: explicit priorities are integers ≥ 0.
        priority: BOARD_ZONE_PRIORITY,
        padConnection: zone.padConnection ?? BOARD_PAD_CONNECTION,
        ...rawOverrides(zone),
      });
      continue;
    }

    if (zone.id.startsWith(BOARD_ZONE_ID_PREFIX)) {
      warnings.push({
        code: "zone_id_reserved",
        id: zone.id,
        detail: "Zone ids starting with \"board:\" are reserved for board zones.",
      });
      continue;
    }
    if (netId !== null && !input.knownNetIds.has(netId)) {
      warnings.push({
        code: "zone_net_stale",
        id: zone.id,
        detail: `Zone net id "${netId}" names no current schematic net.`,
      });
      continue;
    }
    if (!stackupIndex.has(zone.layer)) {
      warnings.push({
        code: "zone_layer_off_stackup",
        id: zone.id,
        detail: `Zone layer ${zone.layer} is not on a ${input.layerCount}-layer stackup.`,
      });
      continue;
    }
    // Outer ring AND cutouts (copper-pour contract §11) — a region we cannot
    // subtract exactly would pour more copper than drawn, so it is refused,
    // never repaired by dropping the offending hole.
    const validity = zoneRegionValidity(zone.region);
    if (validity !== "ok") {
      warnings.push(
        isZoneHoleInvalidity(validity)
          ? {
              code: "zone_hole_invalid",
              id: zone.id,
              detail: `Zone cutout is invalid (${validity}).`,
            }
          : {
              code: "zone_ring_invalid",
              id: zone.id,
              detail: `Zone outline is invalid (${validity}).`,
            },
      );
      continue;
    }
    if (isNetUnbound(netId, zone.netName)) {
      warnings.push({
        code: "zone_net_unresolved",
        id: zone.id,
        detail: `Zone net "${zone.netName ?? ""}" does not resolve to a schematic net.`,
      });
      continue;
    }
    explicit.push({
      id: zone.id,
      sourceKind: "zone",
      name: zone.name,
      layer: zone.layer,
      netId,
      region: zone.region,
      priority: normalisePriority(zone.priority),
      padConnection: zone.padConnection ?? BOARD_PAD_CONNECTION,
      ...rawOverrides(zone),
    });
  }

  explicit.sort((a, b) =>
    a.priority === b.priority
      ? compareIds(a.id, b.id)
      : b.priority - a.priority,
  );
  // Board zones rank below every explicit zone and among themselves follow the
  // stackup, not the row order the store happened to return.
  board.sort(
    (a, b) => (stackupIndex.get(a.layer) ?? 0) - (stackupIndex.get(b.layer) ?? 0),
  );

  warnings.sort(compareWarnings);
  return { zones: [...explicit, ...board], warnings };
}

export interface CollectKeepoutsInput {
  keepouts: readonly PcbKeepout[];
  layerCount: PcbLayerCount;
}

export interface CollectKeepoutsResult {
  keepouts: EffectiveKeepout[];
  warnings: CopperAreaWarning[];
}

export function collectKeepouts(
  input: CollectKeepoutsInput,
): CollectKeepoutsResult {
  const stackup = copperLayersForCount(input.layerCount);
  const warnings: CopperAreaWarning[] = [];
  const keepouts: EffectiveKeepout[] = [];
  const duplicates = duplicateIds(input.keepouts);
  const reportedDuplicates = new Set<string>();

  for (const keepout of input.keepouts) {
    if (!keepout.enabled) continue;
    // Same rule as zones: a duplicated id would make two violations share one
    // id (one waiver silencing both). Every holder drops — fail-closed for the
    // copper, and the drop itself is reported as ZONE_INVALID (§13.2).
    if (duplicates.has(keepout.id)) {
      if (!reportedDuplicates.has(keepout.id)) {
        reportedDuplicates.add(keepout.id);
        warnings.push({
          code: "keepout_id_duplicate",
          id: keepout.id,
          detail: "Keepout id is not unique; every keepout with this id is skipped.",
        });
      }
      continue;
    }
    const validity = zoneRingValidity(keepout.pointsMm);
    if (validity !== "ok") {
      warnings.push({
        code: "keepout_ring_invalid",
        id: keepout.id,
        detail: `Keepout outline is invalid (${validity}).`,
      });
      continue;
    }
    const layers = stackup.filter((layer) => keepout.layers.includes(layer));
    if (layers.length === 0) {
      warnings.push({
        code: "keepout_layer_off_stackup",
        id: keepout.id,
        detail: `No keepout layer is on a ${input.layerCount}-layer stackup.`,
      });
      continue;
    }
    keepouts.push({
      ...keepout,
      layers,
      // One orientation for every effective ring: the fill subtracts the
      // keepouts as one set, and two opposite-winding rings would cancel each
      // other where they overlap (Astra S4 #1 — copper inside both keepouts).
      pointsMm: [...ensureCcwRing(canonicalizeRing(keepout.pointsMm))],
    });
  }

  keepouts.sort((a, b) => compareIds(a.id, b.id));
  warnings.sort(compareWarnings);
  return { keepouts, warnings };
}
