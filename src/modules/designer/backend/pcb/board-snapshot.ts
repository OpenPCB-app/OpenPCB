// Serialize a PCB projection into a self-contained `BoardSnapshot` for the cloud
// auto-layout service (cloud-auto-layout, port 3002 — both /v1/route and /v1/place
// consume this one superset shape). Pure — derives everything from a single
// `DesignerPcbProjection` plus caller-supplied route/place options.
//
// UNITS (the #1 bug surface): `traces[].pointsNm` is integer NANOMETERS and is
// passed through verbatim (the store already holds nm); EVERYTHING else
// (outline, pads, vias, free holes, ratsnest) is MILLIMETERS. Do not convert
// here.
//
// Reuse: the pad → world-ring + layer + net derivation mirrors the DRC context
// (`drc-context.ts`) exactly, via the same `placementPads` / `padOutlineWorldMm`
// / `padNets` helpers, so the router sees the same copper the DRC does.

import type {
  BoardSnapshot,
  DesignerPcbProjection,
  ExistingTrace,
  FreeHole,
  PadOutline,
  PcbCopperLayerId,
  PcbDrillSlot,
  SnapshotCopperLayerId,
  PlaceOptions,
  RatsnestTarget,
  RouteOptions,
  SnapshotPlacement,
  ViaObstacle,
} from "../../../../sdks/designer";
import { DEFAULT_BOARD_THICKNESS_MM } from "../../../../sdks/designer";
import { resolveNetClassId } from "./net-class-resolver";
import { flattenCutout, flattenOutline } from "./outline-geometry";
import { placementPads } from "./pad-geometry";
import {
  freePadCopperLayers,
  placementSideLayer,
} from "../../../../shared/rendering/pad-copper-layers";
import {
  footprintPadDrill,
  freeHoleDrill,
  freePadDrill,
  type FootprintPadDrill,
} from "../../../../shared/rendering/pcb/pcb-drills";
import { freePadOutlineWorldMm, padOutlineWorldMm } from "./pad-outline";
import { buildSnapshotPourIslands } from "./board-snapshot-pours";
import { collectKeepouts } from "../../../../shared/pcb-areas/copper-zones";
import {
  placementCourtyardWorldMm,
  type RawFootprintLookup,
} from "./courtyard";

const STACKUP_ORDER: SnapshotCopperLayerId[] = [
  "F.Cu",
  "In1.Cu",
  "In2.Cu",
  "B.Cu",
];
const SNAPSHOT_LAYER_SET = new Set<string>(STACKUP_ORDER);

/** Wide desktop layer → snapshot layer, or null if outside the 2/4 stackup. */
function toSnapshotLayer(layer: string): SnapshotCopperLayerId | null {
  return SNAPSHOT_LAYER_SET.has(layer)
    ? (layer as SnapshotCopperLayerId)
    : null;
}
// Mirrors the service's `SCHEMA_VERSION` (cloud-auto-layout app/contracts/snapshot.py).
// Bump the minor version when a new optional field ships; the service treats
// schemaVersion as hash-neutral, so producer/consumer can drift on minors freely.
const SNAPSHOT_SCHEMA_VERSION = "1.0";
// [M7] Recommended production default: route 4 net-ordering variants and keep the
// best (the service runs them sequentially, picking the best by its objective —
// never worse than the single-pass baseline). A caller may override via routeOptions.
const DEFAULT_PORTFOLIO = 4;

function copperLayersForCount(count: 2 | 4): SnapshotCopperLayerId[] {
  return count === 4 ? [...STACKUP_ORDER] : ["F.Cu", "B.Cu"];
}

function copperLayerOf(layer: string): SnapshotCopperLayerId | null {
  return (STACKUP_ORDER as string[]).includes(layer)
    ? (layer as SnapshotCopperLayerId)
    : null;
}

/**
 * Round free holes / NPTH free pads that carry an oblong `drillSlot` degrade to a
 * round keepout sized to the slot's long axis, never the plain round `drillMm` —
 * a keepout at the round diameter would under-cover the slot's extended ends and
 * let the router cut into them. Conservative (over-keepout on the long axis);
 * flagged via `warnings` so the caller can surface it.
 */
