import { describe, expect, it } from "vitest";
import {
  createComponentLibraryIndex,
  createImportedSymbolLayout,
  createSymbolEntity,
  resolveSymbolEntityFromLibrary,
} from "./symbol-library";
import { toSchematicProjectDocument, type SymbolEntity } from "./types";
import type { ComponentType } from "@shared/types/component-library-schema.types";
import {
  DEFAULT_BODY_HEIGHT,
  DEFAULT_PIN_LENGTH,
  PASSIVE_BODY_HEIGHT,
  PASSIVE_BODY_WIDTH,
} from "../symbol-editor/types";

function makeComponent(): ComponentType {
  return {
    id: "component-attiny13a",
    canonicalKey: "attiny13a-su",
    displayLabel: "ATTINY13A-SU",
    description: "ATtiny13A",
    scope: "workspace",
    categoryPath: null,
    tags: [],
    symbolData: {
      referencePrefix: "IC",
      pinDefinitions: [
        { name: "PB5", electricalType: "input" },
        { name: "PB0", electricalType: "bidirectional" },
      ],
      properties: {},
      unitCount: 1,
      bodyGraphics: [],
      rawKicadSource: "(symbol ATTINY13A)",
      symbolTemplate: null,
    },
    defaultVariantId: "variant-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    variants: [
      {
        id: "variant-1",
        componentId: "component-attiny13a",
        canonicalCode: "default",
        humanLabel: "Default",
        imperialAlias: null,
        metricAlias: null,
        mountType: "smd",
        dimensions: null,
        isDefault: true,
        pinRemapTable: null,
        defaultFootprintOptionId: "footprint-1",
        footprintOptions: [
          {
            id: "footprint-1",
            variantId: "variant-1",
            label: "Default",
            densityLevel: null,
            ipcName: null,
            isDefault: true,
            model3dOptions: [],
            kicadPayload: null,
          },
        ],
      },
    ],
  };
}

