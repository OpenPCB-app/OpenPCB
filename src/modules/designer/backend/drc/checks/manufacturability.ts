import {
  FAB_PRESETS,
  validateHoleAgainstFab,
  validateTraceAgainstFab,
  validateViaAgainstFab,
} from "../../pcb/fab-presets";
import {
  boardSlotRing,
  findNarrowestSlot,
  findSmallInternalRadii,
} from "../../pcb/outline-manufacturability";
import { below, type DrcContext } from "../drc-context";
import { exceeds } from "../../pcb/tolerance";
import type { DrcViolationDraft } from "../types";
import { ruleSuffix } from "../rule-message";

/**
 * Minimum-geometry rules (design-rule errors) + fabricator-capability warnings.
 * Annular ring = (diameter − drill) / 2. Fab warnings reuse the existing
 * `validateTraceAgainstFab` / `validateViaAgainstFab` validators.
 */
export function checkManufacturability(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const min = ctx.designRules.minimums;

  for (const t of ctx.traces) {
    const width = ctx.resolver.scalar("trackWidth", {
      netId: t.netId,
      layers: [t.layer],
      geometry: {
        kind: "polyline",
        pointsMm: t.pointsMm,
        halfWidthMm: t.halfWidthMm,
      },
    });
    if (below(t.widthMm, width.mm)) {
      out.push({
        code: "TRACE_WIDTH_MIN",
        ruleClass: "manufacturability",
        ...(width.rule?.severity ? { ruleSeverity: width.rule.severity } : {}),
        message: `Trace width ${t.widthMm.toFixed(3)} mm is below the minimum ${width.mm.toFixed(3)} mm${ruleSuffix(width)}`,
        anchors: [{ kind: "trace", traceId: t.id }],
        locationMm: t.mid,
        layer: t.layer,
        measuredMm: t.widthMm,
        requiredMm: width.mm,
      });
    }
    for (const v of validateTraceAgainstFab(
      { widthMm: t.widthMm },
      ctx.fabricator,
    )) {
      out.push({
        code: "FAB_TRACE_WIDTH",
        ruleClass: "manufacturability",
        message: v.message,
        anchors: [{ kind: "trace", traceId: t.id }],
        locationMm: t.mid,
        layer: t.layer,
        measuredMm: v.actualValue,
        requiredMm: v.fabValue,
      });
    }
  }

  for (const vg of ctx.vias) {
    const via = vg.via;
    // One scope item per via: its barrel disc and its resolved layer span.
    const viaItem = {
      netId: vg.netId,
      layers: vg.layers,
      geometry: {
        kind: "disc" as const,
        center: vg.center,
        radiusMm: vg.radiusMm,
      },
    };
    const viaDiameter = ctx.resolver.scalar("viaDiameter", viaItem);
    if (below(via.diameterMm, viaDiameter.mm)) {
      out.push({
        code: "VIA_DIAMETER_MIN",
        ruleClass: "manufacturability",
        ...(viaDiameter.rule?.severity
          ? { ruleSeverity: viaDiameter.rule.severity }
          : {}),
        message: `Via pad diameter ${via.diameterMm.toFixed(3)} mm is below the minimum ${viaDiameter.mm.toFixed(3)} mm${ruleSuffix(viaDiameter)}`,
        anchors: [{ kind: "via", viaId: via.id }],
        locationMm: via.centerMm,
        measuredMm: via.diameterMm,
        requiredMm: viaDiameter.mm,
      });
    }
    const viaDrill = ctx.resolver.scalar("viaDrill", viaItem);
    if (below(via.drillMm, viaDrill.mm)) {
      out.push({
        code: "VIA_DRILL_MIN",
        ruleClass: "manufacturability",
        ...(viaDrill.rule?.severity
          ? { ruleSeverity: viaDrill.rule.severity }
          : {}),
        message: `Via drill ${via.drillMm.toFixed(3)} mm is below the minimum ${viaDrill.mm.toFixed(3)} mm${ruleSuffix(viaDrill)}`,
        anchors: [{ kind: "via", viaId: via.id }],
        locationMm: via.centerMm,
        measuredMm: via.drillMm,
        requiredMm: viaDrill.mm,
      });
    }
    const annular = (via.diameterMm - via.drillMm) / 2;
    // `annularRing` rules reach vias only; THT pad rings stay board-only (S11).
    const viaAnnular = ctx.resolver.scalar("annularRing", viaItem);
    if (below(annular, viaAnnular.mm)) {
      out.push({
        code: "ANNULAR_RING_MIN",
        ruleClass: "manufacturability",
        ...(viaAnnular.rule?.severity
          ? { ruleSeverity: viaAnnular.rule.severity }
          : {}),
        message: `Via annular ring ${annular.toFixed(3)} mm is below the minimum ${viaAnnular.mm.toFixed(3)} mm${ruleSuffix(viaAnnular)}`,
        anchors: [{ kind: "via", viaId: via.id }],
        locationMm: via.centerMm,
        measuredMm: annular,
        requiredMm: viaAnnular.mm,
      });
    }
    for (const fv of validateViaAgainstFab(
      { diameterMm: via.diameterMm, drillMm: via.drillMm },
      ctx.fabricator,
    )) {
      const code =
        fv.rule === "minDrillMm"
          ? "FAB_DRILL"
          : fv.rule === "minPadMm"
            ? "FAB_PAD"
            : "FAB_ANNULAR_RING";
      out.push({
        code,
        ruleClass: "manufacturability",
        message: fv.message,
        anchors: [{ kind: "via", viaId: via.id }],
        locationMm: via.centerMm,
        measuredMm: fv.actualValue,
        requiredMm: fv.fabValue,
      });
    }

    // Via aspect ratio = effective span depth / drill (drilling limit,
    // fab-specific). A through via drills the full board; a blind/buried via
    // only drills the layers it spans, so scale board thickness by the fraction
    // of the stackup it crosses (no per-layer thickness model yet — linear).
    if (ctx.fabricator !== "custom" && via.drillMm > 0) {
      const preset = FAB_PRESETS[ctx.fabricator];
      const layerCount = ctx.validCopperLayers.size;
      const spanFraction =
        layerCount > 1 ? (vg.layers.length - 1) / (layerCount - 1) : 1;
      const effectiveThicknessMm = ctx.boardThicknessMm * spanFraction;
      const ratio = effectiveThicknessMm / via.drillMm;
      if (preset && exceeds(ratio, preset.maxAspectRatio)) {
        out.push({
          code: "VIA_ASPECT_RATIO",
          ruleClass: "manufacturability",
          message: `Via aspect ratio ${ratio.toFixed(1)}:1 exceeds ${preset.name} maximum ${preset.maxAspectRatio}:1 (span ${effectiveThicknessMm.toFixed(2)} mm / drill ${via.drillMm.toFixed(3)} mm)`,
          anchors: [{ kind: "via", viaId: via.id }],
          locationMm: via.centerMm,
        });
      }
    }
  }

  // Per-hole minimum drill size (every drilled hole) + annular ring (plated
  // pads that carry a known copper OD: TH footprint pads & free `std` pads).
  // Vias are also in `ctx.holes`; their via-specific drill/annular minimums are
  // handled above, but the global `drillSizeMm` floor still applies here.
  for (const hole of ctx.holes) {
    if (below(hole.drillMm, min.drillSizeMm)) {
      out.push({
        code: "DRILL_SIZE_MIN",
        ruleClass: "manufacturability",
        message: `Drill size ${hole.drillMm.toFixed(3)} mm is below the minimum ${min.drillSizeMm.toFixed(3)} mm`,
        anchors: [hole.anchor],
        locationMm: hole.center,
        measuredMm: hole.drillMm,
        requiredMm: min.drillSizeMm,
      });
    }
    if (hole.padOdMm !== undefined) {
      const annular = (hole.padOdMm - hole.drillMm) / 2;
      if (below(annular, min.annularRingMm)) {
        out.push({
          code: "ANNULAR_RING_MIN",
          ruleClass: "manufacturability",
          message: `Pad annular ring ${annular.toFixed(3)} mm is below the minimum ${min.annularRingMm.toFixed(3)} mm`,
          anchors: [hole.anchor],
          locationMm: hole.center,
          measuredMm: annular,
          requiredMm: min.annularRingMm,
        });
      }
    }
    // Fab capability floors for PTH/NPTH drills + PTH annular rings (vias are
    // validated with via-specific thresholds in the via loop above; P8 —
    // audit B2-8: TH/free-hole drills previously got no fab check at all).
    if (hole.kind !== "via") {
      for (const fv of validateHoleAgainstFab(
        { drillMm: hole.drillMm, padOdMm: hole.padOdMm },
        ctx.fabricator,
      )) {
        out.push({
          code: fv.rule === "minDrillMm" ? "FAB_DRILL" : "FAB_ANNULAR_RING",
          ruleClass: "manufacturability",
          message: fv.message,
          anchors: [hole.anchor],
          locationMm: hole.center,
          measuredMm: fv.actualValue,
          requiredMm: fv.fabValue,
        });
      }
    }
  }

  // Board-outline milling limits (fab-sourced, advisory): internal corner radius
  // + slot/neck width. Custom fab has no capability floor, so it's skipped.
  if (ctx.fabricator !== "custom") {
    const preset = FAB_PRESETS[ctx.fabricator];
    if (preset) {
      for (const hit of findSmallInternalRadii(
        ctx.projection.board.outline,
        preset.minInternalRadiusMm,
      )) {
        out.push({
          code: "OUTLINE_INTERNAL_RADIUS",
          ruleClass: "manufacturability",
          message: `Internal corner radius ${hit.radiusMm.toFixed(2)} mm < ${preset.name} min ${preset.minInternalRadiusMm.toFixed(2)} mm`,
          anchors: [{ kind: "boardEdge" }],
          locationMm: hit.locationMm,
          measuredMm: hit.radiusMm,
          requiredMm: preset.minInternalRadiusMm,
        });
      }
      // Slot check on the coarse vertex ring (arcs as single edges) so a smooth
      // curve's tessellation chords never read as a false narrow gap.
      const slotRing = boardSlotRing(ctx.projection.board.outline);
      const slot = slotRing
        ? findNarrowestSlot(slotRing, preset.minSlotWidthMm)
        : null;
      if (slot) {
        out.push({
          code: "OUTLINE_SLOT_WIDTH",
          ruleClass: "manufacturability",
          message: `Board slot / neck ${slot.gapMm.toFixed(2)} mm < ${preset.name} min ${preset.minSlotWidthMm.toFixed(2)} mm`,
          anchors: [{ kind: "boardEdge" }],
          locationMm: slot.locationMm,
          measuredMm: slot.gapMm,
          requiredMm: preset.minSlotWidthMm,
        });
      }
    }
  }

  return out;
}
