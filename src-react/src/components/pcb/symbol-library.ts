import type { Point, Rotation, SymbolEntity, SymbolTemplate } from "./types";
import type { ComponentFamilyType } from "@/../../src-ts/src/core/schemas/component-library.schema";

export const PALETTE_SYMBOL_KIND_MIME = "application/x-openpcb-symbol-kind";

const GRID_STEP_NM = 1_270_000;
const HALF_GRID_STEP_NM = GRID_STEP_NM / 2;

interface EmbeddedSymbolDef {
  label: string;
  prefix: string | null;
  value: string;
  symbolTemplate: SymbolTemplate;
  pins: Array<{ name: string; position: Point }>;
}

/**
 * Embedded net-defining symbols (GND/VCC only).
 * All physical components are loaded from the Component Library database.
 */
const EMBEDDED_SYMBOLS: Record<string, EmbeddedSymbolDef> = {
  gnd: {
    label: "Ground",
    prefix: null,
    value: "GND",
    symbolTemplate: "connector",
    pins: [{ name: "GND", position: { x: 0, y: 0 } }],
  },
  vcc: {
    label: "VCC",
    prefix: null,
    value: "VCC",
    symbolTemplate: "connector",
    pins: [{ name: "VCC", position: { x: 0, y: 0 } }],
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
    symbolTemplate: family.symbolData.symbolTemplate,
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

function createEmbeddedSymbol(
  kind: string,
  position: Point,
  rotation: Rotation,
  id: string,
  reference: string,
): SymbolEntity {
  const def = EMBEDDED_SYMBOLS[kind]!;
  return {
    id,
    entityType: "symbol",
    symbolKind: kind,
    symbolTemplate: def.symbolTemplate,
    reference,
    value: def.value,
    position,
    rotation,
    mirrored: false,
    pins: def.pins.map((pin, index) => ({
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
    const embeddedDef = EMBEDDED_SYMBOLS[kindOrFamily];
    if (embeddedDef) {
      const reference = embeddedDef.prefix
        ? getNextReference(embeddedDef.prefix, symbols)
        : embeddedDef.label;
      return createEmbeddedSymbol(
        kindOrFamily,
        position,
        rotation,
        crypto.randomUUID(),
        reference,
      );
    }
    throw new Error(
      `Unknown embedded symbol kind: ${kindOrFamily}. Use ComponentFamilyType for library components.`,
    );
  }
  const family = kindOrFamily;
  const prefix = family.symbolData.referencePrefix || "U";
  const reference = getNextReference(prefix, symbols);
  return createSymbolFromFamily(
    family,
    position,
    rotation,
    crypto.randomUUID(),
    reference,
  );
}

export function createPreviewSymbol(
  kindOrFamily: string | ComponentFamilyType,
  position: Point,
  rotation: Rotation,
): SymbolEntity {
  if (typeof kindOrFamily === "string") {
    const embeddedDef = EMBEDDED_SYMBOLS[kindOrFamily];
    if (!embeddedDef) {
      throw new Error(
        `Unknown embedded symbol kind: ${kindOrFamily}. Use ComponentFamilyType for library components.`,
      );
    }
    return createEmbeddedSymbol(
      kindOrFamily,
      position,
      rotation,
      "__placement-preview__",
      embeddedDef.label,
    );
  }
  const family = kindOrFamily;
  return createSymbolFromFamily(
    family,
    position,
    rotation,
    "__placement-preview__",
    family.displayLabel,
  );
}

export function getSymbolLabel(
  kindOrFamily: string | ComponentFamilyType,
): string {
  if (typeof kindOrFamily === "string") {
    const embeddedDef = EMBEDDED_SYMBOLS[kindOrFamily];
    return embeddedDef?.label ?? kindOrFamily;
  }
  return kindOrFamily.displayLabel;
}

export function getSymbolPrefix(
  kindOrFamily: string | ComponentFamilyType,
): string | null {
  if (typeof kindOrFamily === "string") {
    const embeddedDef = EMBEDDED_SYMBOLS[kindOrFamily];
    return embeddedDef?.prefix ?? null;
  }
  return kindOrFamily.symbolData.referencePrefix || null;
}