function resolveHoleDrillMm(
  drillMm: number,
  drillSlot: PcbDrillSlot | null | undefined,
  sourceId: string,
  warnings: string[],
): number {
  if (!drillSlot || drillSlot.lengthMm <= drillMm) return drillMm;
  warnings.push(
    `Hole "${sourceId}" has an oblong drill (${drillSlot.lengthMm}mm slot, ${drillMm}mm round) — ` +
      `modeled as a ${drillSlot.lengthMm}mm round keepout (conservative; a round keepout at the ` +
      `nominal drill size could under-cover the slot ends).`,
  );
  return drillSlot.lengthMm;
}

/**
 * A footprint slot in the `PcbDrillSlot` shape `resolveHoleDrillMm` reads:
 * `lengthMm` is the OVERALL long dimension (the centreline span plus the tool
 * diameter) and `angleDeg` the centreline direction. Null for a round hit, so
 * the caller degrades nothing.
 */
function footprintSlotDescriptor(
  drill: FootprintPadDrill,
): PcbDrillSlot | null {
  if (!drill.slot) return null;
  const dx = drill.slot.b.x - drill.slot.a.x;
  const dy = drill.slot.b.y - drill.slot.a.y;
  return {
    lengthMm: Math.hypot(dx, dy) + drill.slot.widthMm,
    widthMm: drill.slot.widthMm,
    angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

/**
 * Project the library footprint's free-text `mountType` (KiCad importer / IPC-7351B
 * generator emit "smd" | "through_hole" | "virtual" | "unknown", case as authored) onto
 * the service's closed `"smd" | "tht"` vocabulary. Anything unrecognized (including
 * "virtual"/"unknown"/null) omits the field — the service falls back to its own
 * refdes-prefix heuristic.
 */
function normalizeMountType(raw: string | null | undefined): "smd" | "tht" | undefined {
  if (!raw) return undefined;
  switch (raw.trim().toLowerCase()) {
    case "smd":
      return "smd";
    case "tht":
    case "through_hole":
    case "through-hole":
      return "tht";
    default:
      return undefined;
  }
}

export interface BuildSnapshotOptions {
  routeOptions?: RouteOptions;
  /** Net-class ids to route. Defaults to every class on the board. */
  routableNetClassIds?: string[];
  excludedNetIds?: string[];
  /**
   * Engine options for cloud-auto-place. When present, emitted into the snapshot as
   * `placeOptions` (the autorouter ignores it). Omitted otherwise, so autoroute snapshots
   * keep their exact byte-shape.
   */
  placeOptions?: PlaceOptions;
  /** Serialize copper-pour islands into the snapshot. Default-off until service deploy flips. */
  serializePours?: boolean;
  /**
   * Optional raw-footprint lookup used to recover courtyard geometry for KiCad-imported
   * footprints, whose render model has it stripped at import (see ./courtyard.ts). Omit
   * for a projection-only build: courtyards then come from generated/drawn footprints
   * only, and the service falls back to its pad-hull proxy for the rest.
   */
  lookupRawFootprint?: RawFootprintLookup;
}

export interface BuildSnapshotResult {
  snapshot: BoardSnapshot;
  warnings: string[];
}

/**
 * Build a `BoardSnapshot` from a PCB projection. `warnings` carries
 * user-facing advisories (e.g. copper zones present — see below) the caller
 * surfaces in the autoroute dialog.
 */
export function buildBoardSnapshot(
  projection: DesignerPcbProjection,
  opts: BuildSnapshotOptions = {},
): BuildSnapshotResult {
  const { board } = projection;
  const warnings: string[] = [];

  // The cloud auto-layout service supports 2/4-layer stackups only; a wider
  // desktop board (P2) is clamped to 4 for the snapshot, and its extra inner
  // layers are not routed by the service. Honest, non-silent (a warning).
  const snapshotLayerCount: 2 | 4 = board.layerCount >= 4 ? 4 : 2;
  if (board.layerCount > 4) {
    warnings.push(
      `Board has ${board.layerCount} copper layers; cloud auto-layout supports 2/4 — routing only F.Cu/In1.Cu/In2.Cu/B.Cu.`,
    );
  }
  const validCopperLayers = copperLayersForCount(snapshotLayerCount);
  const padNets = projection.padNets ?? {};

  const routableNetClassIds =
    opts.routableNetClassIds ?? board.netClasses.map((c) => c.id);
  const routableSet = new Set(routableNetClassIds);
  const excludedSet = new Set(opts.excludedNetIds ?? []);

  // ── padOutlines (footprint + free pads) ────────────────────────────────
  // One entry per copper layer the pad occupies (through-hole spans all layers),
  // matching the DRC's pad model.
  const padOutlines: PadOutline[] = [];
  for (const placement of projection.placements) {
    const placementCopper = copperLayerOf(placement.layer) ?? "F.Cu";
    for (const pad of placementPads(placement)) {
      const isThroughHole = (pad.drillDiameterMm ?? 0) > 0;
      const layers: SnapshotCopperLayerId[] = isThroughHole
        ? validCopperLayers
        : [copperLayerOf(pad.layer ?? placement.layer) ?? placementCopper];
      const ring = padOutlineWorldMm(placement, pad);
      const netId = padNets[`${placement.id}|${pad.number}`] ?? null;
      const isConnectable = Boolean(pad.number);
      for (const layer of layers) {
        padOutlines.push({
          placementId: placement.id,
          padNumber: pad.number,
          netId,
          layer,
          ring,
          isConnectable,
        });
      }
    }
  }
  const freeHolesFromPads: FreeHole[] = [];
  // A NON-PLATED footprint drill is an obstacle the router must not cross,
  // exactly like a free hole (manufacturability contract 10 §8): mounting
  // holes and `np_thru_hole` pads reach the fab as bare walls. The ONE
  // derivation supplies the centre (drill offset applied) and the slot.
  for (const placement of projection.placements) {
    for (const pad of placementPads(placement)) {
      const drill = footprintPadDrill(pad, placement);
      if (!drill || drill.plated) continue;
      const id = `npth:${placement.id}|${pad.number}`;
      freeHolesFromPads.push({
        id,
        centerMm: drill.centerMm,
        drillMm: resolveHoleDrillMm(
          drill.drillMm,
          footprintSlotDescriptor(drill),
          id,
          warnings,
        ),
      });
    }
  }
  const validCopperLayerSet = new Set<PcbCopperLayerId>(validCopperLayers);
  for (const freePad of projection.freePads) {
    // Every NON-PLATED drill is a real obstacle, whatever the pad type says: an
    // `smd` / `conn` pad's drill reaches the fab as an NPTH hit exactly like a
    // `hole` pad's (contract 06 §2), so it comes from the ONE drill derivation
    // rather than from `padType`. The drilled opening is emitted as a free hole
    // so the router doesn't route straight through it.
    const drill = freePadDrill(freePad);
    if (drill && !drill.plated) {
      freeHolesFromPads.push({
        id: `free:${freePad.id}`,
        centerMm: freePad.centerMm,
        drillMm: resolveHoleDrillMm(
          drill.drillMm,
          freePad.drillSlot,
          `free:${freePad.id}`,
          warnings,
        ),
      });
    }
    // The ONE free-pad copper-layer model: `hole` carries no copper (no rings),
    // `std` spans the stackup, `smd` / `conn` occupy the one layer they declare.
    // A layer outside the snapshot's 2/4 stackup degrades to F.Cu as before.
    const { layers } = freePadCopperLayers(freePad, validCopperLayerSet);
    if (layers.length === 0) continue;
    const ring = freePadOutlineWorldMm(freePad);
    for (const layer of layers) {
      padOutlines.push({
        placementId: `free:${freePad.id}`,
        padNumber: freePad.id,
        netId: freePad.netId,
        layer: copperLayerOf(layer) ?? "F.Cu",
        ring,
        isConnectable: freePad.netId !== null,
      });
    }
  }

  // ── vias / traces / free holes (obstacles) ─────────────────────────────
  const vias: ViaObstacle[] = projection.vias.flatMap((v) => {
    if (v.viaType !== "through") {
      // The engine's ViaObstacle only models a through-span keepout — serialize it as
      // one anyway (unchanged shape) but flag the loss of blind/buried/micro topology
      // so the desktop can surface it before the user applies the route.
      warnings.push(
        `Via "${v.id}" is a ${v.viaType} via — the autorouter models it as a ` +
          `through-span obstacle (${v.fromLayer}→${v.toLayer}); it will not route ` +
          `through the via's actual span.`,
      );
    }
    const fromLayer = toSnapshotLayer(v.fromLayer);
    const toLayer = toSnapshotLayer(v.toLayer);
    if (fromLayer === null || toLayer === null) return [];
    return [
      {
        id: v.id,
        netId: v.netId,
        centerMm: v.centerMm,
        diameterMm: v.diameterMm,
        drillMm: v.drillMm,
        fromLayer,
        toLayer,
        isHoleOnly: false,
      },
    ];
  });

  const traces: ExistingTrace[] = projection.traces.flatMap((t) => {
    const layer = toSnapshotLayer(t.layer);
    if (layer === null) return [];
    return [
      {
        id: t.id,
        netId: t.netId,
        netClassId: t.netClassId,
        layer,
        widthMm: t.widthMm,
        pointsNm: t.pointsNm.map((p) => ({ x: p.x, y: p.y })), // already nm
        segmentMode: t.segmentMode,
      },
    ];
  });

  const freeHoles: FreeHole[] = [
    // THE one free-hole derivation: the tool is the slot width whenever a slot
    // is declared (contract 10 §1.1); the slot still degrades to its long axis
    // for the round keepout the wire contract carries.
    ...projection.freeHoles.flatMap((h) => {
      const drill = freeHoleDrill(h);
      if (!drill) return [];
      return [
        {
          id: h.id,
          centerMm: drill.centerMm,
          drillMm: resolveHoleDrillMm(drill.drillMm, h.drillSlot, h.id, warnings),
        },
      ];
    }),
    ...freeHolesFromPads,
  ];

  // ── ratsnest targets (filtered to routable, minus excluded) ────────────
  const selectedRatsnest = projection.ratsnest.filter(
    (seg) => routableSet.has(seg.netClassId) && !excludedSet.has(seg.netId),
  );
  // The generated `RatsnestTarget` contract carries footprint-pad endpoints
  // only, so a free-pad-anchored airwire cannot be expressed — drop it and say
  // so rather than inventing a placement id.
  const ratsnest: RatsnestTarget[] = selectedRatsnest.flatMap((seg) =>
    seg.from.kind === "pad" && seg.to.kind === "pad"
      ? [
          {
            netId: seg.netId,
            netClassId: seg.netClassId,
            fromMm: seg.fromMm,
            toMm: seg.toMm,
            fromPlacementId: seg.from.placementId,
            fromPadNumber: seg.from.padNumber,
            toPlacementId: seg.to.placementId,
            toPadNumber: seg.to.padNumber,
          },
        ]
      : [],
  );
  const droppedFreePadTargets = selectedRatsnest.length - ratsnest.length;
  if (droppedFreePadTargets > 0) {
    warnings.push(
      `${droppedFreePadTargets} airwire(s) anchored on free pads were not sent to the autorouter (the cloud target schema carries footprint pads only).`,
    );
  }

  // ── net-class assignments (pre-resolve every known net) ────────────────
  const netAssignments: Record<string, string> = {};
  for (const [netId, name] of Object.entries(projection.netNames)) {
    netAssignments[netId] = resolveNetClassId(
      name,
      board.netClasses,
      board.perNetClassAssignments,
      netId,
    );
  }

  let courtyardCount = 0;
  const placements: SnapshotPlacement[] = projection.placements.map((p) => {
    const mountType = normalizeMountType(p.footprint.mountType);
    const courtyard = placementCourtyardWorldMm(p, opts.lookupRawFootprint);
    if (courtyard) courtyardCount += 1;
    return {
      id: p.id,
      reference: p.reference,
      // A component sits on an OUTER layer — the contract's `Placement.layer` is
      // `F.Cu | B.Cu`, narrower than the copper vocabulary used for pads, traces and
      // vias. `placementSideLayer` is the ONE resolution of that side (zone/keepout
      // contract §13.4); anything else (a corrupt projection, an inner-layer value)
      // resolves to the front rather than emitting a value the service would reject.
      layer: placementSideLayer(p),
      // Pass through the current transform for cloud-auto-place (the autorouter ignores
      // these). positionMm is the footprint origin; rotationDeg may be non-cardinal.
      positionMm: p.positionMm,
      rotationDeg: p.rotationDeg,
      mirrored: p.mirrored,
      // AUTHORITATIVE mount-type hint for cloud-auto-place's flip-eligibility/THT logic
      // (falls back to its own refdes heuristic when omitted — see snapshot.py Placement).
      ...(mountType ? { mountType } : {}),
      // Real courtyard when the footprint has one; absent otherwise, so the service uses
      // its pad-hull proxy rather than a courtyard we invented.
      ...(courtyard ? { courtyardPolygon: courtyard } : {}),
    };
  });
  // Only meaningful for a placement run: the router never reads courtyards, so warning on
  // a route-only snapshot would be noise on every board.
  if (opts.placeOptions && projection.placements.length > 0 && courtyardCount === 0) {
    warnings.push(
      "No footprint courtyards available — cloud placement approximates each component " +
        "from its pad hull. KiCad-imported footprints drop courtyard layers at import.",
    );
  }

  const pours = opts.serializePours
    ? buildSnapshotPourIslands(projection, warnings)
    : [];
  // Not "the router can't use pours" (Phase 5 pour-aware routing ships) — this call
  // simply didn't send them, e.g. `serializePours` was off by explicit request, or the
  // routes.ts caller's capability negotiation resolved to `false` (see that file's
  // autoroute handler). Callers deciding the default should check the service's
  // GET /v1/version `capabilities.pours.accepted` rather than assuming this is permanent.
  if (!opts.serializePours && projection.zones.length > 0) {
    warnings.push(
      `Design has ${projection.zones.length} copper ${
        projection.zones.length === 1 ? "zone" : "zones"
      } — pours were not sent to the autorouter for this request. Routing ignores them; you may need to re-pour after applying.`,
    );
  }
  // Keepouts are still not part of the wire contract (§13.5) — the autorouter
  // never sees them and cannot honour them, so say so rather than letting a rule
  // area look enforced. The apply-time DRC report now surfaces `KEEPOUT_VIOLATION`
  // for a cloud route, which stays non-gating like every apply path.
  const keepoutCount = collectKeepouts({
    keepouts: projection.keepouts,
    layerCount: projection.board.layerCount,
  }).keepouts.length;
  if (keepoutCount > 0) {
    warnings.push(
      keepoutCount === 1
        ? "1 keepout is not sent to the autorouter; routing ignores it."
        : `${keepoutCount} keepouts are not sent to the autorouter; routing ignores them.`,
    );
  }
  if (ratsnest.length === 0) {
    warnings.push("No unrouted nets match the selected net classes.");
  }

  const snapshot: BoardSnapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    designId: projection.designId,
    baseRevision: projection.revision,
    board: {
      outline: [flattenOutline(board.outline)],
      cutouts: (board.cutouts ?? []).map((c) => flattenCutout(c.shape)),
      copperToEdgeMm: board.designRules.clearance.copperToBoardEdgeMm,
    },
    stackup: {
      layerCount: snapshotLayerCount,
      copperLayers: validCopperLayers,
      boardThicknessMm: board.boardThicknessMm ?? DEFAULT_BOARD_THICKNESS_MM,
    },
    designRules: {
      // Strip the desktop-only S6 keys the same way the net classes below
      // strip theirs: `ClearanceRules` / `MinimumRules` in the vendored
      // `board-snapshot.generated.ts` declare neither, and the wire schema is
      // byte-stable. The cloud router routes at the implicit tier and never
      // sees scoped rules or the clearance floor; the desktop re-validates
      // with the full resolver on apply (rule-semantics contract §13, §9).
      clearance: (({
        pourToCopperMm: _pour,
        copperToHoleMm: _hole,
        ...clearance
      }) => clearance)(board.designRules.clearance),
      minimums: (({ clearanceMm: _floor, ...minimums }) => minimums)(
        board.designRules.minimums,
      ),
      fabPresetId: board.fabricator,
    },
    // Strip desktop-only routing hints (diff-pair gap) — the cloud wire
    // schema (SnapshotNetClass) is byte-stable and pinned by assert types.
    netClasses: board.netClasses.map(
      ({
        diffPairGapMm: _gap,
        voltageV: _v,
        currentA: _i,
        ...netClass
      }) => netClass,
    ),
    netAssignments,
    routableNetClassIds,
    excludedNetIds: opts.excludedNetIds ?? [],
    placements,
    padOutlines,
    vias,
    traces,
    pours,
    freeHoles,
    ratsnest,
    netNames: projection.netNames,
    // Default to the portfolio production default; any caller-supplied option wins.
    options: { portfolio: DEFAULT_PORTFOLIO, ...(opts.routeOptions ?? {}) },
    // Only emitted for auto-place requests; the autorouter ignores it and an absent
    // field keeps the autoroute snapshot byte-shape unchanged.
    ...(opts.placeOptions ? { placeOptions: opts.placeOptions } : {}),
  };

  return { snapshot, warnings };
}
