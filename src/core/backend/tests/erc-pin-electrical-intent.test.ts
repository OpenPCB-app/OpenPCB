import { describe, expect, test } from "bun:test";
import { runErc } from "../../../modules/designer/backend/erc/erc-engine";
import { projectionFromWorld, projectionToWorld } from "../../../modules/designer/backend/projection-world";
import type { DesignerSchematicProjection } from "../../../sdks/designer";
import { ercNetProjection, ercPart, ercPin, ercProjection } from "./helpers/erc-fixtures";

const codes = (projection: DesignerSchematicProjection): string[] =>
  runErc(projection).violations.map((violation) => violation.code);

describe("pin-bound electrical intent ERC", () => {
  test("isolated NC suppresses only its unconnected-pin diagnostic", () => {
    const pin = { ...ercPin("p", "input"), electricalIntent: "no_connect" };
    const projection = ercProjection({ parts: [ercPart([pin, ercPin("other", "input", 5)])] });
    const report = runErc(projection);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]!.anchors).toEqual([{ kind: "pin", pinId: "other" }]);
    expect(pin.electricalType).toBe("input");
  });

  for (const attachment of ["pin", "wire", "label", "primitive"] as const) {
    test(`NC attached by ${attachment} errors without waiving drive checks`, () => {
      const projection = ercNetProjection(["power_in"]);
      projection.parts[0]!.pins[0]!.electricalIntent = "no_connect";
      const net = projection.nets[0]!;
      net.wireIds = [];
      if (attachment === "pin") {
        projection.parts[0]!.pins.push(ercPin("second", "input"));
        net.pinIds.push("second");
      } else net[`${attachment}Ids`].push(attachment);
      const report = runErc(projection);
      expect(report.violations).toContainEqual(expect.objectContaining({
        code: "NO_CONNECT_INTENT_VIOLATION", severity: "error",
        anchors: [{ kind: "pin", pinId: "0" }],
      }));
      expect(codes(projection)).toContain("UNDRIVEN_POWER_PIN");
    });
  }

  test("source intent supplies its live net without adding conflicting outputs", () => {
    const projection = ercNetProjection(["power_in", "input", "output"]);
    projection.parts[0]!.pins[0]!.electricalIntent = "power_source";
    expect(codes(projection)).toEqual([]);
    projection.parts[0]!.pins.push(ercPin("other-output", "power_out"));
    projection.nets[0]!.pinIds.push("other-output");
    expect(codes(projection)).toEqual(["OUTPUT_OUTPUT_SHORT"]);
  });

  test("source intent on passive connector supplies power and signal inputs", () => {
    const projection = ercNetProjection(["power_in", "input", "passive"]);
    projection.parts[0]!.pins[2]!.electricalIntent = "power_source";
    expect(codes(projection)).toEqual([]);
  });

  test("isolated declared supply satisfies only power input", () => {
    for (const type of ["input", "power_in"]) {
      const pin = { ...ercPin("p", type), electricalIntent: "power_source" };
      const projection = ercProjection({ parts: [ercPart([pin])] });
      expect(codes(projection)).toEqual(type === "power_in" ? [] : ["UNCONNECTED_INPUT_PIN"]);
    }
  });

  test("source remains pin-bound when net identity changes and supplies remain separate", () => {
    const source = { ...ercPin("source", "power_in"), electricalIntent: "power_source" };
    const other = ercPin("other", "power_in", 10_000_000);
    const original = ercProjection({ parts: [ercPart([source, other])] });
    const derive = () => projectionFromWorld("d", 1, projectionToWorld(original));
    const before = derive();
    original.labels = [{ id: "rail", text: "VCC", positionNm: { x: 0, y: 0 } }];
    original.wires = [{ id: "wire", sourcePinId: "source", targetPinId: "open", pointsNm: [{ x: 0, y: 0 }, { x: 2_000_000, y: 0 }] }];
    const after = derive();
    expect(before.nets).toHaveLength(2);
    expect(after.nets).toHaveLength(2);
    expect(after.nets.find((net) => net.pinIds.includes("source"))!.pinIds).toEqual(["source"]);
    expect(runErc(after).violations.map((violation) => violation.anchors)).toEqual([
      [{ kind: "pin", pinId: "other" }],
    ]);
  });

  test("future intent errors without suppressing isolated or drive checks", () => {
    for (const connected of [false, true]) {
      const projection = ercNetProjection(["power_in"]);
      projection.parts[0]!.pins[0]!.electricalIntent = "future_source";
      if (!connected) projection.nets = [];
      expect(codes(projection)).toEqual([
        connected ? "UNDRIVEN_POWER_PIN" : "UNCONNECTED_INPUT_PIN",
        "PIN_ELECTRICAL_INTENT_UNSUPPORTED",
      ]);
      expect(runErc(projection).summary.errors).toBe(2);
    }
  });

  test("source on library NC is invalid stored input and supplies no drive", () => {
    const projection = ercNetProjection(["power_in", "no_connect"]);
    projection.parts[0]!.pins[1]!.electricalIntent = "power_source";
    expect(codes(projection)).toContain("PIN_ELECTRICAL_INTENT_UNSUPPORTED");
    expect(codes(projection)).toContain("UNDRIVEN_POWER_PIN");
    expect(codes(projection)).toContain("NO_CONNECT_VIOLATION");
  });

  test("NC and source do not waive unsupported metadata", () => {
    const projection = ercNetProjection(["power_in", "unknown"]);
    projection.parts[0]!.pins[0]!.electricalIntent = "power_source";
    projection.parts[0]!.pins[1]!.electricalIntent = "no_connect";
    projection.parts[0]!.pins[1]!.unit = 2;
    expect(codes(projection)).toEqual([
      "MULTI_UNIT_SYMBOL_UNSUPPORTED", "PIN_ELECTRICAL_TYPE_UNKNOWN", "NO_CONNECT_INTENT_VIOLATION",
    ]);
  });
});
