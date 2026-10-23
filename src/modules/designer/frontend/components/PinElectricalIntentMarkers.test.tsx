// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { DesignerPlacedPart } from "../../../../sdks";
import { PinElectricalIntentMarkers } from "./PinElectricalIntentMarkers";

const invalidate = vi.hoisted(() => vi.fn());
vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: { invalidate: () => void }) => unknown) => selector({ invalidate }),
}));

function part(): DesignerPlacedPart {
  return {
    id: "part", componentId: "component", reference: "J1", value: "Connector",
    rotationDeg: 90, mirrored: true, positionNm: { x: 8_000_000, y: 4_000_000 },
    symbol: {
      symbolId: "symbol", name: "Connector", referencePrefix: "J", sourceHash: null, pins: [],
      preview: { kind: "symbol", units: "mm", name: "Connector", unitCount: 1, pins: [], graphics: [], labels: [], bounds: null, warnings: [] },
    },
    footprint: { footprintId: "footprint", name: "Connector", mountType: null, sourceHash: null, preview: null },
    propertiesJson: {},
    pins: ["no_connect", "power_source", "future_intent", undefined].map((intent, index) => ({
      id: `part:${index}`, originPinKey: `${index}`, number: `${index}`, name: "Pin",
      electricalType: "passive", electricalIntent: intent, unit: 1,
      localPositionNm: { x: 1_000_000, y: 0 },
      worldPositionNm: { x: 8_000_000 + index * 2_000_000, y: 3_000_000 },
    })),
  };
}

test("renders only known intents at derived pin positions, follows drag, invalidates demand canvas", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // React DOM records the declarative R3F tree without requiring a WebGL context.
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const host = document.createElement("div");
  const root = createRoot(host);
  const placed = part();
  const before = structuredClone(placed);
  const position = (value: DesignerPlacedPart) => value.positionNm;
  const render = async (renderedPartPositionNm = position) => {
    await act(async () => root.render(<PinElectricalIntentMarkers
      parts={[placed]} renderedPartPositionNm={renderedPartPositionNm}
      noConnectColor="red" powerSourceColor="blue"
    />));
  };
  try {
    await render();
    const meshes = host.querySelectorAll("mesh");
    expect(meshes).toHaveLength(2);
    expect(meshes[0]?.getAttribute("position")).toBe("8,3,0");
    expect(meshes[1]?.getAttribute("position")).toBe("10,3,0");
    expect(meshes[0]?.querySelector("meshBasicMaterial")?.getAttribute("color")).toBe("red");
    expect(meshes[1]?.querySelector("meshBasicMaterial")?.getAttribute("color")).toBe("blue");
    expect(meshes[0]?.querySelector("bufferAttribute")?.getAttribute("args"))
      .not.toBe(meshes[1]?.querySelector("bufferAttribute")?.getAttribute("args"));
    expect(invalidate).toHaveBeenCalled();
    const framesBeforeMove = invalidate.mock.calls.length;
    await render(() => ({ x: 10_000_000, y: 1_000_000 }));
    expect(host.querySelector("mesh")?.getAttribute("position")).toBe("10,0,0");
    expect(invalidate.mock.calls.length).toBeGreaterThan(framesBeforeMove);
    expect(placed).toEqual(before);
  } finally {
    await act(async () => root.unmount());
    errors.mockRestore();
  }
});
