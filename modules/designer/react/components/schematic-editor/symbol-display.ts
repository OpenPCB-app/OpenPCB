export type SymbolCategory = "power" | "passive" | "discrete" | "ic" | "connectors" | "other";

export const SYMBOL_CATEGORIES: readonly {key: SymbolCategory;label: string;}[] = [
  { key: "power", label: "Power" },
  { key: "passive", label: "Passives" },
  { key: "discrete", label: "Discrete" },
  { key: "ic", label: "IC" },
  { key: "connectors", label: "Connectors" },
  { key: "other", label: "Other" },
];

const CATEGORY_PATH_PREFIX_MAP: Record<string, SymbolCategory> = {
  Power: "power",
  Passives: "passive",
  Discrete: "discrete",
  IC: "ic",
  "Integrated Circuits": "ic",
  Connectors: "connectors",
};

export function mapCategoryPathToCategory(categoryPath: string | null): SymbolCategory {
  if (!categoryPath) return "other";
  const firstSegment = categoryPath.split("/")[0];
  if (!firstSegment) return "other";
  return CATEGORY_PATH_PREFIX_MAP[firstSegment] ?? "other";
}

const LEGACY_SYMBOL_KIND_LABELS: Record<string, string> = {
  resistor: "Resistor",
  capacitor: "Capacitor",
  inductor: "Inductor",
  diode: "Diode",
  led: "LED",
  gnd: "Ground",
  vcc: "VCC",
  npn: "NPN Transistor",
  pnp: "PNP Transistor",
  nmos: "N-MOSFET",
  pmos: "P-MOSFET",
  opamp: "Op-Amp",
  generic_ic: "Generic IC",
  connector: "Connector",
};

export function getSymbolKindLabel(kind: string): string {
  return LEGACY_SYMBOL_KIND_LABELS[kind] ?? kind;
}