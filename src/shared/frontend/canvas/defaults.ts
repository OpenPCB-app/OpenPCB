/**
 * Single source of truth for canvas grid sizes, KLC visual constants, and
 * camera defaults. All six canvases (designer schematic + PCB, library
 * symbol/footprint preview, wizard symbol/footprint editor) read from here so
 * the same component looks identical size everywhere.
 */

// ---------------------------------------------------------------------------
// Snap grids — preserved at current values so existing designs don't shift.
// ---------------------------------------------------------------------------

/** Schematic-editor snap grid (mm). */
export const SCHEMATIC_GRID_MM = 2;

/** Schematic snap grid in nanometers. DragDropOverlay snaps in nm; this MUST
 *  remain numerically equal to `SCHEMATIC_GRID_MM * 1_000_000`. */
export const SCHEMATIC_GRID_NM = 2_000_000;

/** PCB snap grid (mm). */
export const PCB_GRID_MM = 0.25;

// ---------------------------------------------------------------------------
// KLC visual constants — KiCad Library Convention reference values used when
// laying out symbol text, gaps, and body strokes.
// ---------------------------------------------------------------------------

/** Default schematic text size (mm). KLC standard = 50 mil = 1.27 mm. */
export const KLC_TEXT_SIZE_MM = 1.27;

/** Distance from pin bodyEnd to its name label (mm). KLC = 20 mil. */
export const PIN_NAME_GAP_MM = 0.508;

/** Distance from pin anchor to its number label (mm). */
export const PIN_NUMBER_GAP_MM = 0.508;

/** Vertical offset of the symbol's reference label above the body (mm). */
export const REFERENCE_OFFSET_MM = 1.27;

/** Vertical offset of the symbol's value label below the body (mm). */
export const VALUE_OFFSET_MM = 1.27;

/** Default symbol body stroke (mm). Slightly lighter than KLC's 10 mil for a
 *  balanced on-screen appearance against text and pin dots. */
export const BODY_STROKE_MM = 0.1;

/** Pin endpoint dot radius in the schematic preview (mm). Sized to be a
 *  visible wiring target without dominating the symbol. */
export const SYMBOL_PIN_DOT_RADIUS_MM = 0.27;

/** Net-label text size in the schematic canvas (mm). Matches KLC text. */
export const NET_LABEL_FONT_MM = 1.27;

// ---------------------------------------------------------------------------
// Camera defaults. EdaCanvas `zoom` ≈ pixels per scene-unit (mm).
// Identical values across all canvases so a part looks the same size whether
// it's shown in the library, the wizard, or the designer.
// ---------------------------------------------------------------------------

/** Default schematic-canvas zoom — designer, library symbol preview, wizard
 *  symbol editor. ~40 px/mm. */
export const DEFAULT_SCHEMATIC_ZOOM = 40;

/** Default PCB-canvas zoom — designer PCB, library footprint preview, wizard
 *  footprint editor. ~8 px/mm (PCB scenes are larger). */
export const DEFAULT_PCB_ZOOM = 8;
