import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseKicadSymbolLib } from "../../../../src-ts/src/infrastructure/parsers/kicad/kicad-symbol-parser";
import type { ParsedKicadSymbol } from "../../lib/api/component-api";
import {
  classifyImportedSymbol,
  convertParsedKicadSymbolToDraft,
} from "./kicad-import";
import {
  DEFAULT_BODY_HEIGHT,
  DEFAULT_PIN_LENGTH,
  GRID_SIZES,
  PASSIVE_BODY_HEIGHT,
  PASSIVE_BODY_WIDTH,
} from "./types";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../src-ts/src/infrastructure/parsers/kicad/__fixtures__",
);

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

function loadParsedFixture(name: string) {
  return parseKicadSymbolLib(readFixture(name)).symbols[0]!;
}

function createOversizedTwoSidedImportedIc(): ParsedKicadSymbol {
  return {
    name: "ATTINY13A",
    kicadId: null,
    units: 1,
    properties: {
      Reference: "U",
      Value: "ATTINY13A",
    },
    pins: [
      {
        name: "PB5",
        number: "1",
        electricalType: "input",
        direction: "line",
        position: { x: -46.99, y: 3.81 },
        length: 5.08,
        rotation: 0,
        unit: 1,
        hidden: false,
      },
      {
        name: "PB3",
        number: "2",
        electricalType: "input",
        direction: "line",
        position: { x: -46.99, y: 1.27 },
        length: 5.08,
        rotation: 0,
        unit: 1,
        hidden: false,
      },
      {
        name: "PB4",
        number: "3",
        electricalType: "input",
        direction: "line",
        position: { x: -46.99, y: -1.27 },
        length: 5.08,
        rotation: 0,
        unit: 1,
        hidden: false,
      },
      {
        name: "GND",
        number: "4",
        electricalType: "power_in",
        direction: "line",
        position: { x: -46.99, y: -3.81 },
        length: 5.08,
        rotation: 0,
        unit: 1,
        hidden: false,
      },
      {
        name: "VCC",
        number: "8",
        electricalType: "power_in",
        direction: "line",
        position: { x: 46.99, y: 3.81 },
        length: 5.08,
        rotation: 180,
        unit: 1,
        hidden: false,
      },
      {
        name: "PB2",
        number: "7",
        electricalType: "input",
        direction: "line",
        position: { x: 46.99, y: 1.27 },
        length: 5.08,
        rotation: 180,
        unit: 1,
        hidden: false,
      },
      {
        name: "PB1",
        number: "6",
        electricalType: "input",
        direction: "line",
        position: { x: 46.99, y: -1.27 },
        length: 5.08,
        rotation: 180,
        unit: 1,
        hidden: false,
      },
      {
        name: "PB0",
        number: "5",
        electricalType: "input",
        direction: "line",
        position: { x: 46.99, y: -3.81 },
        length: 5.08,
        rotation: 180,
        unit: 1,
        hidden: false,
      },
    ],
    bodyGraphics: [
      {
        unit: 0,
        node: [
          "rectangle",
          ["start", -41.91, -6.35],
          ["end", 41.91, 6.35],
          ["stroke", ["width", 0.0254], ["type", "default"]],
          ["fill", ["type", "none"]],
        ],
      },
    ],
    warnings: [],
    rawSource: "(symbol ATTINY13A)",
  };
}

