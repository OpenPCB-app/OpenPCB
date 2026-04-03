import type {
  Bounds,
  Point,
  RenderedSymbolPin,
  Rotation,
  SymbolEntity,
  SymbolTemplate,
} from "./types";
import type {
  ComponentType,
  ComponentVariantType,
} from "@shared/types/component-library-schema.types";
import type {
  SymbolDraft,
  SymbolGraphic,
} from "@/components/symbol-editor/types";

export const PALETTE_SYMBOL_KIND_MIME = "application/x-openpcb-symbol-kind";

export interface ImportedSymbolLayout {
  pins: RenderedSymbolPin[];
  graphics: SymbolGraphic[];
  bodyBounds: Bounds | null;
}

const DEFAULT_TWO_TERMINAL_PIN_POSITIONS: Point[] = [
  { x: 0, y: 0 },
  { x: 1_270_000, y: 0 },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function getComponentProperties(component: ComponentType): Record<string, string> {
  const symbolData = asRecord(component.symbolData);
  const properties = asRecord(symbolData?.properties);
  if (!properties) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(properties).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function getReferencePrefix(component: ComponentType): string {
  const symbolData = asRecord(component.symbolData);
  const referencePrefix = symbolData?.referencePrefix;
  if (typeof referencePrefix === "string" && referencePrefix.trim().length > 0) {
    return referencePrefix;
  }

  const properties = getComponentProperties(component);
  const reference = properties.Reference ?? properties.reference;
  if (typeof reference === "string" && reference.trim().length > 0) {
    return reference.replace(/\d+$/u, "");
  }

  return "U";
}

function getComponentValue(component: ComponentType): string {
  const properties = getComponentProperties(component);
  return properties.value ?? properties.Value ?? component.displayLabel;
}

function getTemplateHint(component: ComponentType): string {
  return [
    component.displayLabel,
    component.categoryPath ?? "",
    component.canonicalKey ?? "",
    getReferencePrefix(component),
    getComponentValue(component),
  ]
    .join(" ")
    .toLowerCase();
}

function getNormalizedSymbolKind(component: ComponentType): string {
  const canonicalKey = component.canonicalKey?.toLowerCase() ?? "";
  if (canonicalKey === "builtin:gnd") {
    return "gnd";
  }
  if (canonicalKey === "builtin:vcc") {
    return "vcc";
  }

  const referencePrefix = getReferencePrefix(component).toUpperCase();
  const value = getComponentValue(component).trim().toUpperCase();
  if (referencePrefix === "#PWR" && value === "GND") {
    return "gnd";
  }
  if (referencePrefix === "#PWR" && value === "VCC") {
    return "vcc";
  }

  return component.id;
}

function isTwoTerminalTemplate(template: SymbolTemplate): boolean {
  return ["resistor", "capacitor", "inductor", "diode", "led"].includes(
    template,
  );
}

function getKiCadPins(component: ComponentType): Array<Record<string, unknown>> {
  const symbolData = asRecord(component.symbolData);
  const pins = symbolData?.pins;
  if (!Array.isArray(pins)) {
    return [];
  }

  return pins
    .map((pin) => asRecord(pin))
    .filter((pin): pin is Record<string, unknown> => pin !== null);
}

function getPinPositions(template: SymbolTemplate, pinCount: number): Point[] {
  if (pinCount === 2 && isTwoTerminalTemplate(template)) {
    return DEFAULT_TWO_TERMINAL_PIN_POSITIONS;
  }

  return generatePinPositions(pinCount);
}

function getComponentPins(
  component: ComponentType,
  symbolId: string,
  template: SymbolTemplate,
): SymbolEntity["pins"] {
  const symbolData = asRecord(component.symbolData);
  const pinDefinitions = Array.isArray(symbolData?.pinDefinitions)
    ? symbolData.pinDefinitions
        .map((pin) => asRecord(pin))
        .filter((pin): pin is Record<string, unknown> => pin !== null)
    : [];

  if (pinDefinitions.length > 0) {
    const positions = getPinPositions(template, pinDefinitions.length);
    return pinDefinitions.map((pin, index) => ({
      id: `${symbolId}-pin-${index + 1}`,
      name:
        typeof pin.name === "string" && pin.name.trim().length > 0
          ? pin.name
          : String(index + 1),
      position: positions[index] ?? { x: 0, y: 0 },
    }));
  }

  const kiCadPins = getKiCadPins(component);
  const positions = getPinPositions(template, kiCadPins.length);
  return kiCadPins.map((pin, index) => ({
    id: `${symbolId}-pin-${index + 1}`,
    name:
      typeof pin.name === "string" && pin.name.trim().length > 0
        ? pin.name
        : typeof pin.number === "string" && pin.number.trim().length > 0
          ? pin.number
          : String(index + 1),
    position: positions[index] ?? { x: 0, y: 0 },
  }));
}

function inferSymbolTemplate(component: ComponentType): SymbolTemplate {
  const explicit = component.symbolData?.symbolTemplate;
  if (explicit && typeof explicit === "string" && explicit.trim().length > 0) {
    return explicit;
  }

  const prefix = getReferencePrefix(component).toUpperCase();
  const hint = getTemplateHint(component);

  switch (prefix) {
    case "R":
      return "resistor";
    case "C":
      return "capacitor";
    case "L":
      return "inductor";
    case "D":
      return "diode";
    case "LED":
      return "led";
    case "Q": {
      if (hint.includes("pnp")) return "pnp";
      if (hint.includes("pmos") || hint.includes("p-mos"))
        return "pmos";
      if (hint.includes("nmos") || hint.includes("n-mos"))
        return "nmos";
      return "npn";
    }
    case "U": {
      if (
        hint.includes("opamp") ||
        hint.includes("op-amp") ||
        hint.includes("op amp")
      ) {
        return "opamp";
      }
      return "generic_ic";
    }
    case "J":
    case "P":
    case "CON":
      return "connector";
    default:
      return "generic_ic";
  }
}

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

export interface ComponentLibraryIndex {
  componentsById: ReadonlyMap<string, ComponentType>;
  importedSymbolLayoutsByComponentId: ReadonlyMap<string, ImportedSymbolLayout>;
}

const EMPTY_COMPONENTS_BY_ID = new Map<string, ComponentType>();
const EMPTY_IMPORTED_SYMBOL_LAYOUTS = new Map<string, ImportedSymbolLayout>();

export const EMPTY_COMPONENT_LIBRARY_INDEX: ComponentLibraryIndex = {
  componentsById: EMPTY_COMPONENTS_BY_ID,
  importedSymbolLayoutsByComponentId: EMPTY_IMPORTED_SYMBOL_LAYOUTS,
};

export function createComponentLibraryIndex(
  components: ComponentType[],
  importedSymbolLayoutsByComponentId: ReadonlyMap<string, ImportedSymbolLayout> =
    EMPTY_IMPORTED_SYMBOL_LAYOUTS,
): ComponentLibraryIndex {
  const componentsById = new Map<string, ComponentType>();
  for (const component of components) {
    componentsById.set(component.id, component);
  }

  return { componentsById, importedSymbolLayoutsByComponentId };
}

function clonePoint(point: Point): Point {
  return { x: point.x, y: point.y };
}

function toSchematicPoint(point: Point): Point {
  return { x: point.x, y: -point.y };
}

function toSchematicPinSide(side: RenderedSymbolPin["side"]): RenderedSymbolPin["side"] {
  if (side === "top") return "bottom";
  if (side === "bottom") return "top";
  return side;
}

function cloneImportedGraphic(graphic: SymbolGraphic): SymbolGraphic {
  switch (graphic.type) {
    case "line":
      return {
        ...graphic,
        y1: -graphic.y1,
        y2: -graphic.y2,
      };
    case "rect":
      return {
        ...graphic,
        y: -(graphic.y + graphic.height),
      };
    case "circle":
      return {
        ...graphic,
        cy: -graphic.cy,
      };
    case "arc":
      return {
        ...graphic,
        cy: -graphic.cy,
        startAngle: -graphic.startAngle,
        endAngle: -graphic.endAngle,
      };
    case "polygon":
      return {
        ...graphic,
        points: graphic.points.map(toSchematicPoint),
      };
    case "bezier":
      return {
        ...graphic,
        points: graphic.points.map(toSchematicPoint) as typeof graphic.points,
      };
    case "text":
      return {
        ...graphic,
        y: -graphic.y,
        rotation: -graphic.rotation,
      };
  }
}

function cloneImportedPin(pin: RenderedSymbolPin, symbolId: string, index: number): RenderedSymbolPin {
  return {
    id: `${symbolId}-pin-${index + 1}`,
    name: pin.name,
    number: pin.number,
    position: clonePoint(pin.position),
    side: pin.side,
    length: pin.length,
  };
}

function cloneImportedBounds(bounds: Bounds | null | undefined): Bounds | null {
  if (!bounds) {
    return null;
  }

  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  };
}

function includePoint(bounds: Bounds | null, point: Point): Bounds {
  if (!bounds) {
    return {
      minX: point.x,
      minY: point.y,
      maxX: point.x,
      maxY: point.y,
    };
  }

  return {
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  };
}

function computeImportedBodyBounds(graphics: SymbolGraphic[]): Bounds | null {
  let bounds: Bounds | null = null;

  for (const graphic of graphics) {
    switch (graphic.type) {
      case "line":
        bounds = includePoint(includePoint(bounds, { x: graphic.x1, y: graphic.y1 }), {
          x: graphic.x2,
          y: graphic.y2,
        });
        break;
      case "rect":
        bounds = includePoint(includePoint(bounds, { x: graphic.x, y: graphic.y }), {
          x: graphic.x + graphic.width,
          y: graphic.y + graphic.height,
        });
        break;
      case "circle":
        bounds = includePoint(
          includePoint(bounds, {
            x: graphic.cx - graphic.radius,
            y: graphic.cy - graphic.radius,
          }),
          {
            x: graphic.cx + graphic.radius,
            y: graphic.cy + graphic.radius,
          },
        );
        break;
      case "arc":
        bounds = includePoint(
          includePoint(bounds, {
            x: graphic.cx - graphic.radius,
            y: graphic.cy - graphic.radius,
          }),
          {
            x: graphic.cx + graphic.radius,
            y: graphic.cy + graphic.radius,
          },
        );
        break;
      case "polygon":
        for (const point of graphic.points) {
          bounds = includePoint(bounds, point);
        }
        break;
      case "bezier":
        for (const point of graphic.points) {
          bounds = includePoint(bounds, point);
        }
        break;
      case "text":
        bounds = includePoint(bounds, { x: graphic.x, y: graphic.y });
        break;
    }
  }

  return bounds;
}

export function createImportedSymbolLayout(
  draft: Pick<SymbolDraft, "pins" | "graphics">,
): ImportedSymbolLayout {
  // KiCad schematic-size normalization is owned by convertParsedKicadSymbolToDraft().
  // Drafts reaching the library are already final-scale and must not be resized again.
  const graphics = draft.graphics.map(cloneImportedGraphic);

  return {
    pins: draft.pins.map((pin, index) => ({
      id: `imported-pin-${index + 1}`,
      name: pin.name,
      number: pin.number,
      position: toSchematicPoint(pin.position),
      side: toSchematicPinSide(pin.side),
      length: pin.length,
    })),
    graphics,
    bodyBounds: computeImportedBodyBounds(graphics),
  };
}

function getComponentVariants(
  component: ComponentType,
): ComponentVariantType[] {
  return component.variants;
}

function findComponentInLibrary(
  index: ComponentLibraryIndex,
  componentId: string,
): ComponentType | null {
  return index.componentsById.get(componentId) ?? null;
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
      (variant) => variant.id === preferredVariantId,
    );
    if (directMatch) {
      return directMatch;
    }
  }

  const defaultVariantId = component.defaultVariantId ?? null;
  if (defaultVariantId) {
    const configuredDefault = variants.find(
      (variant) => variant.id === defaultVariantId,
    );
    if (configuredDefault) {
      return configuredDefault;
    }
  }

  return variants.find((variant) => variant.isDefault) ?? variants[0] ?? null;
}

