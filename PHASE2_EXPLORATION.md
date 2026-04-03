# PHASE2 Exploration

## 1. KiCad footprint payload shape

### Answer

- `FootprintOption.kicadPayload` is **not strongly typed** at the schema boundary. It is `Record<string, unknown> | null`.
- The KiCad footprint parser is internal: `src-ts/src/infrastructure/parsers/kicad/kicad-footprint-parser.ts`.
- Parser output type is `ParsedKicadFootprint`.
- Parsed output definitely contains:
  - pad positions: **yes** (`pads[].position.{x,y}`)
  - pad shapes: **yes** (`circle|rect|oval|roundrect|trapezoid|custom`)
  - pad sizes: **yes** (`pads[].size.{width,height}`)
  - drill holes: **yes** (`drillDiameter`, `drillOffset`)
  - silkscreen / fab / courtyard graphics: **yes**, but as generic `graphics[]` entries with `layer` + raw `data`
  - reference designator position: **yes**, but only indirectly inside `graphics[]` text nodes (`fp_text reference` stored in `data.at` / `data.__args`)
- Seeded builtin footprints store the raw `ParsedKicadFootprint` object directly. Import flow stores a slightly reshaped payload with `rawKicadSource` and `importProvenance`; builtin seed flow does **not** add `importProvenance`.

### Relevant file paths

- `src-ts/src/db/schema/component-variant.ts`
- `src-ts/src/infrastructure/parsers/kicad/kicad-footprint-parser.ts`
- `src-ts/src/seed/seed-builtin-components.ts`
- `src-ts/src/domain/services/component-import-service.ts`
- `lib/components/built-in/footprints/Resistor_SMD.pretty/R_0805_2012Metric.kicad_mod`

### Relevant snippets

```ts
// src-ts/src/db/schema/component-variant.ts
export interface FootprintOption {
  id: string;
  variantId?: string;
  label: string;
  isDefault: boolean;
  kicadPayload: Record<string, unknown> | null;
  model3dOptions?: unknown[];
  densityLevel?: "most" | "nominal" | "least" | null;
  ipcName?: string | null;
}
```

```ts
// src-ts/src/infrastructure/parsers/kicad/kicad-footprint-parser.ts
export interface ParsedKicadFootprint {
  name: string;
  description: string;
  tags: string[];
  pads: ParsedPad[];
  graphics: ParsedGraphic[];
  model3dRefs: Model3DRef[];
  attributes: FootprintAttributes;
  warnings: Array<{ code: string; message: string }>;
  rawSource: string;
}

export interface ParsedPad {
  number: string;
  type: "smd" | "thru_hole" | "np_thru_hole" | "connect";
  shape: "circle" | "rect" | "oval" | "roundrect" | "trapezoid" | "custom";
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  layers: string[];
  roundrectRatio?: number;
  drillDiameter?: number;
  drillOffset?: { x: number; y: number };
}

export interface ParsedGraphic {
  type: "line" | "rect" | "circle" | "arc" | "poly" | "text";
  layer: string;
  data: Record<string, unknown>;
}
```

```ts
// src-ts/src/seed/seed-builtin-components.ts
function loadFootprint(footprintFile: string): Record<string, unknown> {
  const content = readFileSync(join(LIB_ROOT, footprintFile), "utf-8");
  const parsed = parseKicadFootprint(content);
  return parsed as unknown as Record<string, unknown>;
}
```

```ts
// src-ts/src/domain/services/component-import-service.ts
function buildFootprintPayload(footprint: ParsedImportFootprint): Record<string, unknown> {
  return {
    name: footprint.footprint.name,
    description: footprint.footprint.description,
    tags: footprint.footprint.tags,
    pads: footprint.footprint.pads,
    graphics: footprint.footprint.graphics,
    attributes: footprint.footprint.attributes,
    model3dRefs: footprint.footprint.model3dRefs,
    rawKicadSource: footprint.footprint.rawSource,
    importProvenance: { ... },
  };
}
```

### Seeded 0805 resistor example

Builtin seed path loads `R_0805_2012Metric.kicad_mod` and stores the direct parsed object. Actual shape from parsing that file:

