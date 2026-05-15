import type { PcbBoardSettings } from "../../../../sdks/designer";

export const DEFAULT_PCB_WIDTH_MM = 50;
export const DEFAULT_PCB_HEIGHT_MM = 30;

/**
 * Industry-standard trace width presets (mm). 0.15 = JLCPCB/PCBWay safe min;
 * 0.25 = KiCad/Altium default; 0.5 = small power; 1.0 = main power rail.
 */
export const DEFAULT_TRACE_PRESETS_MM: ReadonlyArray<number> = [
  0.15, 0.2, 0.25, 0.5, 1.0,
];

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
    visibleLayers: [
      "F.Cu",
      "B.Cu",
      "F.SilkS",
      "Edge.Cuts",
      "Drill",
      "Metadata",
    ],
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
        color: "#d4d4d8",
        defaultViaProtection: "tented",
      },
      {
        id: "power",
        name: "Power",
        traceWidthMm: 0.5,
        clearanceMm: 0.2,
        viaDiameterMm: 0.8,
        viaDrillMm: 0.4,
        color: "#f87171",
        defaultViaProtection: "tented",
      },
      {
        id: "gnd",
        name: "GND",
        traceWidthMm: 0.4,
        clearanceMm: 0.2,
        viaDiameterMm: 0.8,
        viaDrillMm: 0.4,
        color: "#64748b",
        defaultViaProtection: "tented",
      },
    ],
    tracePresets: [...DEFAULT_TRACE_PRESETS_MM],
    fabricator: "jlcpcb_2l",
    layerCount: 2,
    displayMode: "normal",
    solderMaskExpansionMm: 0.075,
    solderPasteExpansionMm: -0.05,
    updatedAt: timestamp,
  };
}
