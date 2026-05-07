import type { PcbBoardSettings } from "../../../../sdks/designer";

export const DEFAULT_PCB_WIDTH_MM = 100;
export const DEFAULT_PCB_HEIGHT_MM = 80;

export function createDefaultPcbBoardSettings(
  timestamp: string,
): PcbBoardSettings {
  return {
    outline: {
      kind: "rect",
      widthMm: DEFAULT_PCB_WIDTH_MM,
      heightMm: DEFAULT_PCB_HEIGHT_MM,
      centerMm: { x: 0, y: 0 },
    },
    activeLayer: "F.Cu",
    visibleLayers: ["F.Cu", "B.Cu", "F.SilkS", "B.SilkS", "Edge.Cuts"],
    designRules: {
      clearance: {
        traceToTraceMm: 0.2,
        traceToPadMm: 0.2,
        padToPadMm: 0.2,
        traceToViaMm: 0.2,
        viaToViaMm: 0.3,
        copperToBoardEdgeMm: 0.5,
      },
      minimums: {
        traceWidthMm: 0.2,
        drillSizeMm: 0.4,
        annularRingMm: 0.2,
        viaDiameterMm: 0.8,
        viaDrillMm: 0.4,
      },
    },
    netClasses: [
      {
        id: "default",
        name: "Default",
        traceWidthMm: 0.25,
        clearanceMm: 0.2,
        viaDiameterMm: 0.8,
        viaDrillMm: 0.4,
        color: "#e5e7eb",
      },
      {
        id: "power",
        name: "Power",
        traceWidthMm: 0.5,
        clearanceMm: 0.2,
        viaDiameterMm: 0.8,
        viaDrillMm: 0.4,
        color: "#ef4444",
      },
      {
        id: "gnd",
        name: "GND",
        traceWidthMm: 0.4,
        clearanceMm: 0.2,
        viaDiameterMm: 0.8,
        viaDrillMm: 0.4,
        color: "#475569",
      },
    ],
    updatedAt: timestamp,
  };
}
