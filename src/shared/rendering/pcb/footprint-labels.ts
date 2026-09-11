/**
 * Reference-designator semantics for footprint preview models.
 *
 * A footprint preview model is shared by every placement that uses that
 * library footprint, so the *text* of its reference label is never authoritative
 * — `PcbPlacedPart.reference` is. KiCad footprints normally carry the
 * `${REFERENCE}` / `REF**` placeholder, which the shared `FootprintRenderLayer`
 * rewrites via `placeholderSubstitutions`. But a footprint ingested from a
 * *board* (a `.kicad_pcb` `(footprint …)` instance, as the KiCad project
 * importer synthesizes in `import/kicad-project/ingest-library.ts`) carries the
 * literal designator of whichever instance was ingested first — e.g. every
 * `Resistor_SMD:R_0201_0603Metric` placement ends up silkscreened "R6".
 * Token substitution cannot repair that, because there is no token left.
 *
 * `withPlacementReference` closes the gap on the OpenPCB side: it rewrites
 * role-tagged reference labels to the placement's own designator before the
 * model reaches the shared renderer. Both helpers copy the model instead of
 * mutating it and return the input unchanged when nothing needs rewriting, so
 * React memo identity is preserved on the common path.
 *
 * Moved to `shared/` in S12 (DFM contract 11 §1.2): the silkscreen ARTWORK has
 * to apply the same rebinding and keep-upright rules the canvas applies, or the
 * exported legend would carry another placement's designator, upside-down. The
 * frontend module re-exports this one.
 */
import type { FootprintRenderModel, PreviewLabel } from "../types";

/**
 * `PcbPlacedPart["footprint"]["preview"]` IS a `FootprintRenderModel`; the two
 * aliases are kept because the frontend's callers and its Vitest suite import
 * them by these names.
 */
export type FootprintPreviewModel = FootprintRenderModel;
export type FootprintPreviewLabel = PreviewLabel;

// KiCad reference placeholders. The parser normalizes `${REFERENCE}` → `REF**`,
// but older/fallback parse paths keep the raw token, so match both. Needed
// because the fallback path tags every text as role "footprint-text".
const REFERENCE_PLACEHOLDER_RE = /\$\{REFERENCE\}|REF\*\*/;

export function isRefdesLabel(label: FootprintPreviewLabel): boolean {
  if (label.role === "reference") return true;
  return REFERENCE_PLACEHOLDER_RE.test(label.text);
}

/**
 * Strip reference-designator text from a footprint preview. Used by the
 * 3D board view's "Refdes labels" toggle — bottom-side silk renders the
 * designator mirrored (real fab behaviour), so hiding it is the honest way
 * to get a clean board shot. Value / user silk text is left alone.
 */
export function withoutRefdesLabels(
  model: FootprintPreviewModel,
): FootprintPreviewModel {
  const labels = model.labels.filter((label) => !isRefdesLabel(label));
  if (labels.length === model.labels.length) return model;
  return { ...model, labels };
}

/**
 * Rewrite role-tagged reference labels to `reference`, the designator of the
 * placement being rendered. Placeholder-only labels (`REF**`) are left for the
 * shared renderer's `placeholderSubstitutions` to resolve — it already handles
 * them, and it also covers the `role`-less fallback parse path.
 */
export function withPlacementReference(
  model: FootprintPreviewModel,
  reference: string,
): FootprintPreviewModel {
  if (reference.length === 0) return model;
  let changed = false;
  const labels = model.labels.map((label) => {
    if (label.role !== "reference" || label.text === reference) return label;
    changed = true;
    return { ...label, text: reference };
  });
  return changed ? { ...model, labels } : model;
}

/**
 * THE text one placement's label carries (DFM contract 11 §1.2), composing the
 * two rules that used to live apart: {@link withPlacementReference}'s
 * role-tagged rewrite, and the shared renderer's `placeholderSubstitutions`
 * token pass. The artwork model has no renderer to defer the token to, so a
 * `REF**` label would otherwise reach the fab literally.
 *
 * Only the REFERENCE token is substituted — the canvas passes no `value`, so
 * `${VALUE}` stays as authored on both paths.
 */
