import type {
  DrcAnchor,
  PcbCopperLayerId,
  PcbPointMm,
} from "../../../../../sdks/designer";
import type {
  CopperAreaWarning,
  CopperAreaWarningCode,
  EffectiveCopperZone,
} from "../../../../../shared/pcb-areas";
import { ringsOverlapPositiveArea } from "../../../../../shared/pcb-geometry/area-overlap";
import {
  boundsMeet,
  boundsOfPoints,
  type RingBounds,
} from "../../../../../shared/pcb-geometry/region-rings";
import { canonicalizeRing } from "../../../../../shared/pcb-geometry/ring-utils";
import { GEOM_EPS_MM } from "../../../../../shared/pcb-geometry/tolerance";
import type { DrcContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";
import { zoneDisplayName } from "../zone-label";

/**
 * `ZONE_INVALID`, `ZONE_EMPTY_FILL` (net reasons) and `ZONE_OVERLAP` — the
 * structural half of the S4 legality integration (zone/keepout contract §13.1).
 *
 * DRC consumes the ONE derivation and never re-derives: the first two codes are
 * a total mapping of `CopperAreaWarningCode`, taken from the warnings the DRC
 * context's single `collectCopperZones` / `collectKeepouts` call produced. The
 * fill-side half of `ZONE_EMPTY_FILL` (an effective zone that pours no island)
 * lives in `checks/copper-pour.ts`, which already runs the fill per zone.
 */

/**
 * §13.2. TOTAL over the union on purpose: a new derivation warning must be
 * assigned to one of the two codes here, or this file stops compiling.
 */
const WARNING_KIND: Record<CopperAreaWarningCode, "invalid" | "empty"> = {
  zone_layer_off_stackup: "invalid",
  zone_ring_invalid: "invalid",
  zone_hole_invalid: "invalid",
  zone_board_id_mismatch: "invalid",
  zone_id_reserved: "invalid",
  zone_id_duplicate: "invalid",
  keepout_layer_off_stackup: "invalid",
  keepout_ring_invalid: "invalid",
  keepout_id_duplicate: "invalid",
  zone_net_unresolved: "empty",
  zone_net_stale: "empty",
  board_zone_no_net: "empty",
};

/** A `keepout_*` warning is about a keepout row; everything else is a zone. */
function isKeepoutWarning(code: CopperAreaWarningCode): boolean {
  return code.startsWith("keepout_");
}

interface WarningSite {
  anchor: DrcAnchor;
  layer?: PcbCopperLayerId;
  locationMm: PcbPointMm;
}

/**
 * Where a refused row sits: its own layer and the first vertex of its ring when
 * the projection still holds the row, else the board outline (a board zone has
 * no ring, and a row can only be missing if it was never persisted).
 */
function warningSite(
  ctx: DrcContext,
  warning: CopperAreaWarning & { id: string },
): WarningSite {
  const fallback = ctx.outlineRing[0] ?? { x: 0, y: 0 };
  // An off-stackup row's own layer is, by construction, not a layer of this
  // board; hashing it into the id would rotate the id when the stackup grows
  // even though the row never changed. Such a violation carries no layer.
  const offStackup =
    warning.code === "zone_layer_off_stackup" ||
    warning.code === "keepout_layer_off_stackup";
  // A duplicated id names SEVERAL rows, possibly on different layers; picking
  // the first one would make the id depend on row order (Astra S4 #4). Such a
  // violation carries no layer and sits at the board outline.
  const duplicate =
    warning.code === "zone_id_duplicate" ||
    warning.code === "keepout_id_duplicate";
  if (duplicate) {
    return {
      anchor: isKeepoutWarning(warning.code)
        ? { kind: "keepout", keepoutId: warning.id }
        : { kind: "zone", zoneId: warning.id },
      locationMm: fallback,
    };
  }
  if (isKeepoutWarning(warning.code)) {
    const keepout = (ctx.projection.keepouts ?? []).find(
      (k) => k.id === warning.id,
    );
    return {
      anchor: { kind: "keepout", keepoutId: warning.id },
      ...(!offStackup && keepout?.layers[0]
        ? { layer: keepout.layers[0] }
        : {}),
      locationMm: keepout?.pointsMm[0] ?? fallback,
    };
  }
  const zone = ctx.projection.zones.find((z) => z.id === warning.id);
  const ring =
    zone?.region.kind === "polygon" ? zone.region.pointsMm[0] : undefined;
  return {
    anchor: { kind: "zone", zoneId: warning.id },
    ...(!offStackup && zone ? { layer: zone.layer } : {}),
    locationMm: ring ?? fallback,
  };
}

function warningDrafts(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  for (const warning of ctx.copperAreaWarnings) {
    // Every warning the derivation emits today carries the offending row's id;
    // an id-less one would anchor nothing, so it is skipped rather than
    // reported against the board (§13.1).
    if (warning.id === null) continue;
    const site = warningSite(ctx, { ...warning, id: warning.id });
    if (WARNING_KIND[warning.code] === "invalid") {
      out.push({
        code: "ZONE_INVALID",
        ruleClass: "structural",
        message: warning.detail,
        anchors: [site.anchor],
        locationMm: site.locationMm,
        ...(site.layer ? { layer: site.layer } : {}),
      });
      continue;
    }
    out.push({
      code: "ZONE_EMPTY_FILL",
      ruleClass: "structural",
      message: warning.detail,
      anchors: [site.anchor],
      locationMm: site.locationMm,
      ...(site.layer ? { layer: site.layer } : {}),
    });
  }
  return out;
}

/** Centre of the two AABBs' intersection rectangle — symmetric in a and b. */
function boundsIntersectionCenter(a: RingBounds, b: RingBounds): PcbPointMm {
  const minX = Math.max(a.minX, b.minX);
  const maxX = Math.min(a.maxX, b.maxX);
  const minY = Math.max(a.minY, b.minY);
  const maxY = Math.min(a.maxY, b.maxY);
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

interface OverlapCandidate {
  zone: EffectiveCopperZone;
  ring: PcbPointMm[];
  bounds: RingBounds;
}

/**
 * `ZONE_OVERLAP`: two effective POLYGON zones on one layer with different nets,
 * EQUAL priority, whose rings overlap with positive area. Same-net pairs are
 * legal — the fill merges them (§5) — and `null` is its own "no net", so two
 * net-less zones never report.
 *
 * S5 narrowed this from "any different-net overlap" (copper-pour contract §10):
 * the fill now carves a zone around every higher-or-equal-priority zone of
 * another net (§3.3), so a DIFFERENT-priority pair is resolved in the artwork
 * and no longer a defect, and a board plane is carved by every explicit zone on
 * its layer (it holds priority −1 and no polygon), which retires the separate
 * plane-vs-zone loop this function used to run. Equal priority is the one case
 * the carve cannot resolve: both zones carve each other, the contested band
 * belongs to neither fill, and the user's intent is genuinely ambiguous.
 */
function overlapDrafts(ctx: DrcContext): DrcViolationDraft[] {
  const candidates: OverlapCandidate[] = [];
  for (const zone of ctx.copperZones) {
    if (zone.sourceKind === "board") continue;
    if (zone.region.kind !== "polygon") continue;
    const ring = canonicalizeRing(zone.region.pointsMm, GEOM_EPS_MM);
    if (ring.length < 3) continue;
    candidates.push({ zone, ring, bounds: boundsOfPoints(ring) });
  }

  const out: DrcViolationDraft[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const a = candidates[i]!;
    for (let j = i + 1; j < candidates.length; j += 1) {
      const b = candidates[j]!;
      if (a.zone.layer !== b.zone.layer) continue;
      if (a.zone.netId === b.zone.netId) continue;
      if (a.zone.priority !== b.zone.priority) continue;
      if (!boundsMeet(a.bounds, b.bounds, GEOM_EPS_MM)) continue;
      if (!ringsOverlapPositiveArea(a.ring, b.ring, GEOM_EPS_MM)) continue;
      out.push({
        code: "ZONE_OVERLAP",
        ruleClass: "constraint",
        message: `Zones "${zoneDisplayName(ctx, a.zone)}" and "${zoneDisplayName(ctx, b.zone)}" overlap on ${a.zone.layer} with different nets and equal priority`,
        anchors: [
          { kind: "zone", zoneId: a.zone.id },
          { kind: "zone", zoneId: b.zone.id },
        ],
        locationMm: boundsIntersectionCenter(a.bounds, b.bounds),
        layer: a.zone.layer,
      });
    }
  }
  return out;
}

export function checkZones(ctx: DrcContext): DrcViolationDraft[] {
  return [...warningDrafts(ctx), ...overlapDrafts(ctx)];
}
