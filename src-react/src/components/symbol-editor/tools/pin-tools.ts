/**
 * Pin Arrangement Tools
 *
 * Utilities for distributing and mirroring pins in the symbol editor.
 */

import type { SymbolPin } from "../types";
import type { Point, Nanometers } from "@/lib/canvas-core/types";

// ---------------------------------------------------------------------------
// Distribute
// ---------------------------------------------------------------------------

/**
 * Evenly distribute pins vertically along a given X position.
 * Returns new pin array with updated positions.
 */
export function distributeVertically(
  pins: SymbolPin[],
  selectedIds: Set<string>,
  spacing: Nanometers,
): SymbolPin[] {
  const selected = pins.filter((p) => selectedIds.has(p.id));
  if (selected.length < 2) return pins;

  // Sort by current Y position
  const sorted = [...selected].sort((a, b) => a.position.y - b.position.y);
  const startY = sorted[0]!.position.y;

  const newPositions = new Map<string, Point>();
  for (let i = 0; i < sorted.length; i++) {
    const pin = sorted[i]!;
    newPositions.set(pin.id, { x: pin.position.x, y: startY + i * spacing });
  }

  return pins.map((p) => {
    const newPos = newPositions.get(p.id);
    return newPos ? { ...p, position: newPos } : p;
  });
}

/**
 * Evenly distribute pins horizontally along a given Y position.
 */
export function distributeHorizontally(
  pins: SymbolPin[],
  selectedIds: Set<string>,
  spacing: Nanometers,
): SymbolPin[] {
  const selected = pins.filter((p) => selectedIds.has(p.id));
  if (selected.length < 2) return pins;

  const sorted = [...selected].sort((a, b) => a.position.x - b.position.x);
  const startX = sorted[0]!.position.x;

  const newPositions = new Map<string, Point>();
  for (let i = 0; i < sorted.length; i++) {
    const pin = sorted[i]!;
    newPositions.set(pin.id, { x: startX + i * spacing, y: pin.position.y });
  }

  return pins.map((p) => {
    const newPos = newPositions.get(p.id);
    return newPos ? { ...p, position: newPos } : p;
  });
}

// ---------------------------------------------------------------------------
// Mirror
// ---------------------------------------------------------------------------

/**
 * Mirror selected pins across the Y axis (flip X positions).
 * Mirrors around the center X of the selected pins.
 */
export function mirrorPinsX(
  pins: SymbolPin[],
  selectedIds: Set<string>,
): SymbolPin[] {
  const selected = pins.filter((p) => selectedIds.has(p.id));
  if (selected.length === 0) return pins;

  const centerX =
    selected.reduce((sum, p) => sum + p.position.x, 0) / selected.length;

  return pins.map((p) => {
    if (!selectedIds.has(p.id)) return p;
    const mirroredX = 2 * centerX - p.position.x;
    const mirroredSide =
      p.side === "left" ? "right" : p.side === "right" ? "left" : p.side;
    return {
      ...p,
      position: { x: mirroredX, y: p.position.y },
      side: mirroredSide,
    };
  });
}

/**
 * Mirror selected pins across the X axis (flip Y positions).
 */
export function mirrorPinsY(
  pins: SymbolPin[],
  selectedIds: Set<string>,
): SymbolPin[] {
  const selected = pins.filter((p) => selectedIds.has(p.id));
  if (selected.length === 0) return pins;

  const centerY =
    selected.reduce((sum, p) => sum + p.position.y, 0) / selected.length;

  return pins.map((p) => {
    if (!selectedIds.has(p.id)) return p;
    const mirroredY = 2 * centerY - p.position.y;
    const mirroredSide =
      p.side === "top" ? "bottom" : p.side === "bottom" ? "top" : p.side;
    return {
      ...p,
      position: { x: p.position.x, y: mirroredY },
      side: mirroredSide,
    };
  });
}