describe("symbol-library imported symbol layouts", () => {
  it("preserves already-normalized imported IC layouts", () => {
    const importedLayout = createImportedSymbolLayout({
      pins: [
        {
          id: "draft-pin-1",
          name: "PB5",
          number: "1",
          electricalType: "input",
          side: "left",
          position: { x: -(DEFAULT_BODY_HEIGHT / 2 + DEFAULT_PIN_LENGTH), y: 3_810_000 },
          length: DEFAULT_PIN_LENGTH,
        },
        {
          id: "draft-pin-2",
          name: "PB3",
          number: "2",
          electricalType: "input",
          side: "left",
          position: { x: -(DEFAULT_BODY_HEIGHT / 2 + DEFAULT_PIN_LENGTH), y: 1_270_000 },
          length: DEFAULT_PIN_LENGTH,
        },
        {
          id: "draft-pin-3",
          name: "PB4",
          number: "3",
          electricalType: "input",
          side: "left",
          position: { x: -(DEFAULT_BODY_HEIGHT / 2 + DEFAULT_PIN_LENGTH), y: -1_270_000 },
          length: DEFAULT_PIN_LENGTH,
        },
        {
          id: "draft-pin-4",
          name: "GND",
          number: "4",
          electricalType: "power_in",
          side: "left",
          position: { x: -(DEFAULT_BODY_HEIGHT / 2 + DEFAULT_PIN_LENGTH), y: -3_810_000 },
          length: DEFAULT_PIN_LENGTH,
        },
        {
          id: "draft-pin-5",
          name: "VCC",
          number: "8",
          electricalType: "power_in",
          side: "right",
          position: { x: DEFAULT_BODY_HEIGHT / 2 + DEFAULT_PIN_LENGTH, y: 3_810_000 },
          length: DEFAULT_PIN_LENGTH,
        },
        {
          id: "draft-pin-6",
          name: "PB2",
          number: "7",
          electricalType: "input",
          side: "right",
          position: { x: DEFAULT_BODY_HEIGHT / 2 + DEFAULT_PIN_LENGTH, y: 1_270_000 },
          length: DEFAULT_PIN_LENGTH,
        },
        {
          id: "draft-pin-7",
          name: "PB1",
          number: "6",
          electricalType: "input",
          side: "right",
          position: { x: DEFAULT_BODY_HEIGHT / 2 + DEFAULT_PIN_LENGTH, y: -1_270_000 },
          length: DEFAULT_PIN_LENGTH,
        },
        {
          id: "draft-pin-8",
          name: "PB0",
          number: "5",
          electricalType: "input",
          side: "right",
          position: { x: DEFAULT_BODY_HEIGHT / 2 + DEFAULT_PIN_LENGTH, y: -3_810_000 },
          length: DEFAULT_PIN_LENGTH,
        },
      ],
      graphics: [
        {
          id: "rect-1",
          zIndex: 0,
          type: "rect",
          x: -DEFAULT_BODY_HEIGHT / 2,
          y: -6_350_000,
          width: DEFAULT_BODY_HEIGHT,
          height: 12_700_000,
          filled: false,
          strokeWidth: 25_400,
        },
      ],
    });

    expect(importedLayout.bodyBounds).toEqual({
      minX: -DEFAULT_BODY_HEIGHT / 2,
      minY: -6_350_000,
      maxX: DEFAULT_BODY_HEIGHT / 2,
      maxY: 6_350_000,
    });
    expect(importedLayout.pins[0]).toMatchObject({
      side: "left",
      length: DEFAULT_PIN_LENGTH,
      position: { x: -(DEFAULT_BODY_HEIGHT / 2 + DEFAULT_PIN_LENGTH), y: -3_810_000 },
    });
    expect(importedLayout.pins[7]).toMatchObject({
      side: "right",
      length: DEFAULT_PIN_LENGTH,
      position: { x: DEFAULT_BODY_HEIGHT / 2 + DEFAULT_PIN_LENGTH, y: 3_810_000 },
    });
    expect(importedLayout.graphics).toEqual([
      {
        id: "rect-1",
        zIndex: 0,
        type: "rect",
        x: -DEFAULT_BODY_HEIGHT / 2,
        y: -6_350_000,
        width: DEFAULT_BODY_HEIGHT,
        height: 12_700_000,
        filled: false,
        strokeWidth: 25_400,
      },
    ]);
  });

  it("preserves already-normalized imported passive layouts", () => {
    const importedLayout = createImportedSymbolLayout({
      pins: [
        {
          id: "draft-pin-1",
          name: "1",
          number: "1",
          electricalType: "passive",
          side: "top",
          position: { x: 0, y: PASSIVE_BODY_WIDTH / 2 + DEFAULT_PIN_LENGTH },
          length: DEFAULT_PIN_LENGTH,
        },
        {
          id: "draft-pin-2",
          name: "2",
          number: "2",
          electricalType: "passive",
          side: "bottom",
          position: { x: 0, y: -(PASSIVE_BODY_WIDTH / 2 + DEFAULT_PIN_LENGTH) },
          length: DEFAULT_PIN_LENGTH,
        },
      ],
      graphics: [
        {
          id: "rect-passive",
          zIndex: 0,
          type: "rect",
          x: -PASSIVE_BODY_HEIGHT / 2,
          y: -PASSIVE_BODY_WIDTH / 2,
          width: PASSIVE_BODY_HEIGHT,
          height: PASSIVE_BODY_WIDTH,
          filled: false,
          strokeWidth: 25_400,
        },
      ],
    });

    expect(importedLayout.bodyBounds).toEqual({
      minX: -PASSIVE_BODY_HEIGHT / 2,
      minY: -PASSIVE_BODY_WIDTH / 2,
      maxX: PASSIVE_BODY_HEIGHT / 2,
      maxY: PASSIVE_BODY_WIDTH / 2,
    });
    expect(importedLayout.pins).toMatchObject([
      {
        side: "bottom",
        length: DEFAULT_PIN_LENGTH,
        position: { x: 0, y: -(PASSIVE_BODY_WIDTH / 2 + DEFAULT_PIN_LENGTH) },
      },
      {
        side: "top",
        length: DEFAULT_PIN_LENGTH,
        position: { x: 0, y: PASSIVE_BODY_WIDTH / 2 + DEFAULT_PIN_LENGTH },
      },
    ]);
  });

  it("uses imported symbol pins and graphics when creating placed symbols", () => {
    const component = makeComponent();
    const importedLayout = createImportedSymbolLayout({
      pins: [
        {
          id: "draft-pin-1",
          name: "PB5",
          number: "1",
          electricalType: "input",
          side: "left",
          position: { x: -2_540_000, y: 1_270_000 },
          length: 2_540_000,
        },
        {
          id: "draft-pin-2",
          name: "PB0",
          number: "8",
          electricalType: "bidirectional",
          side: "right",
          position: { x: 2_540_000, y: -1_270_000 },
          length: 2_540_000,
        },
      ],
      graphics: [
        {
          id: "rect-1",
          zIndex: 0,
          type: "rect",
          x: -1_270_000,
          y: -635_000,
          width: 2_540_000,
          height: 1_270_000,
          filled: false,
          strokeWidth: 25_400,
        },
      ],
    });
    const index = createComponentLibraryIndex(
      [component],
      new Map([[component.id, importedLayout]]),
    );

    const symbol = createSymbolEntity(
      component.id,
      { x: 0, y: 0 },
      0,
      [],
      index,
    );

    expect(symbol.pins).toEqual([
      {
        id: `${symbol.id}-pin-1`,
        name: "PB5",
        number: "1",
        position: { x: -2_540_000, y: -1_270_000 },
        side: "left",
        length: 2_540_000,
      },
      {
        id: `${symbol.id}-pin-2`,
        name: "PB0",
        number: "8",
        position: { x: 2_540_000, y: 1_270_000 },
        side: "right",
        length: 2_540_000,
      },
    ]);
    expect(symbol.importedGraphics).toEqual([
      {
        id: "rect-1",
        zIndex: 0,
        type: "rect",
        x: -1_270_000,
        y: -635_000,
        width: 2_540_000,
        height: 1_270_000,
        filled: false,
        strokeWidth: 25_400,
      },
    ]);
    expect(symbol.importedBodyBounds).toEqual({
      minX: -1_270_000,
      minY: -635_000,
      maxX: 1_270_000,
      maxY: 635_000,
    });
  });

  it("strips imported-only pin metadata when serializing schematic documents", () => {
    const symbol: SymbolEntity = {
      id: "symbol-1",
      entityType: "symbol",
      symbolKind: "component-attiny13a",
      componentId: "component-attiny13a",
      variantId: "variant-1",
      symbolTemplate: "generic_ic",
      reference: "IC1",
      position: { x: 0, y: 0 },
      rotation: 0,
      mirrored: false,
      value: "ATTINY13A-SU",
      pins: [
        {
          id: "symbol-1-pin-1",
          name: "PB5",
          number: "1",
          side: "left",
          length: 2_540_000,
          position: { x: -2_540_000, y: -1_270_000 },
        },
      ],
      properties: {},
      importedGraphics: [],
      importedBodyBounds: null,
    };

    const serialized = toSchematicProjectDocument({
      id: "doc-1",
      projectId: "project-1",
      updatedAt: new Date().toISOString(),
      version: 1,
      revision: 1,
      formatVersion: "pcb.schematic-project-document/v1",
      name: "Doc",
      symbols: [symbol],
      wires: [],
      labels: [],
    });

    expect(serialized.symbols[0]?.pins).toEqual([
      {
        id: "symbol-1-pin-1",
        name: "PB5",
        position: { x: -2_540_000, y: -1_270_000 },
      },
    ]);
  });

  it("re-resolves existing document symbols with imported layouts from the library", () => {
    const component = makeComponent();
    const importedLayout = createImportedSymbolLayout({
      pins: [
        {
          id: "draft-pin-1",
          name: "PB5",
          number: "1",
          electricalType: "input",
          side: "left",
          position: { x: -2_540_000, y: 0 },
          length: 2_540_000,
        },
      ],
      graphics: [],
    });
    const index = createComponentLibraryIndex(
      [component],
      new Map([[component.id, importedLayout]]),
    );

    const resolved = resolveSymbolEntityFromLibrary(
      {
        id: "symbol-1",
        entityType: "symbol",
        symbolKind: component.id,
        componentId: component.id,
        variantId: "variant-1",
        symbolTemplate: "generic_ic",
        reference: "IC1",
        position: { x: 100, y: 200 },
        rotation: 0,
        mirrored: false,
        value: component.displayLabel,
        pins: [{ id: "old-pin", name: "old", position: { x: 0, y: 0 } }],
        properties: {},
      },
      index,
    );

    expect(resolved.pins[0]).toMatchObject({
      id: "symbol-1-pin-1",
      name: "PB5",
      number: "1",
      side: "left",
      length: 2_540_000,
      position: { x: -2_540_000, y: -0 },
    });
  });
});
