import type { SymbolKind } from "./types";

export type SymbolCategory =
  | "power"
  | "passive"
  | "discrete"
  | "ic"
  | "connectors";

export interface DesignerComponentDefinition {
  kind: SymbolKind;
  badge: string | null;
  category: SymbolCategory;
}

export const SYMBOL_CATEGORIES: readonly {
  key: SymbolCategory;
  label: string;
}[] = [
  { key: "power", label: "Power" },
  { key: "passive", label: "Passive" },
  { key: "discrete", label: "Discrete" },
  { key: "ic", label: "IC" },
  { key: "connectors", label: "Connectors" },
];

export const DESIGNER_COMPONENTS: readonly DesignerComponentDefinition[] = [
  // Power
  { kind: "gnd", badge: "GND", category: "power" },
  { kind: "vcc_3v3", badge: "3V3", category: "power" },
  { kind: "vcc_5v", badge: "5V", category: "power" },
  { kind: "vcc_12v", badge: "12V", category: "power" },
  // Passive
  { kind: "resistor", badge: "R", category: "passive" },
  { kind: "capacitor", badge: "C", category: "passive" },
  { kind: "inductor", badge: "L", category: "passive" },
  // Discrete
  { kind: "diode", badge: "D", category: "discrete" },
  { kind: "led", badge: "LED", category: "discrete" },
  { kind: "npn", badge: "Q", category: "discrete" },
  { kind: "pnp", badge: "Q", category: "discrete" },
  { kind: "nmos", badge: "Q", category: "discrete" },
  { kind: "pmos", badge: "Q", category: "discrete" },
  // IC
  { kind: "opamp", badge: "U", category: "ic" },
  { kind: "generic_ic", badge: "U", category: "ic" },
  // Connectors
  { kind: "connector", badge: "J", category: "connectors" },
];

const SYMBOL_KIND_LABELS: Record<SymbolKind, string> = {
  resistor: "Resistor",
  capacitor: "Capacitor",
  inductor: "Inductor",
  diode: "Diode",
  led: "LED",
  gnd: "Ground",
  vcc_3v3: "VCC 3.3V",
  vcc_5v: "VCC 5V",
  vcc_12v: "VCC 12V",
  npn: "NPN Transistor",
  pnp: "PNP Transistor",
  nmos: "N-MOSFET",
  pmos: "P-MOSFET",
  opamp: "Op-Amp",
  generic_ic: "Generic IC",
  connector: "Connector",
};

export function getSymbolKindLabel(kind: SymbolKind): string {
  return SYMBOL_KIND_LABELS[kind];
}
