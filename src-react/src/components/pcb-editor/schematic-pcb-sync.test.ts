import { describe, expect, it } from "vitest";
import { syncSchematicToPcb } from "./schematic-pcb-sync";
import { createComponentLibraryIndex } from "@/components/pcb/symbol-library";
import type { EditorSchematicSymbol } from "@/components/pcb/types";
import type { ExtractedNet } from "@/components/pcb/canvas/net-extraction";
import type { PcbDocument } from "./pcb-types";
import type { ComponentType } from "@shared/types/component-library-schema.types";

function makeSymbol(
  id: string,
  reference: string,
  options: { componentId?: string; variantId?: string } = {},
): EditorSchematicSymbol {
  return {
    id,
    entityType: "symbol",
    position: { x: 0, y: 0 },
    rotation: 0,
    pins: [
      { id: `${id}-pin-1`, name: "1", position: { x: 0, y: 0 } },
      { id: `${id}-pin-2`, name: "2", position: { x: 10, y: 0 } },
    ],
    symbolKind: "generic",
    reference,
    value: reference,
    componentId: options.componentId,
    variantId: options.variantId,
  };
}

function makeComponent(id: string): ComponentType {
  const componentId =
    id === "c1"
      ? "019d6000-0000-7000-8000-000000000001"
      : "019d6000-0000-7000-8000-000000000002";
  const variantId =
    id === "c1"
      ? "019d6000-0000-7000-8000-000000000011"
      : "019d6000-0000-7000-8000-000000000012";
  const footprintId =
    id === "c1"
      ? "019d6000-0000-7000-8000-000000000021"
      : "019d6000-0000-7000-8000-000000000022";

  return {
    id: componentId,
    canonicalKey: id,
    displayLabel: id,
    description: "",
    scope: "workspace",
    categoryPath: null,
    tags: [],
    symbolData: {
      referencePrefix: "R",
      pinDefinitions: [
        { name: "1", electricalType: "passive" },
        { name: "2", electricalType: "passive" },
      ],
      pins: [],
      properties: {},
      unitCount: 1,
      bodyGraphics: [],
      rawKicadSource: null,
      symbolTemplate: null,
    },
    defaultVariantId: variantId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    variants: [
      {
        id: variantId,
        componentId,
        canonicalCode: `${id}-variant`,
        humanLabel: `${id} variant`,
        imperialAlias: null,
        metricAlias: null,
        mountType: "smd",
        dimensions: null,
        isDefault: true,
        pinRemapTable: null,
        defaultFootprintOptionId: footprintId,
        footprintOptions: [
          {
            id: footprintId,
            variantId,
            label: `${id} footprint`,
            densityLevel: null,
            ipcName: null,
            isDefault: true,
            model3dOptions: [],
            kicadPayload: {
              name: `${id}-fp`,
              description: "",
              tags: [],
              pads: [
                {
                  number: "1",
                  type: "smd",
                  shape: "rect",
                  position: { x: -1, y: 0 },
                  size: { width: 1, height: 1 },
                  rotation: 0,
                  layers: ["F.Cu"],
                },
                {
                  number: "2",
                  type: "smd",
                  shape: "rect",
                  position: { x: 1, y: 0 },
                  size: { width: 1, height: 1 },
                  rotation: 0,
                  layers: ["F.Cu"],
                },
              ],
              graphics: [],
              model3dRefs: [],
              attributes: { type: "smd" },
              warnings: [],
              rawSource: "",
            },
          },
        ],
      },
    ],
  };
}

function makeExistingDoc(): PcbDocument {
  return {
    boardOutline: { width: 100, height: 80 },
    manufacturerPreset: "jlcpcb_standard",
    netClasses: [
      {
        name: "Default",
        traceWidth: 0.25,
        clearance: 0.2,
        viaDiameter: 0.6,
        viaDrill: 0.3,
      },
    ],
    nets: [],
    placements: [
      {
        id: "pcb-s1",
        schematicSymbolId: "s1",
        componentId: "019d6000-0000-7000-8000-000000000001",
        variantId: "019d6000-0000-7000-8000-000000000011",
        footprintOptionId: "019d6000-0000-7000-8000-000000000021",
        reference: "R1",
        value: "10k",
        position: { x: 42, y: 26 },
        rotation: 90,
        layer: "B.Cu",
        footprintData: makeComponent("c1").variants[0]!.footprintOptions[0]!
          .kicadPayload as never,
      },
    ],
    traces: [],
    vias: [],
    zones: [],
  };
}

