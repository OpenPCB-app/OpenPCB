/**
 * Industry-standard via geometry presets, matching KiCad / Altium quick-pick
 * lists. Drill (FHS-equivalent input value) + pad diameter; annular ring is
 * derived `(diameter - drill) / 2`.
 *
 * Selection model: the active net class supplies a default; the user may
 * override via this preset list at route-time, or pick "Custom".
 *
 *   Standard 2L : conservative through-via for 2-layer FR4 (KiCad default).
 *   Standard 4L : default for 4-layer designs (matches JLCPCB 4L minimum).
 *   Fine        : dense / HDI-adjacent boards.
 *   Power-S/L   : wider PDN / high-current rails.
 *   Microvia    : forward-compat for HDI laser-drilled vias (Phase C).
 */

export interface PcbViaPreset {
  id: string;
  name: string;
  drillMm: number;
  diameterMm: number;
  /** Annular ring (mm) = (diameterMm - drillMm) / 2. Stored for display. */
  annularRingMm: number;
  description: string;
}

export const VIA_PRESETS: ReadonlyArray<PcbViaPreset> = [
  {
    id: "std-2l",
    name: "Standard 2L",
    drillMm: 0.4,
    diameterMm: 0.8,
    annularRingMm: 0.2,
    description: "Default through-via for 2-layer FR4",
  },
  {
    id: "std-4l",
    name: "Standard 4L",
    drillMm: 0.3,
    diameterMm: 0.6,
    annularRingMm: 0.15,
    description: "Default for 4-layer (JLCPCB 4L min)",
  },
  {
    id: "fine",
    name: "Fine",
    drillMm: 0.2,
    diameterMm: 0.45,
    annularRingMm: 0.125,
    description: "Dense / HDI-adjacent",
  },
  {
    id: "power-s",
    name: "Power-S",
    drillMm: 0.6,
    diameterMm: 1.0,
    annularRingMm: 0.2,
    description: "Power distribution, low-current rails",
  },
  {
    id: "power-l",
    name: "Power-L",
    drillMm: 1.0,
    diameterMm: 1.6,
    annularRingMm: 0.3,
    description: "High-current power rail",
  },
  {
    id: "microvia",
    name: "Microvia",
    drillMm: 0.1,
    diameterMm: 0.3,
    annularRingMm: 0.1,
    description: "HDI / BGA laser-drilled (Phase C)",
  },
];
