/**
 * The ONE composition of an effective copper zone plus the board design rules
 * into fill-kernel parameters (S3a contract §6, copper-pour contract §2). Every
 * fill call site — the projection's ratsnest pours, connectivity, DRC, the
 * copper-pour check, the board snapshot, Gerber and the canvas / 3D — goes
 * through this helper, so the tighten-only rules for clearance and minimum
 * width, the precedence exclusions, the zone holes and the thermal / island
 * defaults live in exactly one place.
 *
 * Overrides are TIGHTEN-ONLY: a zone can never pour closer than the board rule
 * allows, nor produce copper thinner than the board minimum.
 */
import type {
  DrcPairKind,
  PcbBoardSettings,
  PcbCopperLayerId,
  PcbDesignRules,
  PcbPointMm,
  PcbZoneIslandRemoval,
  PcbZonePadConnection,
} from "../../sdks/designer";
import { copperLayersForCount } from "../../sdks/designer";
import { createRuleResolver, type RuleResolver } from "../drc/rule-resolver";
import type { EffectiveCopperZone, EffectiveKeepout } from "./copper-zones";

/**
 * The zone-derived slice of `CopperFillPourParams`. Spread it over a call
 * site's board-wide params (outline, layer count, placements, traces, vias, pad
 * nets, cutouts, free holes/pads, `copperToBoardEdgeMm`) to get a complete pour.
 */
export interface ZonePourParams {
  layer: PcbCopperLayerId;
  /** `null` = net-less copper: keeps clearance to every net, joins no net. */
  pourNetId: string | null;
  /**
   * The zone author's own minimum (`zone.clearanceMm ?? 0`) — a floor under
   * `clearanceForItem`, never the board tier. Since S6 the board tier is the
   * per-pair-kind implicit tier of the rule resolver (rule-semantics §6), so
   * there is no board component left to fold in here.
   */
  clearanceMm: number;
  /** Per-obstacle clearance (rule-semantics contract §6). */
  clearanceForItem: (item: ZonePourObstacle) => number;
  minThicknessMm: number;
  padConnection: PcbZonePadConnection;
  islandRemoval?: PcbZoneIslandRemoval;
  thermalReliefGapMm?: number;
  thermalSpokeWidthMm?: number;
  /** Absent for a board zone (the whole inset board is fillable). */
  clipPolygonMm?: ReadonlyArray<PcbPointMm>;
  /** Zone cutouts (§11) — removed from the extent exactly, clearance 0. */
  clipHolesMm?: ReadonlyArray<ReadonlyArray<PcbPointMm>>;
  /**
   * The other effective zones on this layer that carve this one (§3.3): a
   * different net, priority not below this zone's, with the mutual clearance.
   */
  excludeZonesMm?: ReadonlyArray<{
    pointsMm: ReadonlyArray<PcbPointMm>;
    clearanceMm: number;
  }>;
  /**
   * Keepout interiors removed from the extent (§4 `copperPour`): every
   * enabled keepout with `restrictions.copperPour` on this zone's layer.
   */
  excludePolygonsMm?: ReadonlyArray<ReadonlyArray<PcbPointMm>>;
}

/** One obstacle the fill clears, at the point its area membership is judged. */
export interface ZonePourObstacle {
  kind: "trace" | "pad" | "via";
  netId: string | null;
  /**
   * The net DRC judges this copper AS — its TIER net (electrical contract 13
   * §4.2). The halo resolves on THIS, so a null trace extending a 230 V pad is
   * carved at the 230 V spacing instead of at the null tier (Astra run 1 #2).
   */
  tierNetId: string | null;
  pointMm: PcbPointMm;
}

/** The pour pair kind an obstacle of each kind resolves under (§6). */
const POUR_KIND_BY_OBSTACLE: Record<ZonePourObstacle["kind"], DrcPairKind> = {
  trace: "pourToTrace",
  pad: "pourToPad",
  via: "pourToVia",
};

/**
 * CONSERVATIVE exposure for EVERY pour operand (electrical contract 13 §3.2).
 * The fill input carries no mask model, so on an OUTER layer the copper a pour
 * resolves against counts as uncovered and the pair lands in the IPC-2221 B2
 * column — the wider one in every band. The pour then carves at least as far as
 * the judge requires and never less; the judge alone, which has the artwork,
 * may apply B4. On an inner layer the column is B1 whatever this says.
 *
 * ONE expression for the obstacle halo AND the zone↔zone exclusion: they are
 * the same claim about the same missing mask model, and letting the two drift
 * put two 230 V zones 0.4 mm apart on a coated board while every obstacle on
 * that board was held at 1.25 mm.
 */