describe("syncSchematicToPcb", () => {
  it("preserves existing placement position rotation and layer", () => {
    const symbols = [
      makeSymbol("s1", "R1", {
        componentId: "019d6000-0000-7000-8000-000000000001",
      }),
    ];
    const nets: ExtractedNet[] = [
      {
        id: "net:R1",
        name: "SIG",
        pinIds: ["s1-pin-1"],
        symbolIds: ["s1"],
        wireIds: [],
        labelIds: [],
      },
    ];

    const result = syncSchematicToPcb(
      symbols,
      nets,
      createComponentLibraryIndex([makeComponent("c1")]),
      makeExistingDoc(),
      { width: 100, height: 80 },
    );

    expect(result.placements).toHaveLength(1);
    expect(result.placements[0]?.position).toEqual({ x: 42, y: 26 });
    expect(result.placements[0]?.rotation).toBe(90);
    expect(result.placements[0]?.layer).toBe("B.Cu");
  });

  it("adds new placements removes missing ones and maps pad refs", () => {
    const symbols = [
      makeSymbol("s1", "R1", {
        componentId: "019d6000-0000-7000-8000-000000000001",
      }),
      makeSymbol("s2", "R2", {
        componentId: "019d6000-0000-7000-8000-000000000002",
      }),
    ];
    const nets: ExtractedNet[] = [
      {
        id: "net:SIG",
        name: "SIG",
        pinIds: ["s1-pin-1", "s2-pin-2"],
        symbolIds: ["s1", "s2"],
        wireIds: [],
        labelIds: [],
      },
    ];
    const existing = makeExistingDoc();
    existing.placements.push({
      ...existing.placements[0]!,
      id: "pcb-obsolete",
      schematicSymbolId: "obsolete",
      reference: "R9",
    });

    const result = syncSchematicToPcb(
      symbols,
      nets,
      createComponentLibraryIndex([makeComponent("c1"), makeComponent("c2")]),
      existing,
      { width: 100, height: 80 },
    );

    expect(result.placements.map((placement) => placement.schematicSymbolId)).toEqual([
      "s1",
      "s2",
    ]);
    expect(result.added).toEqual(["R2"]);
    expect(result.removed).toContain("R9");
    expect(result.nets[0]?.padRefs).toEqual([
      { componentId: "pcb-s1", padNumber: "1" },
      { componentId: "pcb-s2", padNumber: "2" },
    ]);
  });

  it("skips builtin power symbols from placement creation", () => {
    const symbols = [
      makeSymbol("power", "#PWR1", { componentId: "builtin:gnd" }),
      makeSymbol("s1", "R1", {
        componentId: "019d6000-0000-7000-8000-000000000001",
      }),
    ];

    const result = syncSchematicToPcb(
      symbols,
      [],
      createComponentLibraryIndex([makeComponent("c1")]),
      null,
      { width: 100, height: 80 },
    );

    expect(result.placements).toHaveLength(1);
    expect(result.placements[0]?.schematicSymbolId).toBe("s1");
  });

  it("normalizes wizard-style footprint payloads for PCB sync", () => {
    const component = makeComponent("c1");
    component.variants[0]!.footprintOptions[0]!.kicadPayload = {
      metadata: {
        name: "ATTINY13A",
        description: "Custom MCU footprint",
        reference: "U",
      },
      pads: [
        {
          id: "pad-1",
          number: "1",
          name: "PB5",
          type: "thru_hole",
          shape: "circle",
          position: { x: -3, y: 4 },
          size: { width: 1.6, height: 1.6 },
          rotation: 0,
          layers: ["*.Cu", "*.Mask"],
          drillDiameter: 0.8,
        },
      ],
      graphics: [
        {
          id: "g-1",
          type: "line",
          layer: "F.SilkS",
          strokeWidth: 0.12,
          start: { x: -4, y: -5 },
          end: { x: 4, y: -5 },
        },
      ],
      importPreservation: {
        rawSource: "(footprint ATTINY13A)",
        sourceFileName: "attiny13a.kicad_mod",
        warnings: [],
        model3dReferences: [],
        attributes: { type: "through_hole" },
      },
    };

    const result = syncSchematicToPcb(
      [
        makeSymbol("s1", "U1", {
          componentId: component.id,
        }),
      ],
      [],
      createComponentLibraryIndex([component]),
      null,
      { width: 100, height: 80 },
    );

    expect(result.placements).toHaveLength(1);
    expect(result.placements[0]?.footprintData.name).toBe("ATTINY13A");
    expect(result.placements[0]?.footprintData.graphics[0]).toEqual({
      type: "line",
      layer: "F.SilkS",
      data: {
        start: { x: -4, y: -5 },
        end: { x: 4, y: -5 },
        width: 0.12,
      },
    });
  });
});
