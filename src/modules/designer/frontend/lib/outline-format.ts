import type { DesignerPlacedPart } from "../../../../sdks";

/**
 * Human-readable component class. Prefers the library symbol name (e.g. "NE555",
 * "LM324N"); falls back to a designator-prefix heuristic. Shared by the outline
 * list, the inspector header, and the component-class icon.
 */
export function inferComponentClass(part: DesignerPlacedPart): string {
  const name = part.symbol.name?.trim();
  if (name) return name;
  const ref = part.reference.toUpperCase();
  if (ref.startsWith("C")) return "Capacitor";
  if (ref.startsWith("R")) return "Resistor";
  if (ref.startsWith("L")) return "Inductor";
  if (ref.startsWith("D")) return "Diode";
  if (ref.startsWith("U")) return "IC";
  if (ref.startsWith("Q")) return "Transistor";
  if (ref.startsWith("Y") || ref.startsWith("X")) return "Crystal";
  if (ref.startsWith("SW")) return "Switch";
  if (ref.startsWith("F")) return "Fuse";
  if (ref.startsWith("TP")) return "Test point";
  if (ref.startsWith("J") || ref.startsWith("P")) return "Connector";
  return "Component";
}

/**
 * Value shown in the outline's Value column. Never falls back to the cryptic IPC
 * footprint code (e.g. "DIP794W45P254L1969H508Q14") — uses the part/symbol name
 * when no value is set.
 */
export function partValueLabel(part: DesignerPlacedPart): string {
  const value = part.value.trim();
  if (value) return value;
  return inferComponentClass(part);
}

const DESIGNATOR_RE = /^([A-Za-z]+)(\d+)?(.*)$/;

/**
 * Alphanumeric designator comparison: prefix (locale), then numeric suffix, then
 * trailing text. Numberless refs sort after numbered ones within the same prefix.
 * Yields C1 → D1 → D2 → J1 → R1 … R10 → U1 (not lexical R1, R10, R2).
 */
export function compareDesignators(aRef: string, bRef: string): number {
  const a = DESIGNATOR_RE.exec(aRef.trim());
  const b = DESIGNATOR_RE.exec(bRef.trim());
  if (!a || !b) return aRef.localeCompare(bRef);
  const prefixDelta = (a[1] ?? "").localeCompare(b[1] ?? "");
  if (prefixDelta !== 0) return prefixDelta;
  const aNum = a[2];
  const bNum = b[2];
  if (aNum != null && bNum != null) {
    const numDelta = Number(aNum) - Number(bNum);
    if (numDelta !== 0) return numDelta;
  } else if (aNum != null) {
    return -1;
  } else if (bNum != null) {
    return 1;
  }
  return (a[3] ?? "").localeCompare(b[3] ?? "");
}