function pourExposedOn(layer: PcbCopperLayerId): boolean {
  return layer === "F.Cu" || layer === "B.Cu";
}

/**
 * The rule tier of the pour clearance — the SAME `RuleResolver` batch DRC
 * builds (rule-semantics contract §6), so the fill and the DRC cannot resolve
 * one pair differently. Built once per board and shared by every zone.
 */
export interface ZonePourNets {
  resolver: RuleResolver;
}

/**
 * The rule tier from a board's settings. `netNames` is passed separately
 * because the projection carries it as a record and the loader as a map.
 *
 * `validCopperLayers` is derived from the board's own `layerCount` rather than
 * taken as an argument, so no call site can build a pour against a different
 * stackup than the one it is pouring.
 */
export function zonePourNets(
  board: PcbBoardSettings,
  netNames: Record<string, string>,
): ZonePourNets {
  return {
    resolver: createRuleResolver(board, netNames, {
      validCopperLayers: copperLayersForCount(board.layerCount),
    }),
  };
}

/** Rings of the keepouts that forbid copper pour on `layer`. */
export function pourKeepoutRings(
  keepouts: ReadonlyArray<EffectiveKeepout>,
  layer: PcbCopperLayerId,
): PcbPointMm[][] {
  const rings: PcbPointMm[][] = [];
  for (const keepout of keepouts) {
    if (!keepout.enabled || !keepout.restrictions.copperPour) continue;
    if (!keepout.layers.includes(layer)) continue;
    rings.push(keepout.pointsMm.map((p) => ({ x: p.x, y: p.y })));
  }
  return rings;
}

/**
 * Zones of a DIFFERENT net on the same layer whose priority is not below this
 * zone's (copper-pour contract §3.3). Board zones carry priority −1 and have no
 * polygon, so they carve nobody and are carved by every explicit zone; equal
 * priority carves both ways and the contested band belongs to neither fill.
 * Computed from the immutable polygons, so the result never depends on the
 * order the zones are filled in.
 */
function zoneExclusions(
  zone: EffectiveCopperZone,
  zones: ReadonlyArray<EffectiveCopperZone>,
  nets: ZonePourNets,
): ZonePourParams["excludeZonesMm"] {
  const out: Array<{
    pointsMm: ReadonlyArray<PcbPointMm>;
    clearanceMm: number;
  }> = [];
  const exposed = pourExposedOn(zone.layer);
  for (const other of zones) {
    if (other.id === zone.id) continue;
    if (other.layer !== zone.layer) continue;
    // `null ≠` any id, two `null`s are equal — the same rule `isSameNetAsPour`
    // refuses to merge on, read here as "these two zones share a net".
    if (other.netId === zone.netId) continue;
    if (other.priority < zone.priority) continue;
    if (other.region.kind !== "polygon") continue;
    // Zone–zone is the `pourToPour` pair kind, symmetric by construction
    // (rule-semantics §6 rule 3): both zone authors' own minima, then the pair
    // value resolved with both area masks 0. `pointMm: null` is what says
    // "there is no evaluation point" — the other zone's copper is wherever its
    // fill ends up, so resolving at any point OF it (its centroid, say) would
    // make `c(Z, Z')` disagree with `c(Z', Z)` under an area-scoped rule. The
    // other zone's NET is still passed, so `net` / `netClass` scopes and its
    // class clearance all still participate.
    out.push({
      pointsMm: other.region.pointsMm,
      clearanceMm: Math.max(
        zone.clearanceMm ?? 0,
        other.clearanceMm ?? 0,
        nets.resolver.clearancePour("pourToPour", zone.layer, zone.netId, {
          netId: other.netId,
          pointMm: null,
          exposed,
        }).mm,
      ),
    });
  }
  return out;
}

