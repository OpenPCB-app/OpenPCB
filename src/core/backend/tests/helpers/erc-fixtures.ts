import type {
  DesignerPin,
  DesignerPlacedPart,
  DesignerSchematicProjection,
} from "../../../../sdks/designer";

export function ercPin(id: string, electricalType: string, x = 0): DesignerPin {
  return {
    id,
    originPinKey: id,
    number: id,
    name: id,
    electricalType,
    unit: 1,
    localPositionNm: { x, y: 0 },
    worldPositionNm: { x, y: 0 },
  };
}

export function ercPart(pins: DesignerPin[]): DesignerPlacedPart {
  return {
    id: "part",
    componentId: "component",
    reference: "U1",
    value: "",
    positionNm: { x: 0, y: 0 },
    rotationDeg: 0,
    mirrored: false,
    propertiesJson: {},
    pins,
    symbol: {
      symbolId: "symbol",
      name: "symbol",
      referencePrefix: "U",
      sourceHash: null,
      pins: [],
      preview: {
        kind: "symbol",
        units: "mm",
        name: "symbol",
        unitCount: 1,
        graphics: [],
        pins: [],
        labels: [],
        bounds: null,
        warnings: [],
      },
    },
    footprint: {
      footprintId: "footprint",
      name: "footprint",
      mountType: null,
      sourceHash: null,
      preview: null,
    },
  };
}

export function ercProjection(
  overrides: Partial<DesignerSchematicProjection> = {},
): DesignerSchematicProjection {
  return {
    designId: "erc-test",
    revision: 1,
    parts: [],
    wires: [],
    labels: [],
    primitives: [],
    junctions: [],
    nets: [],
    ...overrides,
  };
}

export function ercNetProjection(types: string[]): DesignerSchematicProjection {
  const pins = types.map((type, index) => ercPin(String(index), type));
  return ercProjection({
    parts: [ercPart(pins)],
    nets: [
      {
        id: "net",
        name: "SIG",
        pinIds: pins.map((pin) => pin.id),
        wireIds: ["wire"],
        labelIds: [],
        primitiveIds: [],
      },
    ],
  });
}