export function placementLabelText(
  label: FootprintPreviewLabel,
  reference: string,
): string {
  if (reference.length === 0) return label.text;
  if (label.role === "reference") return reference;
  return label.text.replace(REFERENCE_TOKEN_RE, reference);
}

// Global flags matter: `replace` with a non-global regex rewrites one match.
const REFERENCE_TOKEN_RE = /\$\{REFERENCE\}|REF\*\*/g;

/**
 * KiCad "keep upright" for refdes silk, ported to our transform composition.
 *
 * Both renderers nest the label inside the placement group exactly the same
 * way (`PcbScene.PlacementRender`, 3D `FootprintOverlayLayer`):
 *
 *   groupMatrix = T(position) · Rz(placement.rotationDeg) · S(mirrorX, 1, 1)
 *   labelMatrix = T(label.at)  · Rz(label.rotationDeg)
 *
 * so the glyph's world up-vector angle is
 *   unmirrored: placementRot + labelRot + 90
 *   mirrored:   placementRot − labelRot + 90     (S(−1,1,1)·Rz(θ) = Rz(−θ)·S)
 *
 * Text reads upright while that up-vector points into the upper half-plane,
 * i.e. while the *effective* angle below sits in (−90, 90]. Outside it, add
 * 180° to the label's OWN rotation — which is what KiCad stores and what keeps
 * the fix inside the model copy. The result is KiCad's `GetDrawRotation()`
 * normalization: every refdes ends up in (−90, 90].
 *
 * Mirrored placements (B.Cu, or an explicit `mirrored` flag — the two the 2D
 * and 3D transforms both fold into one X scale) flip the sign of the label's
 * contribution, hence the branch. The *correction* is unchanged: ±180 on the
 * label's rotation shifts the effective angle by 180 either way. The 2D scene's
 * bottom-view mirror (`sceneScaleX = -1`) is deliberately NOT considered: an
 * outer X-mirror maps up-vector angle a → 180 − a, which preserves sin(a), so
 * it flips reading direction but never uprightness.
 *
 * Rotating about the label anchor keeps center/middle-justified text (KiCad's
 * default for footprint refdes, and the parser's fallback) on the same point.
 * Left/right-justified text shifts across its anchor — same as KiCad, which
 * also rotates about the text position.
 *
 * Scoped to refdes labels (`isRefdesLabel`): value/user silk is authored text
 * we have no keep-upright flag for, so we leave it exactly as imported.
 */
export function withUprightRefdesLabels(
  model: FootprintPreviewModel,
  placementRotationDeg: number,
  mirrored: boolean,
): FootprintPreviewModel {
  let changed = false;
  const labels = model.labels.map((label) => {
    if (!isRefdesLabel(label)) return label;
    const next = uprightLabelRotationDeg(
      label.rotationDeg,
      placementRotationDeg,
      mirrored,
    );
    if (next === label.rotationDeg) return label;
    changed = true;
    return { ...label, rotationDeg: next };
  });
  return changed ? { ...model, labels } : model;
}

/** The label rotation that leaves the glyphs reading upright. Exported for tests. */
export function uprightLabelRotationDeg(
  labelRotationDeg: number,
  placementRotationDeg: number,
  mirrored: boolean,
): number {
  const effective =
    placementRotationDeg + (mirrored ? -labelRotationDeg : labelRotationDeg);
  const normalized = ((effective % 360) + 360) % 360;
  // (90, 270] is the upside-down band. 90 and 270 are the two vertical cases;
  // KiCad keeps 90 (reads bottom-to-top) and flips 270, matching (−90, 90].
  return normalized > 90 && normalized <= 270
    ? labelRotationDeg + 180
    : labelRotationDeg;
}