```json
{
  "name": "R_0805_2012Metric",
  "description": "Resistor SMD 0805 (2012 Metric), square ... IPC_7351 nominal ...",
  "tags": ["resistor"],
  "pads": [
    {
      "number": "1",
      "type": "smd",
      "shape": "roundrect",
      "position": { "x": -0.9125, "y": 0 },
      "rotation": 0,
      "size": { "width": 1.025, "height": 1.4 },
      "layers": ["F.Cu", "F.Mask", "F.Paste"],
      "roundrectRatio": 0.243902
    }
  ],
  "graphics": [
    { "type": "line", "layer": "F.Fab", "data": { "start": [-1, 0.625], "end": [-1, -0.625], "width": 0.1 } },
    { "type": "line", "layer": "F.SilkS", "data": { "start": [-0.227064, -0.735], "end": [0.227064, -0.735], "width": 0.12 } },
    { "type": "line", "layer": "F.CrtYd", "data": { "start": [-1.68, 0.95], "end": [-1.68, -0.95], "width": 0.05 } },
    { "type": "text", "layer": "F.SilkS", "data": { "at": [0, -1.65], "__args": ["reference", "REF**"] } }
  ],
  "model3dRefs": [
    {
      "path": "${KISYS3DMOD}/Resistor_SMD.3dshapes/R_0805_2012Metric.wrl",
      "resolvedFileName": "R_0805_2012Metric.wrl",
      "offset": { "x": 0, "y": 0, "z": 0 },
      "scale": { "x": 1, "y": 1, "z": 1 },
      "rotation": { "x": 0, "y": 0, "z": 0 }
    }
  ],
  "attributes": { "type": "smd" },
  "warnings": [],
  "rawSource": "(module R_0805_2012Metric ...)"
}
```

### Surprises / planning impact

- `kicadPayload` is structurally rich in practice, but typed only as `Record<string, unknown>`.
- Graphics are not normalized into renderer-friendly primitives; most geometry is buried in `graphics[].data`.
- Reference/value/user text exist, but as generic `text` graphics, not dedicated fields.
- Builtin seeds and import flow store **slightly different payload shapes** (`rawSource` vs `rawKicadSource` / `importProvenance`).

---

## 2. Current schematic document model — wires and pins

### Answer

- Runtime editor types live in `src-react/src/components/pcb/types.ts`.
- Wire endpoints are stored as absolute world coordinates in `wire.points`.
- Pin positions on symbols are stored **relative to the symbol origin** in `symbol.pins[].position`; world coordinates are derived via transform.
- Wires also store `sourcePinId` and `targetPinId` references.
- Connection is **not purely geometric** today: the persisted/runtime wire explicitly references pin IDs, while junction derivation only uses coordinate overlap between wire endpoints.

### Relevant file paths

- `src-react/src/components/pcb/types.ts`
- `src-ts/shared/types/pcb.types.ts`
- `src-react/src/components/pcb/canvas/symbols.ts`

### Relevant snippets

```ts
// src-ts/shared/types/pcb.types.ts
export interface SchematicSymbolPin {
  id: string;
  name: string;
  position: ProjectPoint;
}

export interface SchematicSymbol {
  id: string;
  componentId?: string | null;
  variantId?: string | null;
  libraryPartId?: string | null;
  symbolTemplate?: string | null;
  reference?: string | null;
  position: ProjectPoint;
  rotation?: number;
  pins: SchematicSymbolPin[];
  properties?: Record<string, string>;
}

export interface SchematicWire {
  id: string;
  points: ProjectPoint[];
  sourcePinId: string;
  targetPinId: string;
  net?: string | null;
}
```

```ts
// src-react/src/components/pcb/types.ts
export type EditorSchematicSymbol = SharedSchematicSymbol & {
  entityType: "symbol";
  symbolKind: SymbolKind;
  componentId?: string;
  variantId?: string;
  linkStatus?: "ok" | "missing";
  symbolTemplate?: SymbolTemplate | null;
  mirrored?: boolean;
  reference: string;
  rotation: number;
  value: string;
  pinCount?: number;
};

export interface WireEntity extends BaseEntity, SchematicWire {
  entityType: "wire";
}
```

