/**
 * Focus + field recipes shared by every kit control.
 *
 * Tailwind 4 gotcha (T-007): `outline-none` sets `--tw-outline-style: none`,
 * and `focus-visible:outline` / `outline-1` only re-read that variable, so the
 * ring stayed invisible. `focus-visible:outline-solid` sets the style itself.
 * Do not swap it for `outline-hidden`: in 4.3 that also resolves to none.
 */

/** Inset 1px focus ring (dense controls: toolbar, tabs, segmented, rows). */
export const FOCUS_RING =
  "outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus-ring";

/** Same ring drawn 1px outside the element (standalone buttons, filled fills). */
export const FOCUS_RING_OUTSET =
  "outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-focus-ring";

/** The field box: 2px radius, control border, input fill, 11px text. */
export const FIELD_BASE =
  "rounded-control border border-border-control bg-surface-input text-xs text-text-strong placeholder:text-text-disabled transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/** Focus treatment for an element that IS the field (input/select/textarea). */
export const FIELD_FOCUS =
  "outline-none focus-visible:border-selection focus-visible:ring-1 focus-visible:ring-selection/35";

/** Focus treatment for a wrapper that CONTAINS the field (adornments, search). */
export const FIELD_FOCUS_WITHIN =
  "focus-within:border-selection focus-within:ring-1 focus-within:ring-selection/35";

/** Invalid state; place after FIELD_FOCUS so it wins the border colour. */
export const FIELD_INVALID =
  "border-status-danger focus-visible:border-status-danger focus-visible:ring-status-danger/35 focus-within:border-status-danger focus-within:ring-status-danger/35";

/** Heights shared by fields/controls: `md` 22px (default), `sm` 20px. */
export type ControlSize = "sm" | "md";

export const CONTROL_HEIGHT: Record<ControlSize, string> = {
  sm: "h-5",
  md: "h-[22px]",
};
