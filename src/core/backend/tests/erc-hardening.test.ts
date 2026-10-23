import { describe, expect, test } from "bun:test";
import { runErc } from "../../../modules/designer/backend/erc/erc-engine";
import {
  projectionFromWorld,
  projectionToWorld,
} from "../../../modules/designer/backend/projection-world";
import {
  ercNetProjection,
  ercPart,
  ercPin,
  ercProjection,
} from "./helpers/erc-fixtures";

describe("ERC electrical drive", () => {
  test("two connected inputs need a driver, with one diagnostic per net", () => {
    const report = runErc(ercNetProjection(["input", "input"]));
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toMatchObject({
      code: "UNDRIVEN_INPUT_PIN",
      severity: "warning",
      anchors: [
        { kind: "net", netId: "net" },
        { kind: "pin", pinId: "0" },
        { kind: "pin", pinId: "1" },
      ],
    });
  });

  for (const type of [
    "output",
    "bidirectional",
    "tri_state",
    "power_out",
    "passive",
    "open_collector",
    "open_emitter",
  ]) {
    test(`${type} qualifies as a signal driver`, () => {
      expect(runErc(ercNetProjection(["input", type])).violations).toEqual([]);
    });
  }

  for (const type of [
    "passive",
    "output",
    "input",
    "bidirectional",
    "tri_state",
    "open_collector",
    "open_emitter",
  ]) {
    test(`${type} does not qualify as a power driver`, () => {
      const report = runErc(ercNetProjection(["power_in", type]));
      expect(
        report.violations.some(
          (v) => v.code === "UNDRIVEN_POWER_PIN" && v.severity === "error",
        ),
      ).toBe(true);
    });
  }

  test("power_out drives power_in", () => {
    expect(
      runErc(ercNetProjection(["power_in", "power_out"])).violations,
    ).toEqual([]);
  });

  test("a dangling wire does not supply its only power input", () => {
    const projection = ercProjection({
      parts: [ercPart([ercPin("power", "power_in")])],
      wires: [
        {
          id: "w",
          sourcePinId: "power",
          targetPinId: "open",
          pointsNm: [
            { x: 0, y: 0 },
            { x: 1_000_000, y: 0 },
          ],
        },
      ],
    });
    const derived = projectionFromWorld("d", 1, projectionToWorld(projection));
    expect(runErc(derived).violations.map((v) => v.code)).toEqual([
      "UNDRIVEN_POWER_PIN",
    ]);
  });

  test("a junction does not supply its only power input", () => {
    const projection = ercProjection({
      parts: [ercPart([ercPin("power", "power_in")])],
      primitives: [
        {
          id: "junction",
          kind: "junction",
          positionNm: { x: 0, y: 0 },
          rotationDeg: 0,
        },
      ],
    });
    const derived = projectionFromWorld("d", 1, projectionToWorld(projection));
    expect(runErc(derived).violations.map((v) => v.code)).toEqual([
      "UNDRIVEN_POWER_PIN",
    ]);
  });

  test("power labels name nets without driving them", () => {
    const projection = ercNetProjection(["power_in"]);
    projection.nets[0]!.wireIds = [];
    projection.nets[0]!.primitiveIds = ["pwr"];
    projection.primitives = [
      {
        id: "pwr",
        kind: "pwr",
        railText: "VCC",
        positionNm: { x: 0, y: 0 },
        rotationDeg: 0,
        attached: true,
      },
    ];
    expect(runErc(projection).violations.map((v) => v.code)).toEqual([
      "UNDRIVEN_POWER_PIN",
    ]);
  });

  test("isolated input and power pins keep existing violations without duplicates", () => {
    const projection = ercProjection({
      parts: [
        ercPart([
          ercPin("in", "input"),
          ercPin("power", "power_in", 1_000_000),
        ]),
      ],
    });
    const derived = projectionFromWorld("d", 1, projectionToWorld(projection));
    expect(runErc(derived).violations.map((v) => v.code)).toEqual([
      "UNCONNECTED_INPUT_PIN",
      "UNCONNECTED_INPUT_PIN",
    ]);
  });
});