```ts
// src-react/src/components/pcb/canvas/symbols.ts
export function transformSymbolLocalPoint(symbol: SymbolEntity, point: Point): Point {
  // applies mirror + 0/90/180/270 rotation + adds symbol.position
}

export function getWorldConnectorAnchors(symbol: SymbolEntity): Record<string, Point> {
  return Object.fromEntries(
    symbol.pins.map((pin) => [pin.id, transformSymbolLocalPoint(symbol, pin.position)]),
  );
}
```

### Surprises / planning impact

- The runtime model already separates local pin coordinates from symbol world transform cleanly.
- Wire objects mix both worlds: absolute polyline points + pin ID endpoints.

---

## 3. Current derived connectivity implementation

### Answer

- `deriveWireJunctions()` returns `DerivedJunction[]`.
- It groups endpoints by exact string key `${x}:${y}` — no epsilon/tolerance.
- `deriveConnectivity()` returns `{ nets: [], junctions: deriveWireJunctions(...) }`.
- `nets` is always empty.
- `DerivedNet` is defined, but unused by current derivation.

### Relevant file paths

- `src-react/src/components/pcb/canvas/wires.ts`
- `src-react/src/stores/schematic-store.ts`
- `src-react/src/components/pcb/types.ts`

### Relevant snippets

```ts
// src-react/src/components/pcb/canvas/wires.ts
export function deriveWireJunctions(
  wires: Array<Pick<WireEntity, "id" | "points">>,
): DerivedJunction[] {
  const endpointMap = new Map<string, { position: Point; wireIds: Set<string> }>();

  for (const wire of wires) {
    const firstPoint = wire.points[0];
    const lastPoint = wire.points[wire.points.length - 1];
    for (const point of [firstPoint, lastPoint]) {
      const key = `${point.x}:${point.y}`;
      ...
    }
  }

  return [...endpointMap.entries()]
    .filter(([, entry]) => entry.wireIds.size >= 2)
    .map(([key, entry]) => ({
      id: `junction:${key}`,
      position: entry.position,
      degree: entry.wireIds.size,
      wireIds: [...entry.wireIds].sort(),
    }));
}
```

```ts
// src-react/src/stores/schematic-store.ts
function deriveConnectivity(document: SchematicDocument): DerivedConnectivity {
  return {
    nets: [],
    junctions: deriveWireJunctions(document.wires),
  };
}
```

```ts
// src-react/src/components/pcb/types.ts
export interface DerivedNet {
  id: string;
  name: string | null;
  symbolIds: string[];
  wireIds: string[];
  labelIds: string[];
}
```

### Surprises / planning impact

- Junction derivation only considers **wire endpoints**, not wire segment intersections or pin overlap.
- No tolerance means coordinate mismatch by 1 nm will break connectivity.

---

## 4. Design persistence — current blob shape

### Answer

- Schematic content is saved in DB table `design_sheet`, column `content`.
- `content` is typed as `SchematicProjectDocument`.
- Stored JSON shape is the schematic document only: `id`, `projectId`, `updatedAt`, `version`, `formatVersion`, `title`, `symbols`, `wires`, `labels`.
- There is a broader schema file that defines `PcbProjectDocument` and `ProjectDocumentBundle`, but `DesignService.saveSheetContent()` currently only persists `SchematicProjectDocument` into `design_sheet.content`.
- So adding `pcbLayout` / `pcbContent` **alongside current schematic blob in this column would require schema/service changes**. There is no room in the current strict schematic schema.

### Relevant file paths

- `src-ts/src/domain/services/design-service.ts`
- `src-ts/src/db/schema/design-sheet.ts`
- `src-ts/src/core/schemas/pcb-project.schema.ts`
- `src-ts/shared/types/pcb.types.ts`

### Relevant snippets

```ts
// src-ts/src/db/schema/design-sheet.ts
content: text("content", { mode: "json" })
  .$type<SchematicProjectDocument>()
  .notNull(),
```

```ts
// src-ts/src/domain/services/design-service.ts
async saveSheetContent(
  designId: string,
  sheetIndex: number,
  content: SchematicProjectDocument,
): Promise<Omit<DesignSheetRow, "content">> {
  ...
  await client.update(designSheetTable).set({
    content: content as unknown as SchematicProjectDocument,
    contentHash,
  })
}
```

