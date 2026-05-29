/**
 * Shared PBR material constants for the 3D board preview.
 *
 * The 3D scene is lit by an IBL environment (see `Board3DCanvas`), so metals
 * (`metalness: 1`) render black without it. The renderer uses Khronos
 * **PBR-Neutral** tone mapping (not ACES), which preserves saturated greens — so
 * the soldermask green can be richer here than it would be under ACES.
 */

// Copper (traces, vias, plated barrels). Front slightly brighter than back.
export const COPPER_COLOR = "#b87333";
export const COPPER_BACK_COLOR = "#8a5a2b";
export const COPPER_METALNESS = 1;
export const COPPER_ROUGHNESS = 0.4;

// Soldermask-over-copper green: the colour the filled regions (traces, pour,
// via rings) read as on a finished board. Matte (non-metallic), distinctly
// lighter than the bare-laminate green so fills stand out from empty space.
export const COPPER_FILL_GREEN = "#418262";
export const COPPER_FILL_ROUGHNESS = 0.85;

// ENIG gold pad finish (exposed copper at soldermask openings). Kept fairly
// rough + low env reflection so pads read as matte gold, not mirror-shiny.
export const ENIG_GOLD_COLOR = "#d9b14a";
export const ENIG_METALNESS = 1;
export const ENIG_ROUGHNESS = 0.55;
export const ENIG_ENV_INTENSITY = 0.5;

// FR4 glass-epoxy core — visible only on the board EDGE (extrude side walls).
// Muted, desaturated brown/tan (real fibreglass), not the gold it used to be.
// The top/bottom faces are an opaque green base (see SOLDERMASK_GREEN) so the
// core never bleeds through the translucent mask and washes out the green.
export const FR4_CORE_COLOR = "#8a7650";
export const FR4_CORE_ROUGHNESS = 0.85;

// Bare-laminate green: soldermask over FR4 with no copper under it — the empty
// space *between* fills, and the opaque green base on the substrate faces.
// Matte (no clearcoat) per design: the board surface should not be glossy.
export const SOLDERMASK_GREEN = "#1e6e4e";
export const SOLDERMASK_ROUGHNESS = 0.9;
export const SOLDERMASK_CLEARCOAT = 0;
export const SOLDERMASK_CLEARCOAT_ROUGHNESS = 0.5;
export const SOLDERMASK_OPACITY = 0.9;
export const SOLDERMASK_ENV_INTENSITY = 0.5;

// Subtle green emissive floor on the board faces/mask so the underside (lit
// only by fill light + IBL) never crushes to black. Kept dark to preserve the
// top-side AO/shadow contrast.
export const BOARD_EMISSIVE = "#04210f";
