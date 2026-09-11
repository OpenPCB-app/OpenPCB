import type { PcbBoardOutline } from "../../../sdks/designer";
import {
  FAB_PRESETS,
  type PcbFabPreset,
  validateHoleAgainstFab,
  validateTraceAgainstFab,
  validateViaAgainstFab,
} from "../fab-presets";
import {
  boardMaterialRings,
  boardSlotRing,
  findNarrowestSlot,
  findParametricHoleSlot,
  findSmallInternalRadii,
  MATERIAL_STEP_MULTIPLIER,
  type RingMaterialSide,
} from "../../rendering/pcb/outline-manufacturability";
import { analyseMaterialRegion } from "../../rendering/copper-fill/material-web-kernel";
import {
  CopperShapeBudgetError,
  EROSION_MARGIN_MM,
} from "../../rendering/copper-fill/copper-shape-kernel";
import {
  CopperKernelError,
  runKernelQuietly,
} from "../../rendering/copper-fill/copper-geometry-kernel";
import { regionContainsPoint } from "../../pcb-geometry/board-region";
import type { PcbPointMm } from "../../../sdks/designer";
import {
  below,
  type DrcContext,
  type DrcHole,
  type LegalityContext,
} from "../drc-context";
import type { ItemSet } from "./clearance-judge";
import { exceeds, GEOM_EPS_MM } from "../../pcb-geometry/tolerance";
import type { DrcViolationDraft } from "../types";
import { ruleSuffix } from "../rule-message";

/**
 * The per-item minimum-geometry rules and fab-capability warnings of one item
 * set — everything in `checkManufacturability` except the outline milling
 * advisories, which are a property of the board, not of an item (07 §3).
 */