function createMultiUnitRectangularIc(): ParsedKicadSymbol {
  return {
    name: "DUALIC",
    kicadId: null,
    units: 2,
    properties: {
      Reference: "U",
      Value: "DUALIC",
    },
    pins: [
      {
        name: "A1",
        number: "1",
        electricalType: "input",
        direction: "line",
        position: { x: -7.62, y: 2.54 },
        length: 2.54,
        rotation: 0,
        unit: 1,
        hidden: false,
      },
      {
        name: "A2",
        number: "2",
        electricalType: "input",
        direction: "line",
        position: { x: -7.62, y: -2.54 },
        length: 2.54,
        rotation: 0,
        unit: 1,
        hidden: false,
      },
      {
        name: "A3",
        number: "3",
        electricalType: "output",
        direction: "line",
        position: { x: 7.62, y: 2.54 },
        length: 2.54,
        rotation: 180,
        unit: 1,
        hidden: false,
      },
      {
        name: "A4",
        number: "4",
        electricalType: "output",
        direction: "line",
        position: { x: 7.62, y: -2.54 },
        length: 2.54,
        rotation: 180,
        unit: 1,
        hidden: false,
      },
      {
        name: "B1",
        number: "5",
        electricalType: "input",
        direction: "line",
        position: { x: -7.62, y: 2.54 },
        length: 2.54,
        rotation: 0,
        unit: 2,
        hidden: false,
      },
      {
        name: "B2",
        number: "6",
        electricalType: "input",
        direction: "line",
        position: { x: -7.62, y: -2.54 },
        length: 2.54,
        rotation: 0,
        unit: 2,
        hidden: false,
      },
      {
        name: "B3",
        number: "7",
        electricalType: "output",
        direction: "line",
        position: { x: 7.62, y: 2.54 },
        length: 2.54,
        rotation: 180,
        unit: 2,
        hidden: false,
      },
      {
        name: "B4",
        number: "8",
        electricalType: "output",
        direction: "line",
        position: { x: 7.62, y: -2.54 },
        length: 2.54,
        rotation: 180,
        unit: 2,
        hidden: false,
      },
    ],
    bodyGraphics: [],
    warnings: [],
    rawSource: "(symbol DUALIC)",
  };
}

function rotationToSideForTest(rotation: number) {
  const normalized = ((Math.round(rotation) % 360) + 360) % 360;
  if (normalized === 0) return "left";
  if (normalized === 90) return "bottom";
  if (normalized === 180) return "right";
  if (normalized === 270) return "top";
  return "left";
}

function expectClassificationToBePure(parsed: ParsedKicadSymbol) {
  const before = structuredClone(parsed);
  classifyImportedSymbol(parsed);
  expect(parsed).toEqual(before);
}

function expectDraftPinsToPreserveElectricalMetadata(
  parsed: ParsedKicadSymbol,
  draft: ReturnType<typeof convertParsedKicadSymbolToDraft>,
) {
  expect(
    draft.pins.map((pin) => ({
      name: pin.name,
      number: pin.number,
      electricalType: pin.electricalType,
      side: pin.side,
    })),
  ).toEqual(
    parsed.pins.map((pin) => ({
      name: pin.name,
      number: pin.number,
      electricalType: pin.electricalType,
      side: rotationToSideForTest(pin.rotation),
    })),
  );
}

function expectPinGeometryToChange(
  parsed: ParsedKicadSymbol,
  draft: ReturnType<typeof convertParsedKicadSymbolToDraft>,
) {
  expect(
    draft.pins.some((pin, index) => {
      const original = parsed.pins[index];
      return (
        pin.length !== Math.round((original?.length ?? 0) * 1_000_000) ||
        pin.position.x !==
          Math.round((original?.position.x ?? 0) * 1_000_000) ||
        pin.position.y !== Math.round((original?.position.y ?? 0) * 1_000_000)
      );
    }),
  ).toBe(true);
}

