---
name: component-library
description: "Component library system — symbols, footprints, variants, KiCad import, and library↔designer integration. Use this skill whenever implementing or modifying: component creation (Wizard), component editing, symbol data model, footprint data model, variant management, KiCad .kicad_sym/.kicad_mod parsing, built-in component seeding, library CRUD API, component search/filter, library↔schematic linking, canonical resolution, or the ComponentDetailPage. Trigger for any mention of: component wizard, symbol editor, footprint editor, KiCad import, kicad_sym, kicad_mod, variants, footprint options, component library, library panel, palette, built-in components, or component resolution. Also trigger when user mentions 'library', 'component', 'symbol', 'footprint', 'variant', 'import', 'wizard', or 'KiCad' in the context of the component system."
---

# Component Library Skill

This skill covers the component library system — how components are created, stored, imported, and linked to placed schematic symbols.

## Architecture

```
Component = Symbol + Variants
  Symbol: referencePrefix, pinDefinitions, bodyGraphics, symbolTemplate
  Variant: package code (0805, SOT-23), mountType, footprintOptions
    FootprintOption: label, kicadPayload (parsed footprint data)
```

### Data flow
```
Library DB → API → useComponents() hook → ComponentPalette
  → User drags to schematic → Placed symbol stores componentId + variantId
  → Symbol re-resolved against library on document load (canonical resolution)
```

## Component data model

```typescript
interface Component {
  id: string;
  canonicalKey: string;         // "builtin:resistor" or UUID
  displayLabel: string;
  description: string;
  scope: "builtin" | "user" | "imported";
  categoryPath: string;         // "Passives/Resistors"
  tags: string[];
  symbolData: SymbolData;
  defaultVariantId: string | null;
  variants: Variant[];
}

interface SymbolData {
  referencePrefix: string;      // "R", "C", "L", "#PWR"
  pinDefinitions: PinDefinition[];
  bodyGraphics: BodyPreset | null;
  symbolTemplate: string | null;
  properties: Record<string, string>;
}

interface Variant {
  id: string;
  canonicalCode: string;        // "0805", "SOT-23"
  humanLabel: string;           // "0805 (2012 metric)"
  mountType: "smd" | "through_hole";
  isDefault: boolean;
  footprintOptions: FootprintOption[];
  defaultFootprintOptionId: string;
}

interface FootprintOption {
  id: string;
  label: string;                // "IPC nominal"
  kicadPayload: Record<string, unknown>;  // ParsedKicadFootprint
  isDefault: boolean;
}
```

## Variant semantics

A variant represents a **package + mount type combination** for the same electrical component:
- Resistor 0402 SMD, Resistor 0805 SMD, Resistor THT axial — three variants of "Resistor"
- Each variant has its own footprint
- One variant is marked as default (used when first placed)

## Built-in components

Seeded on first startup from KiCad library files in `src-ts/src/seed/kicad-sources/`:
- **GND**: power symbol, no variants, `scope: "builtin"`, non-deletable
- **VCC**: power symbol, no variants, `scope: "builtin"`, non-deletable
- **Resistor**: 4 variants (0402, 0805, 1206, THT), default 0805

Seed script: `src-ts/src/seed/seed-builtin-components.ts` — idempotent, runs on every startup.

## KiCad format parsing

### Symbol parser
- File: `src-ts/src/infrastructure/parsers/kicad/kicad-symbol-parser.ts`
- Input: `.kicad_sym` file content
- Output: `ParsedKicadSymbol` with pins, graphics, properties

### Footprint parser
- File: `src-ts/src/infrastructure/parsers/kicad/kicad-footprint-parser.ts`
- Input: `.kicad_mod` file content
- Output: `ParsedKicadFootprint` with pads, graphics, 3D model refs

### Import flow
1. User uploads `.kicad_sym` + `.kicad_mod` files
2. Parser extracts symbol + footprint data
3. Component created with symbol from `.kicad_sym`, variant with footprint from `.kicad_mod`

## Library ↔ designer linking

### Placement reference
When a component is placed on the schematic, the symbol stores:
```typescript
{
  componentId: string;    // top-level, canonical
  variantId: string;      // top-level, canonical
}
```

### Canonical resolution
On document load, each symbol's `componentId` is resolved against the current library state:
- If found: pins, value, symbol template refreshed from canonical data
- If not found: `linkStatus: "missing"`, prior minimal state preserved

### Missing-link degradation
Designs can open even if components were deleted from the library. Missing components render with degraded appearance but don't crash.

## Authoring flow

**Create**: ComponentWizard (multi-step: Symbol → Variants & Footprints → 3D → Specs)
**Edit**: Detail page "Edit" button → reopens Wizard pre-filled
**Inspect**: ComponentDetailPage (read-only)

## Key files

| Area | Path |
|------|------|
| Shared schema | `src-ts/src/core/schemas/component-library.schema.ts` |
| Shared types | `src-ts/shared/types/pcb.types.ts` |
| DB schema | `src-ts/src/db/schema/component.ts`, `component-variant.ts` |
| Repository | `src-ts/src/db/repositories/component-repository.ts` |
| Controller | `src-ts/src/transport/controllers/component-controller.ts` |
| Frontend API | `src-react/src/lib/api/component-api.ts` |
| Hooks | `src-react/src/hooks/useComponents.ts` |
| Wizard | `src-react/src/components/wizard/ComponentWizard.tsx` |
| Wizard store | `src-react/src/stores/component-wizard-store.ts` |
| Detail page | `src-react/src/components/library/ComponentDetailPage.tsx` |
| Symbol library | `src-react/src/components/pcb/symbol-library.ts` |
| Palette | `src-react/src/components/pcb/palette/ComponentPalette.tsx` |
| KiCad parsers | `src-ts/src/infrastructure/parsers/kicad/` |
| Seed script | `src-ts/src/seed/seed-builtin-components.ts` |

## Anti-patterns

| Don't | Do instead |
|-------|------------|
| Store `libraryPartId` on placed symbols | Use `componentId` + `variantId` at top level |
| Put component_id in `properties` bag | Top-level field only |
| Create components without variants | Always create at least one variant (even if empty footprint) |
| Delete built-in components | Block delete for `scope: "builtin"` |
| Hardcode GND/VCC in palette | They come from library via `useComponents()` |
| Skip canonical re-resolution on load | Always re-resolve symbols against latest library state |
