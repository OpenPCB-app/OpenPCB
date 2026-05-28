/**
 * Board coordinates are stored in nanometers (correct for the data model) but
 * must never be shown to users as nm. These formatters convert to millimeters.
 */

const NM_PER_MM = 1_000_000;

export function formatBoardCoord(nm: number): string {
  const mm = nm / NM_PER_MM;
  if (Math.abs(mm) < 0.01) return "0.00"; // suppress -0.00
  return mm.toFixed(2);
}

export function formatBoardPoint(p: { x: number; y: number }): string {
  return `${formatBoardCoord(p.x)} · ${formatBoardCoord(p.y)} mm`;
}
