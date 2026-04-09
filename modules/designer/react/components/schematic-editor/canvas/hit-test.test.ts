import { describe, expect, it } from "vitest";
import type { SymbolEntity, Viewport } from "../types";
import { hitTestScreen, createHitTestCache } from "./hit-test";
import { schematicToScreen } from "./viewport";

const viewport: Viewport = {
  offsetX: 40,
  offsetY: -20,
  zoom: 0.001,
};

const symbols: SymbolEntity[] = [
  {
    id: "symbol-1",
    entityType: "symbol",
    symbolKind: "resistor",
    reference: "R1",
    value: "10k",
    position: { x: 0, y: 0 },
    rotation: 0,
    mirrored: false,
    pins: [
      { id: "pin-1", name: "1", position: { x: 0, y: 0 } },
      { id: "pin-2", name: "2", position: { x: 1_270_000, y: 0 } },
    ],
    properties: {},
  },
];

describe("hitTestScreen", () => {
  it("prefers connector hits over body hits", () => {
    const cache = createHitTestCache(symbols);
    const connector = schematicToScreen(0, 0, viewport);

    expect(
      hitTestScreen(connector.x + 3, connector.y + 2, symbols, viewport, cache),
    ).toEqual({
      kind: "connector",
      symbolId: "symbol-1",
      pinId: "pin-1",
    });
  });

  it("returns body hits away from connector radius", () => {
    const cache = createHitTestCache(symbols);
    const bodyPoint = schematicToScreen(635_000, 0, viewport);

    expect(
      hitTestScreen(bodyPoint.x, bodyPoint.y, symbols, viewport, cache),
    ).toEqual({
      kind: "body",
      symbolId: "symbol-1",
    });
  });

  it("returns null for empty canvas", () => {
    const cache = createHitTestCache(symbols);

    expect(hitTestScreen(500, 500, symbols, viewport, cache)).toBeNull();
  });

  it("respects rotation and mirroring when resolving connector anchors", () => {
    const baseSymbol = symbols[0];
    if (!baseSymbol) {
      throw new Error("missing symbol fixture");
    }

    const rotatedSymbol: SymbolEntity = {
      ...baseSymbol,
      id: "symbol-2",
      position: { x: 2_540_000, y: 0 },
      rotation: 90,
      mirrored: true,
    };
    const cache = createHitTestCache([rotatedSymbol]);
    const rotatedConnector = schematicToScreen(2_540_000, 0, viewport);

    expect(
      hitTestScreen(
        rotatedConnector.x,
        rotatedConnector.y,
        [rotatedSymbol],
        viewport,
        cache,
      ),
    ).toEqual({
      kind: "connector",
      symbolId: "symbol-2",
      pinId: "pin-1",
    });
  });

  it("prefers the closest connector when multiple anchors overlap the hit radius", () => {
    const baseSymbol = symbols[0];
    if (!baseSymbol) {
      throw new Error("missing symbol fixture");
    }

    const crowdedSymbols: SymbolEntity[] = [
      {
        ...baseSymbol,
        id: "symbol-2",
        position: { x: 0, y: 127_000 },
        pins: [{ id: "pin-3", name: "1", position: { x: 0, y: 0 } }],
      },
      baseSymbol,
    ];
    const cache = createHitTestCache(crowdedSymbols);
    const nearestConnector = schematicToScreen(0, 0, viewport);

    expect(
      hitTestScreen(
        nearestConnector.x + 4,
        nearestConnector.y + 4,
        crowdedSymbols,
        viewport,
        cache,
      ),
    ).toEqual({
      kind: "connector",
      symbolId: "symbol-1",
      pinId: "pin-1",
    });
  });

  it("prefers the last drawn symbol body when bounds overlap", () => {
    const baseSymbol = symbols[0];
    if (!baseSymbol) {
      throw new Error("missing symbol fixture");
    }

    const overlappingSymbols: SymbolEntity[] = [
      baseSymbol,
      {
        ...baseSymbol,
        id: "symbol-2",
        reference: "R2",
      },
    ];
    const cache = createHitTestCache(overlappingSymbols);
    const bodyPoint = schematicToScreen(635_000, 0, viewport);

    expect(
      hitTestScreen(
        bodyPoint.x,
        bodyPoint.y + 11,
        overlappingSymbols,
        viewport,
        cache,
      ),
    ).toEqual({
      kind: "body",
      symbolId: "symbol-2",
    });
  });
});
