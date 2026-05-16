import { describe, expect, test } from "bun:test";
import { runErc } from "../../../modules/designer/backend/erc/erc-engine";
import type {
  DesignerDerivedNet,
  DesignerPin,
  DesignerPlacedPart,
  DesignerSchematicProjection,
} from "../../../sdks/designer";

function pin(
  id: string,
  number: string,
  electricalType: string,
  name = "P",
): DesignerPin {
  return {
    id,
    originPinKey: id,
    number,
    name,
    electricalType,
    unit: 1,
    localPositionNm: { x: 0, y: 0 },
    worldPositionNm: { x: 0, y: 0 },
  };
}

function part(
  id: string,
  reference: string,
  pins: DesignerPin[],
): DesignerPlacedPart {
  return {
    id,
    componentId: "comp-1",
    reference,
    value: "X",
    positionNm: { x: 0, y: 0 },
    rotationDeg: 0,
    mirrored: false,
    propertiesJson: {},
    symbol: {
      symbolId: "sym",
      name: "sym",
      referencePrefix: null,
      sourceHash: null,
      pins: [],
      preview: {
        kind: "symbol",
        units: "mm",
        name: "sym",
        unitCount: 1,
        graphics: [],
        pins: [],
        labels: [],
        bounds: null,
        warnings: [],
      },
    },
    footprint: {
      footprintId: "fp",
      name: "fp",
      mountType: null,
      sourceHash: null,
      preview: null,
    },
    pins,
  };
}

function net(id: string, name: string, pinIds: string[]): DesignerDerivedNet {
  return { id, name, pinIds, wireIds: [], labelIds: [], primitiveIds: [] };
}

function projection(
  parts: DesignerPlacedPart[],
  nets: DesignerDerivedNet[],
): DesignerSchematicProjection {
  return {
    designId: "d-test",
    revision: 1,
    parts,
    wires: [],
    labels: [],
    primitives: [],
    junctions: [],
    nets,
  };
}

describe("ERC engine", () => {
  test("clean design produces no violations", () => {
    const p = part("u1", "U1", [
      pin("u1-1", "1", "input"),
      pin("u1-2", "2", "output"),
    ]);
    const proj = projection([p], [net("n-vcc", "VCC", ["u1-1", "u1-2"])]);
    const report = runErc(proj);
    expect(report.violations).toEqual([]);
    expect(report.summary).toEqual({ errors: 0, warnings: 0, infos: 0 });
  });

  test("flags unconnected input pin as warning", () => {
    const p = part("u1", "U1", [pin("u1-1", "1", "input")]);
    const report = runErc(projection([p], []));
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.code).toBe("UNCONNECTED_INPUT_PIN");
    expect(report.violations[0]?.severity).toBe("warning");
    expect(report.summary.warnings).toBe(1);
  });

  test("flags unconnected power_in as error", () => {
    const p = part("u1", "U1", [pin("u1-1", "VCC", "power_in")]);
    const report = runErc(projection([p], []));
    expect(report.violations[0]?.code).toBe("UNCONNECTED_INPUT_PIN");
    expect(report.violations[0]?.severity).toBe("error");
  });

  test("does not flag unconnected output / passive / no_connect as unconnected", () => {
    const p = part("u1", "U1", [
      pin("u1-1", "1", "output"),
      pin("u1-2", "2", "passive"),
      pin("u1-3", "3", "no_connect"),
    ]);
    const report = runErc(projection([p], []));
    expect(
      report.violations.filter((v) => v.code === "UNCONNECTED_INPUT_PIN"),
    ).toEqual([]);
  });

  test("flags two outputs on the same net as error", () => {
    const a = part("u1", "U1", [pin("u1-1", "1", "output")]);
    const b = part("u2", "U2", [pin("u2-1", "1", "output")]);
    const report = runErc(
      projection([a, b], [net("n-clash", "CLASH", ["u1-1", "u2-1"])]),
    );
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.code).toBe("OUTPUT_OUTPUT_SHORT");
    expect(report.violations[0]?.severity).toBe("error");
    expect(report.violations[0]?.message).toContain("U1.1");
    expect(report.violations[0]?.message).toContain("U2.1");
  });

  test("output + input on same net is fine", () => {
    const a = part("u1", "U1", [pin("u1-1", "1", "output")]);
    const b = part("u2", "U2", [pin("u2-1", "1", "input")]);
    const report = runErc(
      projection([a, b], [net("n-ok", "OK", ["u1-1", "u2-1"])]),
    );
    expect(report.violations).toEqual([]);
  });

  test("flags wired no_connect as warning", () => {
    const p = part("u1", "U1", [pin("u1-1", "NC", "no_connect")]);
    const report = runErc(projection([p], [net("n-floating", "F", ["u1-1"])]));
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.code).toBe("NO_CONNECT_VIOLATION");
    expect(report.violations[0]?.severity).toBe("warning");
  });

  test("anchor entries include net id and offending pins for output-short", () => {
    const a = part("u1", "U1", [pin("u1-1", "1", "output")]);
    const b = part("u2", "U2", [pin("u2-1", "1", "power_out")]);
    const report = runErc(
      projection([a, b], [net("n-clash", "CLASH", ["u1-1", "u2-1"])]),
    );
    const anchors = report.violations[0]?.anchors ?? [];
    expect(anchors).toContainEqual({ kind: "net", netId: "n-clash" });
    expect(anchors).toContainEqual({ kind: "pin", pinId: "u1-1" });
    expect(anchors).toContainEqual({ kind: "pin", pinId: "u2-1" });
  });
});