export function manufacturabilityItems(
  ctx: LegalityContext,
  items: ItemSet & { holes: readonly DrcHole[] },
  opts: { out: DrcViolationDraft[] },
): void {
  const out = opts.out;
  const min = ctx.designRules.minimums;

  for (const t of items.traces) {
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

  for (const vg of items.vias) {
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
    // BREAKOUT FIRST (§3.3), for the via annulus exactly as for a pad: a ring
    // of zero is no copper around the barrel, whatever the minimum says
    // (Astra run 2b #4 — a minimum of 0 legalised it).
    if (!(annular > GEOM_EPS_MM)) {
      out.push({
        code: "ANNULAR_RING_MIN",
        message: `Drill breaks out of the via pad (annular ring ${annular.toFixed(3)} mm)`,
        anchors: [{ kind: "via", viaId: via.id }],
        locationMm: via.centerMm,
        measuredMm: annular,
        requiredMm: viaAnnular.mm,
      });
    } else if (below(annular, viaAnnular.mm)) {
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

    const preset =
      ctx.fabricator === "custom" ? undefined : FAB_PRESETS[ctx.fabricator];

    // Only a THROUGH via can be manufactured from an OpenPCB export: Excellon
    // writes ONE plated drill file (`TF.FileFunction,Plated,1,<last>,PTH`), so
    // every plated hit is a through drill and a blind / buried / micro via has
    // no representation at all. That is a property of the EXPORT, so it holds
    // on `custom` too (contract 10 §5.1). Emitted only when the span is valid
    // for its type — one code per defect; an invalid span keeps VIA_LAYER_SPAN
    // and gets nothing else.
    if (
      via.viaType !== "through" &&
      !vg.layerSpanInvalid &&
      !vg.viaTypeInvalid
    ) {
      out.push({
        code: "VIA_TYPE_UNSUPPORTED",
        message: `Via type "${via.viaType}" cannot be manufactured: OpenPCB's drill export writes through drills only${
          preset ? `; ${preset.name} offers through-hole vias only` : ""
        }; its drill depth is not evaluated`,
        anchors: [{ kind: "via", viaId: via.id }],
        locationMm: via.centerMm,
      });
    }

    // Aspect ratio = board thickness / drill, for THROUGH vias only (§5.2):
    // there is no per-layer thickness model, and no preset states a limit for
    // a blind / buried / micro via — the former linear span scaling invented
    // one and spared exactly the vias that cannot be built at all (B2-7).
    if (
      ctx.fabricator !== "custom" &&
      preset &&
      via.viaType === "through" &&
      via.drillMm > 0
    ) {
      const ratio = ctx.boardThicknessMm / via.drillMm;
      if (exceeds(ratio, preset.maxAspectRatio)) {
        out.push({
          code: "VIA_ASPECT_RATIO",
          message: `Via aspect ratio ${ratio.toFixed(1)}:1 exceeds ${preset.name} maximum ${preset.maxAspectRatio}:1 (board thickness ${ctx.boardThicknessMm.toFixed(2)} mm / drill ${via.drillMm.toFixed(3)} mm)`,
          anchors: [{ kind: "via", viaId: via.id }],
          locationMm: via.centerMm,
        });
      }
    }
  }

  // Per-hole minimum drill size (every drilled hole) + the exact annular ring
  // of every hole that carries copper (contract 10 §3, §4). Vias are also in
  // `ctx.holes`; their via-specific drill/annular minimums are handled above,
  // but the global `drillSizeMm` floor still applies here.
  for (const hole of items.holes) {
    // `drillMm` is the TOOL diameter — the slot WIDTH for a routed slot, which
    // is what the drill/router bit actually has to be (§4).
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
    const ring = hole.annularRingMm;
    // A non-finite ring is bad data (a NaN pad dimension), not a breakout:
    // degenerate copper is dropped upstream and gets no verdict here (R1 #5).
    if (ring !== undefined && Number.isFinite(ring)) {
      // BREAKOUT IS JUDGED FIRST (§3.3): a wall that touches or leaves the
      // copper is a violation whatever `minimums.annularRingMm` says. A
      // minimum of 0 plus `below()`'s 1 nm grace must not legalise copper that
      // is not there.
      if (!(ring > GEOM_EPS_MM)) {
        out.push({
          code: "ANNULAR_RING_MIN",
          message: `Drill breaks out of the pad copper (annular ring ${ring.toFixed(3)} mm)`,
          anchors: [hole.anchor],
          locationMm: hole.center,
          measuredMm: ring,
          requiredMm: min.annularRingMm,
        });
      } else if (below(ring, min.annularRingMm)) {
        out.push({
          code: "ANNULAR_RING_MIN",
          message: `Pad annular ring ${ring.toFixed(3)} mm is below the minimum ${min.annularRingMm.toFixed(3)} mm`,
          anchors: [hole.anchor],
          locationMm: hole.center,
          measuredMm: ring,
          requiredMm: min.annularRingMm,
        });
      }
    }
    // Fab capability floors, by hole kind and tool (vias are validated with
    // via-specific thresholds in the via loop above; P8 — audit B2-8:
    // TH/free-hole drills previously got no fab check at all).
    if (hole.kind !== "via") {
      for (const fv of validateHoleAgainstFab(
        {
          kind: hole.kind,
          drillMm: hole.drillMm,
          slot: hole.slot !== undefined,
          ...(ring !== undefined ? { annularRingMm: ring } : {}),
        },
        ctx.fabricator,
      )) {
        out.push({
          code:
            fv.rule === "pthAnnularRingMm" || fv.rule === "npthAnnularRingMm"
              ? "FAB_ANNULAR_RING"
              : "FAB_DRILL",
          message: fv.message,
          anchors: [hole.anchor],
          locationMm: hole.center,
          measuredMm: fv.actualValue,
          requiredMm: fv.fabValue,
        });
      }
    }
  }
}

/**
 * Minimum-geometry rules (design-rule errors) + fabricator-capability warnings.
 * Annular ring = (diameter − drill) / 2. Fab warnings reuse the existing
 * `validateTraceAgainstFab` / `validateViaAgainstFab` validators.
 */
export function checkManufacturability(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  manufacturabilityItems(ctx, ctx, { out });

  // The board-material minimum web (exact-geometry contract 12 §5.2): ONE call
  // over the whole board, OUTSIDE the fab branch — a DESIGN rule fires on every
  // fabricator, and the per-contour `millingAdvisories` below cannot see a web
  // that spans two contours at all.
  for (const draft of materialWebDrafts(ctx)) out.push(draft);

  // Milling limits (fab-sourced, advisory): internal corner radius + slot/neck
  // width. Custom fab has no capability floor, so it's skipped.
  if (ctx.fabricator !== "custom") {
    const preset = FAB_PRESETS[ctx.fabricator];
    if (preset) {
      const board = ctx.board;
      // The outer outline AND every cutout: a cutout is routed with the same
      // bit, so a corner or a neck inside one is the same fab limit (contract
      // 06 §3) — but the material is on the OTHER side of a cutout ring, which
      // flips which corners the bit cannot reach. Both codes are
      // location-hashed, so several hits on the shared `boardEdge` anchor stay
      // distinct. The message carries the cutout id as well as its position,
      // since reordering `board.cutouts` renumbers them.
      // A connector that runs through MATERIAL is a web, not a void the cutter
      // has to reach into; `OUTLINE_MIN_WEB` owns it by erosion (12 §5.1).
      const inMaterial = (p: PcbPointMm): boolean =>
        regionContainsPoint(ctx.boardRegion, p, GEOM_EPS_MM, ctx.regionIndex);
      out.push(
        ...millingAdvisories(board.outline, preset, "", "inside", inMaterial),
      );
      (board.cutouts ?? []).forEach((cutout, i) => {
        out.push(
          ...millingAdvisories(
            cutout.shape,
            preset,
            `Cutout ${i + 1} (${cutout.id.slice(0, 6)}) `,
            "outside",
            inMaterial,
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
  inMaterial: (p: PcbPointMm) => boolean,
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
    ? findNarrowestSlot(slotRing, preset.minSlotWidthMm, inMaterial)
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

/**
 * `optNum` semantics (12 §5.2 / DFM contract 11 §6): only a finite, positive
 * stored number is a rule. ABSENT means no verdict at all — the minimum web a
 * board may carry is a shape intent no fabricator row states and nothing may
 * default for a user.
 */
function optWebMm(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/**
 * Floor of the web measurement's own error, independent of the flattening: the
 * erosion margin on each wall plus the opening's grid allowance (12 §5.1). The
 * verdict band is `(w − WEB_ERROR_FLOOR_MM − 2·δ, w)`; below it a report is
 * certain, inside it the measurement cannot separate a web from its tolerance.
 */
const WEB_ERROR_FLOOR_MM = 3e-3;

/**
 * `OUTLINE_MIN_WEB` / `OUTLINE_WEB_UNCHECKED` — the board-material verdict
 * (12 §5). The material is the canonical outer contour minus its cutouts,
 * flattened FINE with the `board-inner` bias so the polygon is a subset of the
 * true material and a chord artefact can only hide a web, never invent one.
 *
 * Every way of not answering reports: no erosion radius, a capped flattening
 * whose deviation eats a tenth of the rule, a kernel refusal, an exhausted
 * budget, a truncated neck list. None of them is a silent pass (§5.1).
 */
function materialWebDrafts(ctx: DrcContext): DrcViolationDraft[] {
  const w = optWebMm(ctx.designRules.outline?.minWebMm);
  if (w === undefined) return [];
  const out: DrcViolationDraft[] = [];
  const unchecked = (why: string): DrcViolationDraft[] => {
    out.push({
      code: "OUTLINE_WEB_UNCHECKED",
      message: `Board material web not checked: ${why}`,
      anchors: [{ kind: "boardEdge" }],
    });
    return out;
  };
  if (!(w / 2 - EROSION_MARGIN_MM > 0)) {
    return unchecked(
      `the ${w.toFixed(4)} mm rule leaves no erosion radius above the ${(2 * EROSION_MARGIN_MM).toFixed(3)} mm floor`,
    );
  }
  const material = boardMaterialRings(
    ctx.board.outline,
    (ctx.board.cutouts ?? []).map((c) => c.shape),
  );
  // Two boundaries contribute their deviation to one measured width, so the
  // flattening's share of the band is `2·δ`. Above a tenth of the rule the
  // certificate is unavailable — an engineering limit, tunable (Astra run 1 #6).
  const slackMm = 2 * material.deviationMm;
  if (slackMm > w / 10) {
    return unchecked(
      `the outline flattens no finer than ${material.deviationMm.toFixed(4)} mm at ${MATERIAL_STEP_MULTIPLIER}× refinement, more than a tenth of the ${w.toFixed(3)} mm rule`,
    );
  }
  const budgets = ctx.copperShapeBudgets;
  let found;
  try {
    // No `tick`: the whole board's material is ONE indivisible unit of work, and
    // `drcDrafts` already checkpoints this stage once. A second tick under
    // `"manufacturability"` would make it read as a per-ITEM stage, which only
    // `pour` and `copperShapeUnit` are (execution contract 09 §6, 11 §5.5).
    //
    // Quiet: a kernel refusal here becomes `OUTLINE_WEB_UNCHECKED` below, and a
    // reported verdict is not a warning.
    found = runKernelQuietly(() =>
      analyseMaterialRegion(material, w, {
        budgets,
        budget: { remaining: budgets.maxErosionsPerUnit },
        work: { remaining: budgets.maxEdgeComparisonsPerUnit },
      }),
    );
  } catch (error) {
    if (error instanceof CopperShapeBudgetError) {
      return unchecked(
        `the ${budgets.maxEdgeComparisonsPerUnit} edge-comparison budget was exhausted`,
      );
    }
    if (!(error instanceof CopperKernelError)) throw error;
    return unchecked("the copper kernel refused the board material");
  }
  const band = `uncertain between ${(w - WEB_ERROR_FLOOR_MM - slackMm).toFixed(4)} and ${w.toFixed(3)} mm`;
  if (found.emptyErosion) {
    out.push({
      code: "OUTLINE_MIN_WEB",
      message: `Board material is narrower than ${w.toFixed(3)} mm everywhere (${band})`,
      anchors: [{ kind: "boardEdge" }],
      locationMm: found.markerMm,
      measuredMm: 0,
      requiredMm: w,
    });
  }
  for (const web of found.webs) {
    // A RING-PAIR width is the exact distance between two boundaries: it
    // carries no chord band, so it does not state one.
    out.push({
      code: "OUTLINE_MIN_WEB",
      message: web.exact
        ? `Board material narrows to ${web.widthMm.toFixed(4)} mm (min ${w.toFixed(3)} mm) between two board boundaries`
        : `Board material narrows to ≈${web.widthMm.toFixed(3)} mm (min ${w.toFixed(3)} mm, ${band})`,
      anchors: [{ kind: "boardEdge" }],
      locationMm: web.locationMm,
      measuredMm: web.widthMm,
      requiredMm: w,
    });
  }
  if (found.exactBudgetSpent) {
    unchecked(
      "the exact boundary-pair comparison budget was exhausted, so some ring pairs were not measured",
    );
  }
  if (found.gridLoss) {
    unchecked(
      "the 0.1 µm fill grid lost more than half of the board material, so the erosion analysis saw a different shape",
    );
  }
  if (found.truncation !== "none" || found.unlocatedCount > 0) {
    unchecked(
      found.truncation === "erosionBudget"
        ? `the erosion budget ${budgets.maxErosionsPerUnit} stopped the search with ${found.unlocatedCount} web${found.unlocatedCount === 1 ? "" : "s"} not located`
        : `${found.unlocatedCount} more web${found.unlocatedCount === 1 ? "" : "s"} not located (cap ${budgets.maxNecksPerUnit})`,
    );
  }
  return out;
}