```ts
// src-ts/src/core/schemas/pcb-project.schema.ts
export const SchematicProjectDocumentSchema = ProjectDocumentIdSchema.extend({
  formatVersion: SchematicProjectDocumentFormatVersionSchema,
  title: z.string().optional(),
  symbols: z.array(SchematicSymbolSchema),
  wires: z.array(SchematicWireSchema),
  labels: z.array(SchematicLabelSchema),
}).strict()
```

```ts
// src-ts/src/core/schemas/pcb-project.schema.ts
export const ProjectDocumentBundleSchema = z.object({
  formatVersion: ProjectDocumentBundleFormatVersionSchema,
  docs: z.object({
    schematic: SchematicProjectDocumentSchema.nullable().optional(),
    pcb: PcbProjectDocumentSchema.nullable().optional(),
    library: LibraryProjectDocumentSchema.nullable().optional(),
    manufacturing: ManufacturingProjectDocumentSchema.nullable().optional(),
  }).strict(),
}).strict()
```

### Surprises / planning impact

- The repo already has a multi-doc bundle schema, but current persistence path is still schematic-only.
- Adding PCB data probably wants either a new persistence path or a move to bundle semantics, not a silent extra key in the current blob.

---

## 5. Canvas infrastructure — what's reusable

### Answer

#### `viewport.ts`
- Units are effectively **schematic nanometers** by convention, not configurable units.
- Functions themselves are mostly generic linear transforms.
- `snapToGrid` is configurable via `gridSize` parameter.
- `fitViewportToBounds` has one schematic-specific assumption: fallback minimum content size `2_540_000` (2.54 mm in nm-ish units).

#### `hit-test.ts`
- It is not generic geometry hit-testing.
- It is tightly coupled to schematic symbols via `SymbolEntity`, `getSymbolBodyBounds`, `getWorldConnectorAnchors`.
- Reuse for PCB pads would require either adaptation or a new PCB-specific hit-test layer.

#### `SchematicCanvas.tsx`
- Render loop is a continuous RAF loop calling `render()` every frame.
- Mouse/drag/wheel events are wired directly on the `<canvas>` element.
- Interaction controller pattern: `useSchematicInteractionController()` exposes store-backed commands (`beginPlacement`, `beginWire`, `commitWire`, `beginDragMove`, etc.).

### Relevant file paths

- `src-react/src/components/pcb/canvas/viewport.ts`
- `src-react/src/components/pcb/canvas/hit-test.ts`
- `src-react/src/components/pcb/canvas/SchematicCanvas.tsx`
- `src-react/src/components/pcb/useSchematicInteractionController.ts`

### Relevant snippets

```ts
// viewport.ts
export function screenToSchematic(screenX: number, screenY: number, viewport: Viewport): Point {
  return {
    x: (screenX - viewport.offsetX) / viewport.zoom,
    y: (screenY - viewport.offsetY) / viewport.zoom,
  };
}

export function schematicToScreen(schematicX: number, schematicY: number, viewport: Viewport): Point {
  return {
    x: schematicX * viewport.zoom + viewport.offsetX,
    y: schematicY * viewport.zoom + viewport.offsetY,
  };
}

export function snapToGrid(point: Point, gridSize: number): Point {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}
```

```ts
// hit-test.ts
export type SchematicHitTarget =
  | { kind: "connector"; symbolId: string; pinId: string }
  | { kind: "body"; symbolId: string }
  | null;

export function createHitTestCache(symbols: SymbolEntity[]): HitTestCache {
  return {
    symbolBounds: Object.fromEntries(symbols.map((symbol) => [symbol.id, getSymbolBodyBounds(symbol)])),
    connectorAnchors: Object.fromEntries(symbols.flatMap((symbol) => Object.entries(getWorldConnectorAnchors(symbol)))),
  };
}
```

```ts
// SchematicCanvas.tsx
useEffect(() => {
  let running = true;
  const loop = () => {
    if (!running) return;
    render();
    rafRef.current = requestAnimationFrame(loop);
  };
  loop();
  return () => { running = false; cancelAnimationFrame(rafRef.current); };
}, [render]);
```

```ts
// useSchematicInteractionController.ts
export interface SchematicInteractionController {
  activateTool(...)
  beginPlacement(...)
  commitPlacement(...)
  beginWire(...)
  commitWire(...)
  beginDragMove(...)
  commitDragMove(...)
  deleteSelectedEntities(...)
}
```

### Surprises / planning impact

