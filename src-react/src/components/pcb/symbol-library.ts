import type { Point, Rotation, SymbolEntity } from "./types";
import type { ComponentFamilyType } from "@/../../src-ts/src/core/schemas/component-library.schema";

export const PALETTE_SYMBOL_KIND_MIME = "application/x-openpcb-symbol-kind";

const GRID_STEP_NM = 1_270_000;
const HALF_GRID_STEP_NM = GRID_STEP_NM / 2;

interface LegacySymbolTemplate {
  label: string;
  prefix: string | null;
  value: string;
  pins: Array<{ name: string; position: Point }>;
}

const LEGACY_TEMPLATES: Record<string, LegacySymbolTemplate> = {
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
    label: "Ground",
    prefix: null,
    value: "GND",
    pins: [{ name: "GND", position: { x: 0, y: 0 } }],
  },
  vcc: {
    label: "VCC",
    prefix: null,
    value: "VCC",
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

function generatePinPositions(pinCount: number): Point[] {
  const positions: Point[] = [];
  for (let i = 0; i < pinCount; i++) {
    const col = Math.floor(i / 2);
    positions.push({
      x: col * GRID_STEP_NM,
      y: i % 2 === 0 ? -HALF_GRID_STEP_NM : HALF_GRID_STEP_NM,
    });
  }
  return positions;
}

function getNextReference(prefix: string, symbols: SymbolEntity[]): string {
  const matcher = new RegExp(`^${prefix}(\\d+)$`);
  let nextIndex = 1;
  for (const symbol of symbols) {
    const match = symbol.reference.match(matcher);
    if (!match) continue;
    const value = Number.parseInt(match[1] ?? "0", 10);
    if (Number.isFinite(value)) {
      nextIndex = Math.max(nextIndex, value + 1);
    }
  }
  return `${prefix}${nextIndex}`;
}

function createSymbolFromFamily(
  family: ComponentFamilyType,
  position: Point,
  rotation: Rotation,
  id: string,
  reference: string,
): SymbolEntity {
  const pinDefinitions = family.symbolData.pinDefinitions;
  const pinPositions = generatePinPositions(pinDefinitions.length);
  return {
    id,
    entityType: "symbol",
    symbolKind: family.id,
    reference,
    value: family.symbolData.properties?.value ?? family.displayLabel,
    position,
    rotation,
    mirrored: false,
    pins: pinDefinitions.map((pin, index) => ({
      id: `${id}-pin-${index + 1}`,
      name: pin.name,
      position: pinPositions[index] ?? { x: 0, y: 0 },
    })),
    properties: { ...family.symbolData.properties },
  };
}

function createLegacySymbol(
  kind: string,
  position: Point,
  rotation: Rotation,
  id: string,
  reference: string,
): SymbolEntity {
  const template = LEGACY_TEMPLATES[kind] ?? LEGACY_TEMPLATES.generic_ic!;
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
  kindOrFamily: string | ComponentFamilyType,
  position: Point,
  rotation: Rotation,
  symbols: SymbolEntity[],
): SymbolEntity {
  if (typeof kindOrFamily === "string") {
    const legacyTemplate = LEGACY_TEMPLATES[kindOrFamily];
    if (legacyTemplate) {
      const reference = legacyTemplate.prefix
        ? getNextReference(legacyTemplate.prefix, symbols)
        : legacyTemplate.label;
      return createLegacySymbol(kindOrFamily, position, rotation, crypto.randomUUID(), reference);
    }
    return createLegacySymbol("generic_ic", position, rotation, crypto.randomUUID(), `U${symbols.length + 1}`);
  }
  const family = kindOrFamily;
  const prefix = family.symbolData.referencePrefix || "U";
  const reference = getNextReference(prefix, symbols);
  return createSymbolFromFamily(family, position, rotation, crypto.randomUUID(), reference);
}

export function createPreviewSymbol(
  kindOrFamily: string | ComponentFamilyType,
  position: Point,
  rotation: Rotation,
): SymbolEntity {
  if (typeof kindOrFamily === "string") {
    const legacyTemplate = LEGACY_TEMPLATES[kindOrFamily] ?? LEGACY_TEMPLATES.generic_ic!;
    return createLegacySymbol(kindOrFamily, position, rotation, "__placement-preview__", legacyTemplate.label);
  }
  const family = kindOrFamily;
  return createSymbolFromFamily(family, position, rotation, "__placement-preview__", family.displayLabel);
}

export function getSymbolLabel(kindOrFamily: string | ComponentFamilyType): string {
  if (typeof kindOrFamily === "string") {
    const legacyTemplate = LEGACY_TEMPLATES[kindOrFamily];
    return legacyTemplate?.label ?? kindOrFamily;
  }
  return kindOrFamily.displayLabel;
}

export function getSymbolPrefix(kindOrFamily: string | ComponentFamilyType): string | null {
  if (typeof kindOrFamily === "string") {
    const legacyTemplate = LEGACY_TEMPLATES[kindOrFamily];
    return legacyTemplate?.prefix ?? null;
  }
  return kindOrFamily.symbolData.referencePrefix || null;
}