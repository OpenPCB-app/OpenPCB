# Symbol Editor

Canvas-based symbol creation and editing for schematic components.

## Files

| File                       | Purpose                      |
| -------------------------- | ---------------------------- |
| `SymbolEditorCanvas.tsx`   | Main R3F canvas (1154 lines) |
| `SymbolEditorToolbar.tsx`  | Tool selection bar           |
| `SymbolMetadataEditor.tsx` | Name, description, tags      |
| `PinPalette.tsx`           | Pin type selection           |
| `PinPropertiesPanel.tsx`   | Selected pin properties      |
| `symbol-editor-store.ts`   | Local Zustand state          |
| `kicad-import.ts`          | KiCad .kicad_sym parser      |
| `import-normalization.ts`  | Normalize imported symbols   |
| `viewport.ts`              | Camera/zoom utilities        |
| `types.ts`                 | TypeScript interfaces        |
| `tools/`                   | Drawing tool implementations |

## Architecture

```
SymbolEditorCanvas
├── R3F Canvas (render-engine)
│   ├── Grid
│   ├── Symbol body (lines, arcs, rects)
│   ├── Pins
│   └── Selection overlay
├── Interaction controller
└── Tool state machine
```

## Tools

Drawing tools in `tools/`:

- Line tool
- Rectangle tool
- Arc/circle tool
- Pin placement tool
- Selection tool

Tool state managed in `symbol-editor-store.ts`.

## KiCad Import

```typescript
import { parseKicadSymbol } from "./kicad-import";
const symbols = parseKicadSymbol(kicadSymContent);
```

Supports `.kicad_sym` format with S-expression parser.

## Pin Model

```typescript
interface Pin {
  id: string;
  name: string;
  number: string;
  type: "input" | "output" | "bidirectional" | "passive" | "power";
  position: { x: number; y: number };
  rotation: 0 | 90 | 180 | 270;
  length: number;
}
```

## Coordinate System

- Origin at symbol center
- Units: mm (converted to nm for render-engine)
- Grid snap: 2.54mm (100 mil) default

## Testing

```bash
npm run test:react -- src/components/symbol-editor/
```

`kicad-import.test.ts` covers parsing edge cases.

## Integration

Symbol saved to library via `component-library` service:

```typescript
await componentLibraryService.createSymbol(symbolData);
```
