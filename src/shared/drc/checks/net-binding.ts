import type {
  DrcAnchor,
  PcbCopperLayerId,
  PcbPointMm,
} from "../../../sdks/designer";
import {
  enumerateNetReferences,
  judgeNetReference,
  type NetReference,
} from "../../electrical-identity/references";
import { freePadCopperLayers } from "../../rendering/pad-copper-layers";
import type { DrcContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";
import { anchorKey } from "../violation-id";

type CopperAnchor = Extract<
  DrcAnchor,
  { kind: "trace" | "via" | "freePad" | "zone" }
>;
interface CopperSite {
  anchor: CopperAnchor;
  locationMm?: PcbPointMm;
  layer?: PcbCopperLayerId;
}

function copperSites(ctx: DrcContext): Map<string, CopperSite> {
  const sites = new Map<string, CopperSite>();
  const add = (
    anchor: CopperAnchor,
    locationMm?: PcbPointMm,
    layer?: PcbCopperLayerId,
  ): void => {
    sites.set(anchorKey(anchor), { anchor, locationMm, ...(layer ? { layer } : {}) });
  };
  for (const row of ctx.projection.traces) {
    const first = row.pointsNm[0];
    const location = first
      ? { x: first.x / 1_000_000, y: first.y / 1_000_000 } : undefined;
    add({ kind: "trace", traceId: row.id }, location, row.layer);
  }
  for (const row of ctx.projection.vias) {
    const layer = row.fromLayer === row.toLayer ? row.fromLayer : undefined;
    add({ kind: "via", viaId: row.id }, row.centerMm, layer);
  }
  for (const row of ctx.projection.freePads) {
    const { layers } = freePadCopperLayers(row, ctx.validCopperLayers);
    const layer = layers.length === 1 ? layers[0] : undefined;
    add({ kind: "freePad", freePadId: row.id }, row.centerMm, layer);
  }
  for (const row of ctx.projection.zones) {
    if (!row.enabled) continue;
    const location = row.region.kind === "polygon"
      ? row.region.pointsMm[0] : ctx.board.outline.centerMm;
    add({ kind: "zone", zoneId: row.id }, location, row.layer);
  }
  return sites;
}

function copperAnchor(ref: NetReference): CopperAnchor | null {
  switch (ref.site.kind) {
    case "trace":
    case "via":
    case "freePad":
    case "zone":
      return ref.site;
    default:
      return null;
  }
}

/** Raw references remain visible even when the geometry or pour derivation refuses them. */
export function checkNetBinding(ctx: DrcContext): DrcViolationDraft[] {
  const activeIds = new Set(Object.keys(ctx.netNames));
  const sites = copperSites(ctx);
  const seen = new Set<string>();
  const drafts: DrcViolationDraft[] = [];
  // Rule validation owns malformed settings; this pass needs only copper.
  for (const ref of enumerateNetReferences({ ...ctx.projection, board: {} })) {
    if (ref.refClass !== "copper") continue;
    const reason = judgeNetReference(ref, activeIds);
    if (reason !== "inactive" && reason !== "unresolved-name") continue;
    const anchor = copperAnchor(ref);
    if (!anchor) continue;
    const key = anchorKey(anchor);
    const site = sites.get(key);
    if (!site || seen.has(key)) continue;
    seen.add(key);
    const name = ref.netName?.trim() ? ref.netName : ref.netId;
    drafts.push({
      code: "NET_ORPHANED_COPPER",
      message: `Copper is assigned to net "${name}" which no longer exists (${reason}). Rebind or delete it before manufacturing.`,
      anchors: [site.anchor],
      ...(site.locationMm ? { locationMm: site.locationMm } : {}),
      ...(site.layer ? { layer: site.layer } : {}),
    });
  }
  return drafts;
}
