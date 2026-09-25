import type {
  BomOverride,
  CentroidRow,
  DesignerPcbProjection,
  DesignerPlacedPart,
  DesignerSchematicProjection,
  PartPropertiesJson,
  PcbPlacedPart,
} from "../../../../../sdks/designer/types";
import { buildBomProjection } from "../bom/writer";
import { footprintRotationOffsetDeg } from "./rotation-db";

/**
 * Pick-and-place / centroid (CPL) CSV writer (JLCPCB-compatible columns).
 *
 *   Designator,Val,Package,Mid X,Mid Y,Rotation,Layer
 *
 * - `Mid X` / `Mid Y` are placement centroids in **millimeters**, board-origin
 *   coordinates. OpenPCB's board space is Cartesian Y-up (matches the camera /
 *   fab convention), so no Y-flip or bottom-side X-mirror is applied.
 * - `Rotation` is degrees CCW, footprint-family corrected (see `rotation-db`),
 *   bottom-side mirrored, normalized to [0, 360).
 * - `Layer` is `Top` or `Bottom` (title-case, JLCPCB canonical).
 * - Only **surface-mount** parts are emitted; through-hole and DNP parts are
 *   omitted (the assembly machine does not place them).
 */

const NL = "\r\n";

export function buildPnpCsv(
  pcb: DesignerPcbProjection,
  schematic: DesignerSchematicProjection | null,
  overrides: readonly BomOverride[] = [],
): string {
  // Paired by partId, like the BOM: the designator is the SCHEMATIC reference,
  // so BOM and CPL name the same part identically even before a renamed
  // placement row has re-synced.
  const partById = new Map<string, DesignerPlacedPart>();
  for (const part of (schematic?.parts ?? []) as DesignerPlacedPart[]) {
    partById.set(part.id, part);
  }

  // DNP parts are excluded from the CPL. Reuse the BOM projection's per-part DNP
  // resolution (propertiesJson.dnp + part-bound overrides) so PnP and BOM never
  // disagree about what is populated — keyed by placement, never by refdes.
  const dnpPlacementIds = new Set<string>();
  for (const row of buildBomProjection(pcb, schematic, overrides).rows) {
    for (const ref of row.refs) {
      if (ref.dnp && ref.placementId) dnpPlacementIds.add(ref.placementId);
    }
  }

  const rows: CentroidRow[] = [];
  for (const placement of pcb.placements) {
    if (!isSurfaceMount(placement)) continue;
    if (dnpPlacementIds.has(placement.id)) continue;
    const part = partById.get(placement.partId) ?? null;
    const refdes = part?.reference ?? placement.reference;
    const layer: "top" | "bottom" =
      placement.layer === "B.Cu" ? "bottom" : "top";
    rows.push({
      refdes,
      value: part?.value ?? "",
      footprint: placement.footprint.name,
      xMm: placement.positionMm.x,
      yMm: placement.positionMm.y,
      rotationDeg: cplRotationDeg(
        placement,
        part ? readPnpRotation(part.propertiesJson) : null,
      ),
      layer,
    });
  }
  rows.sort((a, b) => a.refdes.localeCompare(b.refdes));

  const lines: string[] = [];
  lines.push("Designator,Val,Package,Mid X,Mid Y,Rotation,Layer");
  for (const r of rows) {
    lines.push(formatRow(r));
  }
  return lines.join(NL) + NL;
}

/**
 * Surface-mount iff at least one pad has no plated drill. THT-only parts (every
 * pad drilled) are wave-/hand-soldered, never pick-and-placed, and cause upload
 * warnings if present in the CPL.
 */
function isSurfaceMount(placement: PcbPlacedPart): boolean {
  const pads = placement.footprint.preview?.pads ?? [];
  return pads.some((pad) => !(pad.drillDiameterMm && pad.drillDiameterMm > 0));
}

/**
 * CPL rotation in JLCPCB's convention: the footprint-family offset (KiCad-zero
 * → IPC-zero) added to the placement angle, then — for bottom-side parts —
 * mirrored about 180°.
 *
 * The bottom-side `(180 - r)` transform follows JLCPCB's documented assembly
 * convention. OpenPCB's placement model differs from KiCad's, so bottom-side
 * parts should be VALIDATED against JLCPCB's 3D preview. A per-part absolute
 * override (`propertiesJson.pnpRotation`, deg) bypasses both steps.
 */
function cplRotationDeg(
  placement: PcbPlacedPart,
  overrideDeg: number | null,
): number {
  if (overrideDeg !== null) return normalizeAngle(overrideDeg);
  const offset = footprintRotationOffsetDeg(placement.footprint.name);
  const base = placement.rotationDeg + offset;
  const cpl = placement.layer === "B.Cu" ? 180 - base : base;
  return normalizeAngle(cpl);
}

function readPnpRotation(props: PartPropertiesJson | null): number | null {
  if (!props) return null;
  const raw = props.pnpRotation;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function formatRow(r: CentroidRow): string {
  return [
    csvField(r.refdes),
    csvField(r.value),
    csvField(r.footprint),
    formatMm(r.xMm),
    formatMm(r.yMm),
    r.rotationDeg.toFixed(2),
    r.layer === "bottom" ? "Bottom" : "Top",
  ].join(",");
}

function formatMm(mm: number): string {
  // 4 decimal places (sub-100-nm precision) is plenty for assembly tools.
  return mm.toFixed(4);
}

function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function csvField(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
