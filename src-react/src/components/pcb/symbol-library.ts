import type { Point, Rotation, SymbolEntity, SymbolTemplate } from "./types";
import type {
  ComponentType,
  ComponentVariantType,
} from "@/../../src-ts/src/core/schemas/component-library.schema";

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

const libraryComponentsById = new Map<string, ComponentType>();

function getComponentVariants(
  component: ComponentType,
): ComponentVariantType[] {
  if (component.packageVariants.length > 0) {
    return component.packageVariants;
  }

  return component.variants ?? [];
}

function findComponentInLibrary(componentId: string): ComponentType | null {
  const component = libraryComponentsById.get(componentId);
  if (component) {
    return component;
  }

  for (const candidate of libraryComponentsById.values()) {
    if (candidate.component_id === componentId) {
      return candidate;
    }
  }

  return null;
}

function resolveComponentVariant(
  component: ComponentType,
  preferredVariantId?: string,
): ComponentVariantType | null {
  const variants = getComponentVariants(component);
  if (variants.length === 0) {
    return null;
  }

  if (preferredVariantId) {
    const directMatch = variants.find(
      (variant) =>
        variant.id === preferredVariantId ||
        variant.variant_id === preferredVariantId,
    );
    if (directMatch) {
      return directMatch;
    }
  }

  const defaultVariantId =
    component.defaultPackageVariantId ?? component.defaultVariantId ?? null;
  if (defaultVariantId) {
    const configuredDefault = variants.find(
      (variant) =>
        variant.id === defaultVariantId || variant.variant_id === defaultVariantId,
    );
    if (configuredDefault) {
      return configuredDefault;
    }
  }

  return variants.find((variant) => variant.isDefault) ?? variants[0] ?? null;
}

function resolveComponentAndVariant(
  componentId: string,
  preferredVariantId?: string,
): { component: ComponentType; variant: ComponentVariantType } | null {
  const component = findComponentInLibrary(componentId);
  if (!component) {
    return null;
  }

  const variant = resolveComponentVariant(component, preferredVariantId);
  if (!variant) {
    return null;
  }

  return { component, variant };
}

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

function createSymbolFromComponent(
  component: ComponentType,
  variant: ComponentVariantType,
  position: Point,
  rotation: number,
  id: string,
  reference: string,
  mirrored = false,
): SymbolEntity {
  const componentId = component.component_id ?? component.id;
  const variantId = variant.variant_id ?? variant.id;
  const pinDefinitions = component.symbolData.pinDefinitions;
  const pinPositions = generatePinPositions(pinDefinitions.length);
  const properties = { ...component.symbolData.properties };
  delete properties.component_id;
  delete properties.variant_id;

  return {
    id,
    entityType: "symbol",
    symbolKind: componentId,
    componentId,
    variantId,
    libraryPartId: componentId,
    symbolTemplate: component.symbolData.symbolTemplate,
    reference,
    value: component.symbolData.properties?.value ?? component.displayLabel,
    position,
    rotation,
    mirrored,
    pins: pinDefinitions.map((pin, index) => ({
      id: `${id}-pin-${index + 1}`,
      name: pin.name,
      position: pinPositions[index] ?? { x: 0, y: 0 },
    })),
    properties,
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

function requireComponentAndVariant(
  componentOrId: string | ComponentType,
): { component: ComponentType; variant: ComponentVariantType } {
  if (typeof componentOrId === "string") {
    const resolved = resolveComponentAndVariant(componentOrId);
    if (resolved) {
      return resolved;
    }

    throw new Error(
      `Unknown component id: ${componentOrId}. Expected an embedded symbol kind or a component present in the library cache.`,
    );
  }

  const variant = resolveComponentVariant(componentOrId);
  if (!variant) {
    throw new Error(
      `Component ${componentOrId.id} has no variants. Cannot create symbol entity.`,
    );
  }

  return {
    component: componentOrId,
    variant,
  };
}

export function setComponentLibrary(components: ComponentType[]): void {
  libraryComponentsById.clear();
  for (const component of components) {
    libraryComponentsById.set(component.id, component);
    if (component.component_id && component.component_id !== component.id) {
      libraryComponentsById.set(component.component_id, component);
    }
  }
}

export function resolveSymbolEntityFromLibrary(symbol: SymbolEntity): SymbolEntity {
  if (!symbol.componentId) {
    return symbol;
  }

  const resolved = resolveComponentAndVariant(symbol.componentId, symbol.variantId);
  if (!resolved) {
    return symbol;
  }

  return createSymbolFromComponent(
    resolved.component,
    resolved.variant,
    symbol.position,
    symbol.rotation,
    symbol.id,
    symbol.reference,
    symbol.mirrored ?? false,
  );
}

export function createSymbolEntity(
  kindOrComponent: string | ComponentType,
  position: Point,
  rotation: Rotation,
  symbols: SymbolEntity[],
): SymbolEntity {
  if (typeof kindOrComponent === "string") {
    const embeddedDef = EMBEDDED_SYMBOLS[kindOrComponent];
    if (embeddedDef) {
      const reference = embeddedDef.prefix
        ? getNextReference(embeddedDef.prefix, symbols)
        : embeddedDef.label;
      return createEmbeddedSymbol(
        kindOrComponent,
        position,
        rotation,
        crypto.randomUUID(),
        reference,
      );
    }
  }

  const { component, variant } = requireComponentAndVariant(kindOrComponent);
  const prefix = component.symbolData.referencePrefix || "U";
  const reference = getNextReference(prefix, symbols);
  return createSymbolFromComponent(
    component,
    variant,
    position,
    rotation,
    crypto.randomUUID(),
    reference,
  );
}

export function createPreviewSymbol(
  kindOrComponent: string | ComponentType,
  position: Point,
  rotation: Rotation,
): SymbolEntity {
  if (typeof kindOrComponent === "string") {
    const embeddedDef = EMBEDDED_SYMBOLS[kindOrComponent];
    if (embeddedDef) {
      return createEmbeddedSymbol(
        kindOrComponent,
        position,
        rotation,
        "__placement-preview__",
        embeddedDef.label,
      );
    }
  }

  const { component, variant } = requireComponentAndVariant(kindOrComponent);
  return createSymbolFromComponent(
    component,
    variant,
    position,
    rotation,
    "__placement-preview__",
    component.displayLabel,
  );
}

export function getSymbolLabel(
  kindOrComponent: string | ComponentType,
): string {
  if (typeof kindOrComponent === "string") {
    const embeddedDef = EMBEDDED_SYMBOLS[kindOrComponent];
    if (embeddedDef) {
      return embeddedDef.label;
    }

    return findComponentInLibrary(kindOrComponent)?.displayLabel ?? kindOrComponent;
  }

  return kindOrComponent.displayLabel;
}

export function getSymbolPrefix(
  kindOrComponent: string | ComponentType,
): string | null {
  if (typeof kindOrComponent === "string") {
    const embeddedDef = EMBEDDED_SYMBOLS[kindOrComponent];
    if (embeddedDef) {
      return embeddedDef.prefix;
    }

    return (
      findComponentInLibrary(kindOrComponent)?.symbolData.referencePrefix ?? null
    );
  }

  return kindOrComponent.symbolData.referencePrefix || null;
}
