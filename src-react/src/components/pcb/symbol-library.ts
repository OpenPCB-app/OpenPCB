import type { Point, Rotation, SymbolEntity, SymbolKind } from "./types";

const GRID_STEP_NM = 1_270_000;
const HALF_GRID_STEP_NM = GRID_STEP_NM / 2;

export const PALETTE_SYMBOL_KIND_MIME = "application/x-openpcb-symbol-kind";

interface SymbolTemplate {
  label: string;
  prefix: string | null;
  value: string;
  pins: Array<{ name: string; position: Point }>;
}

const SYMBOL_TEMPLATES: Record<SymbolKind, SymbolTemplate> = {
  resistor: {
    label: "Resistor",
    prefix: "R",
    value: "10k",
    pins: [
      { name: "1", position: { x: 0, y: 0 } },
      { name: "2", position: { x: GRID_STEP_NM, y: 0 } },
    ],
  },
  capacitor: {
    label: "Capacitor",
    prefix: "C",
    value: "100nF",
    pins: [
      { name: "1", position: { x: 0, y: 0 } },
      { name: "2", position: { x: GRID_STEP_NM, y: 0 } },
    ],
  },
  inductor: {
    label: "Inductor",
    prefix: "L",
    value: "10uH",
    pins: [
      { name: "1", position: { x: 0, y: 0 } },
      { name: "2", position: { x: GRID_STEP_NM, y: 0 } },
    ],
  },
  diode: {
    label: "Diode",
    prefix: "D",
    value: "1N4148",
    pins: [
      { name: "A", position: { x: 0, y: 0 } },
      { name: "K", position: { x: GRID_STEP_NM, y: 0 } },
    ],
  },
  led: {
    label: "LED",
    prefix: "D",
    value: "LED",
    pins: [
      { name: "A", position: { x: 0, y: 0 } },
      { name: "K", position: { x: GRID_STEP_NM, y: 0 } },
    ],
  },
  gnd: {
    label: "GND",
    prefix: null,
    value: "GND",
    pins: [{ name: "GND", position: { x: 0, y: 0 } }],
  },
  vcc_3v3: {
    label: "VCC 3.3V",
    prefix: null,
    value: "3.3V",
    pins: [{ name: "VCC", position: { x: 0, y: 0 } }],
  },
  vcc_5v: {
    label: "VCC 5V",
    prefix: null,
    value: "5V",
    pins: [{ name: "VCC", position: { x: 0, y: 0 } }],
  },
  vcc_12v: {
    label: "VCC 12V",
    prefix: null,
    value: "12V",
    pins: [{ name: "VCC", position: { x: 0, y: 0 } }],
  },
  npn: {
    label: "NPN Transistor",
    prefix: "Q",
    value: "NPN",
    pins: [
      { name: "B", position: { x: 0, y: 0 } },
      { name: "C", position: { x: GRID_STEP_NM, y: -HALF_GRID_STEP_NM } },
      { name: "E", position: { x: GRID_STEP_NM, y: HALF_GRID_STEP_NM } },
    ],
  },
  pnp: {
    label: "PNP Transistor",
    prefix: "Q",
    value: "PNP",
    pins: [
      { name: "B", position: { x: 0, y: 0 } },
      { name: "C", position: { x: GRID_STEP_NM, y: -HALF_GRID_STEP_NM } },
      { name: "E", position: { x: GRID_STEP_NM, y: HALF_GRID_STEP_NM } },
    ],
  },
  nmos: {
    label: "N-MOSFET",
    prefix: "Q",
    value: "NMOS",
    pins: [
      { name: "G", position: { x: 0, y: 0 } },
      { name: "D", position: { x: GRID_STEP_NM, y: -HALF_GRID_STEP_NM } },
      { name: "S", position: { x: GRID_STEP_NM, y: HALF_GRID_STEP_NM } },
    ],
  },
  pmos: {
    label: "P-MOSFET",
    prefix: "Q",
    value: "PMOS",
    pins: [
      { name: "G", position: { x: 0, y: 0 } },
      { name: "D", position: { x: GRID_STEP_NM, y: -HALF_GRID_STEP_NM } },
      { name: "S", position: { x: GRID_STEP_NM, y: HALF_GRID_STEP_NM } },
    ],
  },
  opamp: {
    label: "Op-Amp",
    prefix: "U",
    value: "OpAmp",
    pins: [
      { name: "+", position: { x: 0, y: -HALF_GRID_STEP_NM } },
      { name: "-", position: { x: 0, y: HALF_GRID_STEP_NM } },
      { name: "OUT", position: { x: GRID_STEP_NM, y: 0 } },
    ],
  },
  generic_ic: {
    label: "Generic IC",
    prefix: "U",
    value: "IC",
    pins: [
      { name: "1", position: { x: 0, y: -HALF_GRID_STEP_NM } },
      { name: "2", position: { x: 0, y: HALF_GRID_STEP_NM } },
      { name: "3", position: { x: GRID_STEP_NM, y: -HALF_GRID_STEP_NM } },
      { name: "4", position: { x: GRID_STEP_NM, y: HALF_GRID_STEP_NM } },
    ],
  },
  connector: {
    label: "Connector",
    prefix: "J",
    value: "Conn",
    pins: [
      { name: "1", position: { x: 0, y: -HALF_GRID_STEP_NM } },
      { name: "2", position: { x: 0, y: HALF_GRID_STEP_NM } },
      { name: "3", position: { x: GRID_STEP_NM, y: -HALF_GRID_STEP_NM } },
      { name: "4", position: { x: GRID_STEP_NM, y: HALF_GRID_STEP_NM } },
    ],
  },
};

function getNextReference(prefix: string, symbols: SymbolEntity[]): string {
  const matcher = new RegExp(`^${prefix}(\\d+)$`);
  let nextIndex = 1;

  for (const symbol of symbols) {
    const match = symbol.reference.match(matcher);
    if (!match) {
      continue;
    }

    const value = Number.parseInt(match[1] ?? "0", 10);
    if (Number.isFinite(value)) {
      nextIndex = Math.max(nextIndex, value + 1);
    }
  }

  return `${prefix}${nextIndex}`;
}

function instantiateSymbol(
  kind: SymbolKind,
  position: Point,
  rotation: Rotation,
  id: string,
  reference: string,
): SymbolEntity {
  const template = SYMBOL_TEMPLATES[kind];

  return {
    id,
    entityType: "symbol",
    symbolKind: kind,
    reference,
    value: template.value,
    position,
    rotation,
    mirrored: false,
    pins: template.pins.map((pin, index) => ({
      id: `${id}-pin-${index + 1}`,
      name: pin.name,
      position: { ...pin.position },
    })),
    properties: {},
  };
}

export function createSymbolEntity(
  kind: SymbolKind,
  position: Point,
  rotation: Rotation,
  symbols: SymbolEntity[],
): SymbolEntity {
  const template = SYMBOL_TEMPLATES[kind];
  const reference = template.prefix
    ? getNextReference(template.prefix, symbols)
    : template.label;

  return instantiateSymbol(kind, position, rotation, crypto.randomUUID(), reference);
}

export function createPreviewSymbol(
  kind: SymbolKind,
  position: Point,
  rotation: Rotation,
): SymbolEntity {
  const template = SYMBOL_TEMPLATES[kind];

  return instantiateSymbol(kind, position, rotation, "__placement-preview__", template.label);
}