describe("classifyImportedSymbol", () => {
  it("classifies simple resistor fixture as two-terminal passive", () => {
    const parsed = loadParsedFixture("simple_resistor.kicad_sym");

    expect(classifyImportedSymbol(parsed)).toEqual({
      kind: "two-terminal-passive",
      reason: null,
    });
    expectClassificationToBePure(parsed);
  });

  it("classifies LM317T-style regulator fixture as rectangular IC", () => {
    const parsed = loadParsedFixture("lm317t_regulator.kicad_sym");

    expect(classifyImportedSymbol(parsed)).toEqual({
      kind: "rectangular-ic",
      reason: null,
    });
    expectClassificationToBePure(parsed);
  });

  it("classifies mixed multi-unit opamp fixture as unsupported", () => {
    const parsed = loadParsedFixture("multi_unit_opamp.kicad_sym");

    expect(classifyImportedSymbol(parsed)).toMatchObject({
      kind: "unsupported",
      reason: expect.stringContaining(
        "non-rectangular unit 3: classified as two-terminal-passive",
      ),
    });
    expectClassificationToBePure(parsed);
  });

  it("classifies three-side IC fixture as unsupported", () => {
    const parsed = loadParsedFixture("three_side_ic.kicad_sym");

    expect(classifyImportedSymbol(parsed)).toMatchObject({
      kind: "unsupported",
      reason: "pin distribution spans 3 sides",
    });
    expectClassificationToBePure(parsed);
  });

  it("classifies graphics-only fixture as unsupported", () => {
    const parsed = loadParsedFixture("graphics_only.kicad_sym");

    expect(classifyImportedSymbol(parsed)).toMatchObject({
      kind: "unsupported",
      reason: "graphics-only symbol has no pins to classify",
    });
    expectClassificationToBePure(parsed);
  });

  it("classifies clean multi-unit left/right ICs as multi-unit rectangular ICs", () => {
    const parsed = createMultiUnitRectangularIc();

    expect(classifyImportedSymbol(parsed)).toEqual({
      kind: "multi-unit-rectangular-ic",
      reason: null,
    });
    expectClassificationToBePure(parsed);
  });
});