describe("ERC detached schematic anchors", () => {
  test("reports unattached labels and named ports with precise anchors", () => {
    const projection = ercProjection({
      labels: [
        {
          id: "label",
          text: "SIG",
          positionNm: { x: 0, y: 0 },
          attached: false,
        },
      ],
      primitives: [
        {
          id: "power",
          kind: "pwr",
          railText: "VCC",
          positionNm: { x: 0, y: 0 },
          rotationDeg: 0,
          attached: false,
        },
        {
          id: "ground",
          kind: "gnd",
          positionNm: { x: 0, y: 0 },
          rotationDeg: 0,
          attached: false,
        },
        {
          id: "portal",
          kind: "net_portal",
          portalText: "SIG",
          positionNm: { x: 0, y: 0 },
          rotationDeg: 0,
          attached: false,
        },
        {
          id: "junction",
          kind: "junction",
          positionNm: { x: 0, y: 0 },
          rotationDeg: 0,
          attached: false,
        },
      ],
    });
    const report = runErc(projection);
    expect(report.violations.map((v) => v.code)).toEqual([
      "UNCONNECTED_LABEL",
      "UNCONNECTED_PORT",
      "UNCONNECTED_PORT",
      "UNCONNECTED_PORT",
    ]);
    expect(report.violations[0]?.anchors).toEqual([
      { kind: "label", labelId: "label" },
    ]);
    expect(report.violations[1]?.anchors).toEqual([
      { kind: "primitive", primitiveId: "power" },
    ]);
    expect(report.summary).toEqual({ errors: 0, warnings: 4, infos: 0 });
  });

  test("attached anchors and old fixtures without attachment metadata remain clean", () => {
    const projection = ercProjection({
      labels: [
        {
          id: "attached",
          text: "A",
          positionNm: { x: 0, y: 0 },
          attached: true,
        },
        { id: "legacy", text: "B", positionNm: { x: 0, y: 0 } },
      ],
      primitives: [
        {
          id: "pwr",
          kind: "pwr",
          railText: "VCC",
          positionNm: { x: 0, y: 0 },
          rotationDeg: 0,
          attached: true,
        },
      ],
    });
    expect(runErc(projection).violations).toEqual([]);
  });
});

describe("ERC electrical metadata", () => {
  test("collapsed multi-unit placements cannot report a clean schematic", () => {
    const projection = ercNetProjection(["input", "passive"]);
    projection.parts[0]!.pins[1]!.unit = 2;
    expect(runErc(projection).violations).toEqual([
      {
        code: "MULTI_UNIT_SYMBOL_UNSUPPORTED",
        severity: "error",
        message:
          "Part U1 combines multiple symbol units in one placement; its connections cannot be validated reliably",
        anchors: [{ kind: "part", partId: "part" }],
      },
    ]);
  });

  test("shared unit zero plus one placed unit is supported", () => {
    const projection = ercNetProjection(["input", "passive"]);
    projection.parts[0]!.pins[1]!.unit = 0;
    expect(runErc(projection).violations).toEqual([]);
  });

  test("unknown pin types warn instead of guessing an alias", () => {
    const projection = ercProjection({
      parts: [ercPart([ercPin("power", "power_input")])],
    });
    expect(runErc(projection).violations).toEqual([
      {
        code: "PIN_ELECTRICAL_TYPE_UNKNOWN",
        severity: "warning",
        message: 'Pin U1.power has unsupported electrical type "power_input"',
        anchors: [{ kind: "pin", pinId: "power" }],
      },
    ]);
  });

  test("free and unspecified are known types without invented drive", () => {
    for (const type of ["free", "unspecified"]) {
      expect(
        runErc(ercNetProjection(["input", type])).violations.map((v) => v.code),
      ).toEqual(["UNDRIVEN_INPUT_PIN"]);
    }
  });
});