- Viewport math is reusable.
- Hit-testing is not; it is symbol/body/connector specific.
- Continuous RAF loop means PCB canvas can follow the same pattern, but not necessarily the same hit-test/cache structures.

---

## 6. Tab switching mechanism

### Answer

- `DesignHeader.tsx` tab buttons just call `setDesignTab(tab.id)` from `useNavigationStore`.
- No special PCB callback/hook runs when clicking the PCB tab; it is just a state change.
- `DesignScreen.tsx` uses conditional render based on `designTab`.
- Components are **not always mounted**; schematic view mounts only when `designTab === "schematic"`, PCB placeholder only when `designTab === "pcb"`.

### Relevant file paths

- `src-react/src/screens/design/DesignHeader.tsx`
- `src-react/src/stores/navigation-store.ts`
- `src-react/src/screens/DesignScreen.tsx`

### Relevant snippets

```ts
// DesignHeader.tsx
const designTab = useNavigationStore((s) => s.designTab);
const setDesignTab = useNavigationStore((s) => s.setDesignTab);

<button onClick={() => setDesignTab(tab.id)}>{tab.label}</button>
```

```ts
// navigation-store.ts
export type DesignTab = "schematic" | "pcb" | "3d" | "bom";
...
designTab: "schematic",
setDesignTab: (tab) => set({ designTab: tab }),
```

```tsx
// DesignScreen.tsx
{designTab === "schematic" ? (
  <div className="relative h-full">
    <SchematicCanvas controller={controller} />
    <FloatingPropertiesPopover />
  </div>
) : null}

{design && designTab === "pcb" && (
  <div className="flex h-full items-center justify-center text-text-muted">
    PCB layout editor — coming soon
  </div>
)}
```

### Surprises / planning impact

- PCB tab is already integrated into navigation/UI state; only rendering logic is missing.

---

## 7. Power symbol handling after Phase 1

### Answer

- `ComponentPalette.tsx` no longer contains embedded GND/VCC items; `EMBEDDED_SYMBOLS` in the palette is an empty array.
- So GND/VCC are effectively expected to come from the component library UI data now.
- Placed symbols created from library components get `componentId` and `variantId`.
- Embedded fallback GND/VCC logic still exists in `symbol-library.ts`, but palette no longer exposes it.
- Any placed library-backed GND symbol would have pin data if `component.symbolData.pinDefinitions` contains pins; symbol creation maps those to runtime `pins[]`.

### Relevant file paths

- `src-react/src/components/pcb/palette/ComponentPalette.tsx`
- `src-react/src/components/pcb/symbol-library.ts`

### Relevant snippets

```ts
// ComponentPalette.tsx
const EMBEDDED_SYMBOLS: Array<...> = [];
```

```ts
// symbol-library.ts
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
```

```ts
// symbol-library.ts
return {
  id,
  entityType: "symbol",
  symbolKind: componentId,
  componentId,
  variantId,
  ...
  pins: pinDefinitions.map((pin, index) => ({
    id: `${id}-pin-${index + 1}`,
    name: pin.name,
    position: pinPositions[index] ?? { x: 0, y: 0 },
  })),
}
```

### Surprises / planning impact

- There is a transitional state: embedded power symbol code still exists, but palette source of truth is now library-driven.
- Actual connectivity participation depends on seeded library symbol pin definitions, not on any special net-symbol logic in the palette.

---

## 8. Existing PCB tab placeholder

### Answer

When the user clicks the PCB tab, `DesignScreen.tsx` renders a plain placeholder `<div>` with text:

`PCB layout editor — coming soon`

It is not an empty component and not nothing.

### Relevant file paths

- `src-react/src/screens/DesignScreen.tsx`

### Relevant snippet

```tsx
{design && designTab === "pcb" && (
  <div className="flex h-full items-center justify-center text-text-muted">
    PCB layout editor — coming soon
  </div>
)}
```

### Surprises / planning impact

- There is zero PCB canvas mounted today.
- Toolbar still renders for both schematic and PCB tabs:

```tsx
{(design || isUnsavedDraft) && (designTab === "schematic" || designTab === "pcb") && (
  <EditorToolbar controller={controller} />
)}
```

- So PCB tab already inherits schematic toolbar UI even though it has no PCB canvas behind it.
