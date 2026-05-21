import type {
  CentroidRow,
  DesignerPcbProjection,
  DesignerPlacedPart,
  DesignerSchematicProjection,
} from "../../../../../sdks/designer/types";

/**
 * Pick-and-place CSV writer (JLCPCB-compatible columns).
 *
 *   Designator,Val,Package,Mid X,Mid Y,Rotation,Layer
 *
 * - `Mid X` / `Mid Y` are placement centroids in **millimeters**, board-origin
 *   coordinates (no translation).
 * - `Rotation` is degrees CCW, normalized to [0, 360).
 * - `Layer` is `top` or `bottom`.
 */

const NL = "\r\n";

export function buildPnpCsv(
  pcb: DesignerPcbProjection,
  schematic: DesignerSchematicProjection | null,
): string {
  const valueByRef = new Map<string, string>();
  if (schematic) {
    for (const part of schematic.parts as DesignerPlacedPart[]) {
      valueByRef.set(part.reference, part.value);
    }
  }
  const rows: CentroidRow[] = [];
  for (const placement of pcb.placements) {
    const layer: "top" | "bottom" =
      placement.layer === "B.Cu" ? "bottom" : "top";
    rows.push({
      refdes: placement.reference,
      value: valueByRef.get(placement.reference) ?? "",
      footprint: placement.footprint.name,
      xMm: placement.positionMm.x,
      yMm: placement.positionMm.y,
      rotationDeg: normalizeAngle(placement.rotationDeg),
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

function formatRow(r: CentroidRow): string {
  return [
    csvField(r.refdes),
    csvField(r.value),
    csvField(r.footprint),
    formatMm(r.xMm),
    formatMm(r.yMm),
    r.rotationDeg.toFixed(2),
    r.layer,
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
