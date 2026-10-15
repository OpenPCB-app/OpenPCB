import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type {
  DesignerPcbProjection,
  PcbFreePad,
  PcbVia,
} from "../../../../../sdks";
import type { ProjectionPour } from "../../../../../shared/rendering/copper-fill/projection-pours";
import { useProjectionPours } from "./use-projection-pours";
import { ViaLayer } from "./ViaLayer";

const pad = (id: string, x: number, netId: string): PcbFreePad =>
  ({
    id,
    padType: "smd",
    shape: "rect",
    centerMm: { x, y: 0 },
    widthMm: 2,
    heightMm: 2,
    rotationDeg: 0,
    drillMm: null,
    layer: "F.Cu",
    netId,
    lockedAt: null,
  }) as PcbFreePad;

const netClass = (id: string, clearanceMm: number) => ({
  id,
  name: id,
  traceWidthMm: 0.25,
  clearanceMm,
  viaDiameterMm: 0.8,
  viaDrillMm: 0.4,
  color: "#ccc",
  defaultViaProtection: "tented",
});

/**
 * The backend parity test's net-class fixture (pour-consumer-parity.test.ts,
 * oracle b): every board clearance and the pour tier at 0.2 mm, the WIDE class
 * at 0.4 mm, a GND board zone on F.Cu over a WIDE pad (x = 10) and a
 * default-class pad (x = −10).
 */
function netClassProjection(): DesignerPcbProjection {
  return {
    designId: "design-1",
    revision: 1,
    board: {
      outline: {
        kind: "rect",
        widthMm: 40,
        heightMm: 30,
        centerMm: { x: 0, y: 0 },
      },
      layerCount: 2,
      activeLayer: "F.Cu",
      visibleLayers: ["F.Cu", "B.Cu", "Edge.Cuts"],
      designRules: {
        clearance: {
          traceToTraceMm: 0.2,
          traceToPadMm: 0.2,
          padToPadMm: 0.2,
          traceToViaMm: 0.2,
          viaToViaMm: 0.2,
          copperToBoardEdgeMm: 0.5,
          pourToCopperMm: 0.2,
        },
        minimums: {
          traceWidthMm: 0.05,
          drillSizeMm: 0.3,
          annularRingMm: 0.15,
          viaDiameterMm: 0.6,
          viaDrillMm: 0.3,
        },
      },
      netClasses: [netClass("default", 0.2), netClass("wide", 0.4)],
      perNetClassAssignments: { wide: "wide" },
      tracePresets: [0.25],
      updatedAt: "2026-10-15T00:00:00.000Z",
    },
    placements: [],
    traces: [],
    vias: [],
    freeHoles: [],
    freePads: [pad("p_wide", 10, "wide"), pad("p_sig", -10, "sig")],
    overlayTexts: [],
    overlayShapes: [],
    zones: [
      {
        id: "board:F.Cu",
        name: null,
        enabled: true,
        lockedAt: null,
        layer: "F.Cu",
        netId: "gnd",
        netName: null,
        region: { kind: "board" },
        priority: 0,
        padConnection: "solid",
      },
    ],
    keepouts: [],
    ratsnest: [],
    netNames: { gnd: "GND", sig: "SIG", wide: "WIDE" },
    warnings: [],
  } as unknown as DesignerPcbProjection;
}

/** The hook's result, read through a server render (no DOM in this config). */
function poursOf(
  projection: DesignerPcbProjection,
): ReadonlyMap<string, ProjectionPour> {
  let captured: ReadonlyMap<string, ProjectionPour> | null = null;
  function Probe(): null {
    captured = useProjectionPours(projection);
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return captured!;
}

/** Even-odd membership over every ring of every island (holes included). */
function poured(pour: ProjectionPour, x: number, y: number): boolean {
  if (pour.result.status !== "ok") return false;
  for (const island of pour.result.islands) {
    let inside = false;
    for (const ring of island.rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!;
        const b = ring[j]!;
        if (
          a.y > y !== b.y > y &&
          x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
        ) {
          inside = !inside;
        }
      }
    }
    if (inside) return true;
  }
  return false;
}

describe("useProjectionPours", () => {
  test("draws the same net-class gap the Gerber oracle measures", () => {
    const pours = poursOf(netClassProjection());
    expect([...pours.keys()]).toEqual(["board:F.Cu"]);
    const plane = pours.get("board:F.Cu")!;
    // 0.3 mm off the WIDE pad: inside its 0.4 mm class halo — a gap.
    expect(poured(plane, 11.3, 0)).toBe(false);
    expect(poured(plane, 10, 1.3)).toBe(false);
    expect(poured(plane, 11.45, 0)).toBe(true);
    // The default-class pad at the same offset is poured up to (0.2 mm tier).
    expect(poured(plane, -11.3, 0)).toBe(true);
  });
});

describe("ViaLayer", () => {
  test("renders a via as its copper only — no separator ring", () => {
    const via = {
      id: "v1",
      netId: "gnd",
      netClassId: "default",
      centerMm: { x: 0, y: 0 },
      diameterMm: 0.8,
      drillMm: 0.4,
      fromLayer: "F.Cu",
      toLayer: "B.Cu",
      viaType: "through",
      protection: "tented",
      provenance: "route",
    } as unknown as PcbVia;
    const markup = renderToStaticMarkup(<ViaLayer vias={[via]} />);
    expect(markup.match(/<mesh[\s>]/g)?.length ?? 0).toBe(1);
  });
});
