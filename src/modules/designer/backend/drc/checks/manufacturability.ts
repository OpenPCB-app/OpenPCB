import type { PcbBoardOutline } from "../../../../../sdks/designer";
import {
  FAB_PRESETS,
  type PcbFabPreset,
  validateHoleAgainstFab,
  validateTraceAgainstFab,
  validateViaAgainstFab,
} from "../../pcb/fab-presets";
import {
  boardSlotRing,
  findNarrowestSlot,
  findParametricHoleSlot,
  findSmallInternalRadii,
  type RingMaterialSide,
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
          message: fv.message,
          anchors: [hole.anchor],
          locationMm: hole.center,
          measuredMm: fv.actualValue,
          requiredMm: fv.fabValue,
        });
      }
    }
  }

  // Milling limits (fab-sourced, advisory): internal corner radius + slot/neck
  // width. Custom fab has no capability floor, so it's skipped.
  if (ctx.fabricator !== "custom") {
    const preset = FAB_PRESETS[ctx.fabricator];
    if (preset) {
      const board = ctx.projection.board;
      // The outer outline AND every cutout: a cutout is routed with the same
      // bit, so a corner or a neck inside one is the same fab limit (contract
      // 06 §3) — but the material is on the OTHER side of a cutout ring, which
      // flips which corners the bit cannot reach. Both codes are
      // location-hashed, so several hits on the shared `boardEdge` anchor stay
      // distinct. The message carries the cutout id as well as its position,
      // since reordering `board.cutouts` renumbers them.
      out.push(...millingAdvisories(board.outline, preset, "", "inside"));
      (board.cutouts ?? []).forEach((cutout, i) => {
        out.push(
          ...millingAdvisories(
            cutout.shape,
            preset,
            `Cutout ${i + 1} (${cutout.id.slice(0, 6)}) `,
            "outside",
          ),
        );
      });
    }
  }

  return out;
}

/**
 * The two advisory milling hits for ONE milled contour. `subject` prefixes the
 * message ("" for the board itself, "Cutout n (id) " for a cutout) — the
 * board's wording is unchanged. `material` says which side of the ring the
 * substrate is on; it decides which corners the bit cannot reach.
 */
function millingAdvisories(
  shape: PcbBoardOutline,
  preset: PcbFabPreset,
  subject: string,
  material: RingMaterialSide,
): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const radiusLabel = subject
    ? `${subject}internal corner radius`
    : "Internal corner radius";
  const slotLabel = subject ? `${subject}slot / neck` : "Board slot / neck";
  for (const hit of findSmallInternalRadii(
    shape,
    preset.minInternalRadiusMm,
    material,
  )) {
    out.push({
      code: "OUTLINE_INTERNAL_RADIUS",
      message: `${radiusLabel} ${hit.radiusMm.toFixed(2)} mm < ${preset.name} min ${preset.minInternalRadiusMm.toFixed(2)} mm`,
      anchors: [{ kind: "boardEdge" }],
      locationMm: hit.locationMm,
      measuredMm: hit.radiusMm,
      requiredMm: preset.minInternalRadiusMm,
    });
  }
  // Slot check on the coarse vertex ring (arcs as single edges) so a smooth
  // curve's tessellation chords never read as a false narrow gap. A parametric
  // cutout has no such ring — its own narrowest dimension IS the void the
  // cutter must fit into. `findNarrowestSlot` is side-agnostic: on a non-convex
  // cutout it also measures a narrow MATERIAL web between two lobes of the
  // void, which is the minimum-web limit S12 owns — reported here under the
  // same advisory code, never silently passed (contract 06 §9).
  const slotRing = boardSlotRing(shape);
  const slot = slotRing
    ? findNarrowestSlot(slotRing, preset.minSlotWidthMm)
    : material === "outside"
      ? findParametricHoleSlot(shape, preset.minSlotWidthMm)
      : null;
  if (slot) {
    out.push({
      code: "OUTLINE_SLOT_WIDTH",
      message: `${slotLabel} ${slot.gapMm.toFixed(2)} mm < ${preset.name} min ${preset.minSlotWidthMm.toFixed(2)} mm`,
      anchors: [{ kind: "boardEdge" }],
      locationMm: slot.locationMm,
      measuredMm: slot.gapMm,
      requiredMm: preset.minSlotWidthMm,
    });
  }
  return out;
}
