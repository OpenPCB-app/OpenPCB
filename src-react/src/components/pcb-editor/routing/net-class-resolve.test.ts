import { describe, expect, it } from "vitest";
import { findWidthIndex, resolveNetClassWidths } from "./net-class-resolve";
import type { PcbDocument } from "../pcb-types";

function createDocument(): PcbDocument {
  return {
    boardOutline: { width: 100, height: 80 },
    manufacturerPreset: "jlcpcb_standard",
    netClasses: [
      {
        name: "power",
        traceWidth: 0.6,
        clearance: 0.2,
        viaDiameter: 1,
        viaDrill: 0.5,
      },
    ],
    nets: [
      {
        id: "net-power",
        name: "VCC",
        netClass: "power",
        padRefs: [],
      },
    ],
    placements: [],
    traces: [],
    vias: [],
    zones: [],
  };
}

describe("resolveNetClassWidths", () => {
  it("falls back to defaults when the net is missing", () => {
    expect(resolveNetClassWidths("missing", createDocument())).toEqual({
      defaultWidth: 0.25,
      presets: [0.15, 0.2, 0.25, 0.3, 0.5, 0.8, 1],
      viaDiameter: 0.6,
      viaDrill: 0.3,
    });
  });

  it("merges the net class width into sorted presets", () => {
    expect(resolveNetClassWidths("net-power", createDocument())).toEqual({
      defaultWidth: 0.6,
      presets: [0.15, 0.2, 0.25, 0.3, 0.5, 0.6, 0.8, 1],
      viaDiameter: 1,
      viaDrill: 0.5,
    });
  });
});

describe("findWidthIndex", () => {
  it("returns the exact matching preset index", () => {
    expect(findWidthIndex(0.5, [0.15, 0.25, 0.5, 0.8])).toBe(2);
  });

  it("returns the closest preset index when no exact match exists", () => {
    expect(findWidthIndex(0.62, [0.15, 0.25, 0.5, 0.8])).toBe(2);
  });
});