export function resolveComponentAndVariant(
  index: ComponentLibraryIndex,
  componentId: string,
  preferredVariantId?: string,
): { component: ComponentType; variant: ComponentVariantType } | null {
  const component = findComponentInLibrary(index, componentId);
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
  importedLayout: ImportedSymbolLayout | null = null,
): SymbolEntity {
  const componentId = component.id;
  const variantId = variant.id;
  const symbolKind = getNormalizedSymbolKind(component);
  const symbolTemplate = inferSymbolTemplate(component);
  const properties = { ...getComponentProperties(component) };
  delete properties.component_id;
  delete properties.variant_id;

  return {
    id,
    entityType: "symbol",
    symbolKind,
    componentId,
    variantId,
    linkStatus: "ok",
    libraryPartId: componentId,
    symbolTemplate,
    reference,
    value: getComponentValue(component),
    position,
    rotation,
    mirrored,
    pins: importedLayout
      ? importedLayout.pins.map((pin, index) => cloneImportedPin(pin, id, index))
      : getComponentPins(component, id, symbolTemplate),
    importedGraphics: importedLayout?.graphics.map(cloneImportedGraphic),
    importedBodyBounds: cloneImportedBounds(importedLayout?.bodyBounds),
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
  index: ComponentLibraryIndex,
): { component: ComponentType; variant: ComponentVariantType } {
  if (typeof componentOrId === "string") {
    const resolved = resolveComponentAndVariant(index, componentOrId);
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

export function resolveSymbolEntityFromLibrary(
  symbol: SymbolEntity,
  index: ComponentLibraryIndex,
): SymbolEntity {
  if (!symbol.componentId) {
    return symbol;
  }

  const resolved = resolveComponentAndVariant(
    index,
    symbol.componentId,
    symbol.variantId,
  );
  if (!resolved) {
    return {
      ...symbol,
      linkStatus: "missing",
      symbolTemplate: symbol.symbolTemplate ?? "generic_ic",
      value:
        symbol.value && symbol.value.trim().length > 0
          ? symbol.value
          : `Missing ${symbol.componentId}`,
    };
  }

  return createSymbolFromComponent(
    resolved.component,
    resolved.variant,
    symbol.position,
    symbol.rotation,
    symbol.id,
    symbol.reference,
    symbol.mirrored ?? false,
    index.importedSymbolLayoutsByComponentId.get(resolved.component.id) ?? null,
  );
}

export function createSymbolEntity(
  kindOrComponent: string | ComponentType,
  position: Point,
  rotation: Rotation,
  symbols: SymbolEntity[],
  index: ComponentLibraryIndex,
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

  const { component, variant } = requireComponentAndVariant(
    kindOrComponent,
    index,
  );
  const prefix = getReferencePrefix(component);
  const reference = getNextReference(prefix, symbols);
  return createSymbolFromComponent(
    component,
    variant,
    position,
    rotation,
    crypto.randomUUID(),
    reference,
    false,
    index.importedSymbolLayoutsByComponentId.get(component.id) ?? null,
  );
}

export function createPreviewSymbol(
  kindOrComponent: string | ComponentType,
  position: Point,
  rotation: Rotation,
  index: ComponentLibraryIndex,
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

  const { component, variant } = requireComponentAndVariant(
    kindOrComponent,
    index,
  );
  return createSymbolFromComponent(
    component,
    variant,
    position,
    rotation,
    "__placement-preview__",
    component.displayLabel,
    false,
    index.importedSymbolLayoutsByComponentId.get(component.id) ?? null,
  );
}

export function getSymbolLabel(
  kindOrComponent: string | ComponentType,
  index: ComponentLibraryIndex,
): string {
  if (typeof kindOrComponent === "string") {
    const embeddedDef = EMBEDDED_SYMBOLS[kindOrComponent];
    if (embeddedDef) {
      return embeddedDef.label;
    }

    return (
      findComponentInLibrary(index, kindOrComponent)?.displayLabel ??
      kindOrComponent
    );
  }

  return kindOrComponent.displayLabel;
}

export function getSymbolPrefix(
  kindOrComponent: string | ComponentType,
  index: ComponentLibraryIndex,
): string | null {
  if (typeof kindOrComponent === "string") {
    const embeddedDef = EMBEDDED_SYMBOLS[kindOrComponent];
    if (embeddedDef) {
      return embeddedDef.prefix;
    }

    return (
      findComponentInLibrary(index, kindOrComponent)
        ? getReferencePrefix(findComponentInLibrary(index, kindOrComponent)!)
        : null
    );
  }

  return getReferencePrefix(kindOrComponent);
}