describe("convertParsedKicadSymbolToDraft", () => {
  it("normalizes oversized two-sided imported ICs before draft storage", () => {
    const draft = convertParsedKicadSymbolToDraft(
      createOversizedTwoSidedImportedIc(),
      "attiny13a.kicad_sym",
    );

    expect(draft.body).toMatchObject({
      kind: "blank",
      width: DEFAULT_BODY_HEIGHT,
      height: GRID_SIZES.normal * 10,
    });
    expect(draft.pins[0]).toMatchObject({
      side: "left",
      length: DEFAULT_PIN_LENGTH,
      position: { x: -7_620_000, y: 3_810_000 },
    });
    expect(draft.pins[7]).toMatchObject({
      side: "right",
      length: DEFAULT_PIN_LENGTH,
      position: { x: 7_620_000, y: -3_810_000 },
    });
    expect(draft.graphics).toEqual([
      {
        id: "kicad-rect-0",
        zIndex: 0,
        type: "rect",
        x: -5_080_000,
        y: -6_350_000,
        width: 10_160_000,
        height: 12_700_000,
        filled: false,
        strokeWidth: 0.0254,
      },
    ]);
  });

  it("normalizes supported passive fixtures onto canonical passive metrics", () => {
    const parsed = loadParsedFixture("simple_resistor.kicad_sym");
    const draft = convertParsedKicadSymbolToDraft(
      parsed,
      "simple_resistor.kicad_sym",
    );

    expect(classifyImportedSymbol(parsed)).toEqual({
      kind: "two-terminal-passive",
      reason: null,
    });
    expect(draft.body).toEqual({
      kind: "blank",
      width: PASSIVE_BODY_HEIGHT,
      height: PASSIVE_BODY_WIDTH,
    });
    expect(draft.pins).toMatchObject([
      {
        side: "top",
        length: DEFAULT_PIN_LENGTH,
        position: { x: 0, y: PASSIVE_BODY_WIDTH / 2 + DEFAULT_PIN_LENGTH },
      },
      {
        side: "bottom",
        length: DEFAULT_PIN_LENGTH,
        position: { x: 0, y: -(PASSIVE_BODY_WIDTH / 2 + DEFAULT_PIN_LENGTH) },
      },
    ]);
    expect(draft.graphics).toMatchObject([
      {
        type: "rect",
        x: -PASSIVE_BODY_HEIGHT / 2,
        y: -PASSIVE_BODY_WIDTH / 2,
        width: PASSIVE_BODY_HEIGHT,
        height: PASSIVE_BODY_WIDTH,
      },
    ]);
    expectDraftPinsToPreserveElectricalMetadata(parsed, draft);
    expectPinGeometryToChange(parsed, draft);
  });

  it("parses and imports the LM317T-style regulator fixture", () => {
    const parsed = loadParsedFixture("lm317t_regulator.kicad_sym");
    const draft = convertParsedKicadSymbolToDraft(
      parsed,
      "lm317t_regulator.kicad_sym",
    );

    expect(classifyImportedSymbol(parsed)).toEqual({
      kind: "rectangular-ic",
      reason: null,
    });
    expect(draft.metadata.name).toBe("LM317T");
    expect(draft.pins).toHaveLength(3);
    expect(draft.graphics).toHaveLength(1);
    expect(draft.body).toEqual({
      kind: "blank",
      width: DEFAULT_BODY_HEIGHT,
      height: DEFAULT_BODY_HEIGHT,
    });
    expect(draft.graphics).toMatchObject([
      {
        type: "rect",
        x: -DEFAULT_BODY_HEIGHT / 2,
        y: -DEFAULT_BODY_HEIGHT / 2,
        width: DEFAULT_BODY_HEIGHT,
        height: DEFAULT_BODY_HEIGHT,
      },
    ]);
    expect(draft.pins).toMatchObject([
      {
        side: "left",
        position: { x: -(DEFAULT_BODY_HEIGHT / 2 + DEFAULT_PIN_LENGTH), y: 0 },
        length: DEFAULT_PIN_LENGTH,
      },
      {
        side: "right",
        position: { x: DEFAULT_BODY_HEIGHT / 2 + DEFAULT_PIN_LENGTH, y: 0 },
        length: DEFAULT_PIN_LENGTH,
      },
      {
        side: "bottom",
        position: { x: 0, y: -(DEFAULT_BODY_HEIGHT / 2 + DEFAULT_PIN_LENGTH) },
        length: DEFAULT_PIN_LENGTH,
      },
    ]);
    expect(draft.pins.map((pin) => pin.number)).toEqual(["1", "2", "3"]);
    expect(draft.importPreservation?.warnings).toHaveLength(0);
    expectDraftPinsToPreserveElectricalMetadata(parsed, draft);
    expectPinGeometryToChange(parsed, draft);
  });

  it("preserves mixed multi-unit opamp metadata and warns on unsupported classification", () => {
    const parsed = loadParsedFixture("multi_unit_opamp.kicad_sym");
    const draft = convertParsedKicadSymbolToDraft(
      parsed,
      "multi_unit_opamp.kicad_sym",
    );

    expect(classifyImportedSymbol(parsed)).toMatchObject({
      kind: "unsupported",
      reason: expect.stringContaining("non-rectangular unit 3"),
    });
    expect(draft.importPreservation?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "multi_unit_combined" }),
        expect.objectContaining({
          code: "import_normalization_skipped",
          message: expect.stringContaining(
            "non-rectangular unit 3: classified as two-terminal-passive",
          ),
        }),
      ]),
    );
    expectDraftPinsToPreserveElectricalMetadata(parsed, draft);
  });

  it("falls back for mixed multi-unit fixtures without partially normalizing supported units", () => {
    const parsed = loadParsedFixture("mixed_multi_unit_ic.kicad_sym");
    const draft = convertParsedKicadSymbolToDraft(
      parsed,
      "mixed_multi_unit_ic.kicad_sym",
    );

    expect(classifyImportedSymbol(parsed)).toMatchObject({
      kind: "unsupported",
      reason:
        "multi-unit symbol has unsupported unit 2: pin distribution spans 3 sides",
    });
    expect(draft.importPreservation?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "multi_unit_combined" }),
        expect.objectContaining({
          code: "import_normalization_skipped",
          message: expect.stringContaining("for all 2 units"),
        }),
      ]),
    );
    expect(new Set(draft.pins.map((pin) => pin.length))).toEqual(
      new Set([5_080_000]),
    );
    expect(draft.graphics).toHaveLength(2);
    expectDraftPinsToPreserveElectricalMetadata(parsed, draft);
  });

  it("parses and imports the unsupported three-side IC fixture", () => {
    const parsed = loadParsedFixture("three_side_ic.kicad_sym");
    const draft = convertParsedKicadSymbolToDraft(
      parsed,
      "three_side_ic.kicad_sym",
    );

    expect(classifyImportedSymbol(parsed)).toMatchObject({
      kind: "unsupported",
      reason: "pin distribution spans 3 sides",
    });
    expect(draft.metadata.name).toBe("THREESIDE");
    expect(draft.pins).toHaveLength(4);
    expect(new Set(draft.pins.map((pin) => pin.side))).toEqual(
      new Set(["left", "right", "bottom"]),
    );
    expect(draft.graphics).toHaveLength(1);
    expect(draft.importPreservation?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "import_normalization_skipped",
          message: expect.stringContaining("pin distribution spans 3 sides"),
        }),
      ]),
    );
    expect(draft.pins.find((pin) => pin.number === "4")).toMatchObject({
      side: "bottom",
      length: 2_540_000,
    });
    expectDraftPinsToPreserveElectricalMetadata(parsed, draft);
  });

  it("parses and imports the graphics-only fallback fixture", () => {
    const parsed = loadParsedFixture("graphics_only.kicad_sym");
    const draft = convertParsedKicadSymbolToDraft(
      parsed,
      "graphics_only.kicad_sym",
    );

    expect(classifyImportedSymbol(parsed)).toMatchObject({
      kind: "unsupported",
      reason: "graphics-only symbol has no pins to classify",
    });
    expect(draft.metadata.name).toBe("GRAPHICSONLY");
    expect(draft.pins).toHaveLength(0);
    expect(draft.graphics).toHaveLength(2);
    expect(draft.importPreservation?.unitCount).toBe(1);
    expect(draft.importPreservation?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "import_normalization_skipped",
          message: expect.stringContaining(
            "graphics-only symbol has no pins to classify",
          ),
        }),
      ]),
    );
    expect(draft.graphics).toMatchObject([
      {
        type: "rect",
        x: -5_080_000,
        y: -5_080_000,
        width: 10_160_000,
        height: 10_160_000,
      },
      { type: "polygon" },
    ]);
  });

  it("normalizes text graphics and geometry for oversized two-terminal passive", () => {
    const parsed = loadParsedFixture("text_normalization.kicad_sym");
    const draft = convertParsedKicadSymbolToDraft(
      parsed,
      "text_normalization.kicad_sym",
    );

    expect(classifyImportedSymbol(parsed)).toEqual({
      kind: "two-terminal-passive",
      reason: null,
    });

    const rect = draft.graphics.find((g) => g.type === "rect") as any;
    expect(rect).toBeDefined();

    const text = draft.graphics.find((g) => g.type === "text") as any;
    expect(text).toBeDefined();
    expect(text.content).toBe("hello");
    expect(text.fontSize).toBeCloseTo(0.508, 3);
    expect(text.y).toBeCloseTo(1_016_000, -2);
    expect(text.x).toBeCloseTo(0, 1);

    const overlap = draft.pins.some((pin) => {
      const pinMinY = pin.position.y - 100_000;
      const pinMaxY = pin.position.y + 100_000;
      return text.y > pinMinY && text.y < pinMaxY;
    });
    expect(overlap).toBe(false);
  });
});