/**
 * `keepouts`, `zones` and `nets` have NO defaults (§13.3): a consumer that
 * assembles a pour must pass the effective keepouts, the effective zone list
 * and the board's net classes of the SAME projection, or it does not compile.
 * A keepout the canvas draws but the Gerber ignores is a displayed-but-
 * unenforced rule; a missing zone list makes precedence disappear; a missing
 * net tier pours a 0.8 mm net class at 0.5 mm (Astra run 1 #1). The old
 * defaults made all three failures silent.
 */
export function pourParamsForZone(
  zone: EffectiveCopperZone,
  designRules: PcbDesignRules,
  keepouts: ReadonlyArray<EffectiveKeepout>,
  zones: ReadonlyArray<EffectiveCopperZone>,
  nets: ZonePourNets,
): ZonePourParams {
  const thermal = zone.thermal ?? null;
  const exclude = pourKeepoutRings(keepouts, zone.layer);
  const excludeZones = zoneExclusions(zone, zones, nets);
  const holes =
    zone.region.kind === "polygon" ? (zone.region.holesMm ?? []) : [];
  return {
    layer: zone.layer,
    pourNetId: zone.netId,
    clearanceMm: zone.clearanceMm ?? 0,
    clearanceForItem: zoneClearanceResolver(zone, nets),
    minThicknessMm: Math.max(
      designRules.minimums.traceWidthMm,
      zone.minWidthMm ?? 0,
    ),
    padConnection: zone.padConnection,
    ...(zone.islandRemoval === undefined
      ? {}
      : { islandRemoval: zone.islandRemoval }),
    // Absent ⇒ the kernel's own thermal defaults (contract §6).
    ...(thermal
      ? {
          thermalReliefGapMm: thermal.gapMm,
          thermalSpokeWidthMm: thermal.spokeWidthMm,
        }
      : {}),
    ...(zone.region.kind === "polygon"
      ? { clipPolygonMm: zone.region.pointsMm }
      : {}),
    ...(holes.length > 0 ? { clipHolesMm: holes } : {}),
    ...(excludeZones && excludeZones.length > 0
      ? { excludeZonesMm: excludeZones }
      : {}),
    ...(exclude.length > 0 ? { excludePolygonsMm: exclude } : {}),
  };
}

/**
 * `c(M) = max(Z.clearanceMm ?? 0, clearancePour(pourTo<kind>, L, N, M))`
 * (rule-semantics contract §6). `clearancePour` is already the max of the
 * masks-0 resolution and the resolution at the obstacle's point, so an area
 * RELAXATION around an obstacle never reaches a fill while an area TIGHTENING
 * widens its whole halo — a pour has no single evaluation point, and both
 * directions are conservative. Only a rule carrying an explicit pour
 * `pairKind` scope matches at all (§6 rule 1), so no rule written before S6
 * changes a fill.
 *
 * The implicit tier (the board's per-kind `pourToX`, i.e.
 * `max(pourToCopperMm ?? 0.5, traceToX)`, plus both nets' class clearance) and
 * the floor come from the resolver — there is no pour-local clearance formula
 * left.
 */
function zoneClearanceResolver(
  zone: EffectiveCopperZone,
  nets: ZonePourNets,
): (item: ZonePourObstacle) => number {
  const own = zone.clearanceMm ?? 0;
  const { resolver } = nets;
  // A pure function of the zone's LAYER, so it is constant over this resolver
  // and needs no place in the cache key below.
  const exposed = pourExposedOn(zone.layer);
  // With no area rules the resolution depends only on (kind, TIER net), and the
  // fill asks once per trace SEGMENT — memoise so a long polyline costs one
  // lookup. Keyed on the tier net, never the original: two obstacles with the
  // same null net and different tiers resolve to different halos (Astra run 1
  // #3).
  const cache = resolver.hasAreaRules ? null : new Map<string, number>();
  return (item) => {
    // Length-prefixed, as the resolver's own memo key is: a net id is free
    // text, and this cache decides how far copper stays from it.
    const tierNetId = item.tierNetId;
    const key = cache
      ? `${item.kind}|${tierNetId === null ? "-" : `${tierNetId.length}:${tierNetId}`}`
      : "";
    if (cache) {
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
    }
    const value = Math.max(
      own,
      resolver.clearancePour(
        POUR_KIND_BY_OBSTACLE[item.kind],
        zone.layer,
        zone.netId,
        { netId: tierNetId, pointMm: item.pointMm, exposed },
      ).mm,
    );
    if (cache) cache.set(key, value);
    return value;
  };
}

