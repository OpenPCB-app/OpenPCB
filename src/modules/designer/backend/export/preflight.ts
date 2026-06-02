import type {
  BomOverride,
  DesignerPcbProjection,
  DesignerSchematicProjection,
} from "../../../../sdks/designer/types";
import { FAB_PRESETS } from "../pcb/fab-presets";
import { buildBomProjection } from "./bom/writer";

/**
 * Export-time preflight: surfaces issues that would silently produce a wrong or
 * fab-rejected bundle but that full-board DRC does not flag — missing outline,
 * holes/traces below the selected fab's minimums, and (for assembly) parts with
 * no orderable part number. Results are appended to the bundle `warnings[]` and
 * shown in the export dialog. Never throws; advisory only.
 */
export function runExportPreflight(
  pcb: DesignerPcbProjection,
  schematic: DesignerSchematicProjection | null,
  overrides: readonly BomOverride[] = [],
): string[] {
  const warnings: string[] = [];

  if (!pcb.board.outline) {
    warnings.push(
      "Board has no outline — Edge.Cuts is empty and the fab cannot route the board profile.",
    );
  }

  const preset =
    pcb.board.fabricator !== "custom"
      ? FAB_PRESETS[pcb.board.fabricator]
      : undefined;
  if (preset) {
    const drills = collectDrillDiametersMm(pcb).filter(
      (d) => d > 0 && d < preset.minDrillMm,
    );
    if (drills.length > 0) {
      warnings.push(
        `${drills.length} hole(s) below the ${preset.id} minimum drill ${preset.minDrillMm} mm (smallest ${Math.min(...drills).toFixed(3)} mm).`,
      );
    }
    const thin = pcb.traces.filter(
      (t) => t.widthMm > 0 && t.widthMm < preset.minTraceWidthMm,
    );
    if (thin.length > 0) {
      warnings.push(
        `${thin.length} trace(s) below the ${preset.id} minimum width ${preset.minTraceWidthMm} mm (thinnest ${Math.min(...thin.map((t) => t.widthMm)).toFixed(3)} mm).`,
      );
    }
  }

  // Assembly intent (schematic present): flag parts that can't be sourced.
  if (schematic) {
    const rows = buildBomProjection(pcb, schematic, overrides).rows;
    const unsourced = rows.filter(
      (r) => !r.dnp && !r.manufacturerPartNumber && !r.lcscPartNumber,
    );
    if (unsourced.length > 0) {
      const sample = unsourced
        .slice(0, 8)
        .map((r) => r.refdesList)
        .join(", ");
      warnings.push(
        `${unsourced.length} BOM line(s) have no MPN/LCSC part number and cannot be auto-sourced for assembly: ${sample}${unsourced.length > 8 ? ", …" : ""}.`,
      );
    }
  }

  return warnings;
}

function collectDrillDiametersMm(pcb: DesignerPcbProjection): number[] {
  const out: number[] = [];
  for (const via of pcb.vias) if (via.drillMm > 0) out.push(via.drillMm);
  for (const placement of pcb.placements) {
    for (const pad of placement.footprint.preview?.pads ?? []) {
      const d = pad.drillDiameterMm ?? 0;
      if (d > 0) out.push(d);
    }
  }
  for (const hole of pcb.freeHoles)
    if (hole.drillMm > 0) out.push(hole.drillMm);
  for (const pad of pcb.freePads) {
    if (pad.drillMm !== null && pad.drillMm > 0) out.push(pad.drillMm);
  }
  return out;
}
