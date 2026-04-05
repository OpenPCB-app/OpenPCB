/**
 * FootprintPreviewR3F — Read-only R3F footprint preview.
 *
 * Drop-in replacement for FootprintPreview. Accepts the same `footprint` prop
 * and parses KiCad payload internally, same as the original.
 */

import { useMemo } from "react";
import type { ComponentFootprintType } from "@shared/types/component-library-schema.types";
import { useCanvasColors } from "@/lib/canvas-theme";
import { EdaCanvas } from "../interaction/EdaCanvas";
import { GridShader } from "../primitives/GridShader";
import { PadInstances } from "../primitives/PadInstances";
import { Units, GRID_PRESETS, nmToScene } from "../coords";

// ---------------------------------------------------------------------------
// Props (same as original FootprintPreview)
// ---------------------------------------------------------------------------

interface FootprintPreviewR3FProps {
  footprint?: ComponentFootprintType;
}

// ---------------------------------------------------------------------------
// Pad parser (simplified from original FootprintPreview regex parsing)
// ---------------------------------------------------------------------------

interface ParsedPad {
  number: string;
  shape: "circle" | "rect" | "oval" | "roundrect";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

function parsePadsFromKicadPayload(payload: unknown): ParsedPad[] {
  if (!payload || typeof payload !== "string") return [];
  const pads: ParsedPad[] = [];

  const padRegex =
    /\(pad\s+"([^"]*)"\s+(\w+)\s+(\w+)\s+\(at\s+([\d.-]+)\s+([\d.-]+)(?:\s+([\d.-]+))?\)\s+\(size\s+([\d.-]+)\s+([\d.-]+)\)/g;
  let match;
  while ((match = padRegex.exec(payload)) !== null) {
    const [, number, , shape, x, y, rotation, width, height] = match;
    const padShape =
      shape === "circle" || shape === "oval"
        ? (shape as "circle" | "oval")
        : shape === "roundrect"
          ? ("roundrect" as const)
          : ("rect" as const);

    pads.push({
      number: number ?? "",
      shape: padShape,
      x: parseFloat(x ?? "0"),
      y: parseFloat(y ?? "0"),
      width: parseFloat(width ?? "0"),
      height: parseFloat(height ?? "0"),
      rotation: parseFloat(rotation ?? "0"),
    });
  }

  return pads;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FootprintPreviewR3F({ footprint }: FootprintPreviewR3FProps) {
  const colors = useCanvasColors();

  const padData = useMemo(() => {
    if (!footprint?.kicadPayload) return [];

    const parsed = parsePadsFromKicadPayload(footprint.kicadPayload);
    return parsed.map((pad) => ({
      id: pad.number,
      x: Units.mmToNm(pad.x),
      y: Units.mmToNm(pad.y),
      width: Units.mmToNm(pad.width),
      height: Units.mmToNm(pad.height),
      rotation: pad.rotation,
      shape: pad.shape,
      selected: false as const,
    }));
  }, [footprint]);

  if (!footprint) {
    return (
      <div
        className="flex h-[300px] items-center justify-center text-text-tertiary"
        data-testid="footprint-preview"
      >
        No footprint data
      </div>
    );
  }

  return (
    <EdaCanvas
      testId="footprint-preview"
      readOnly
      backgroundColor={colors.background}
      style={{ height: "300px" }}
    >
      <GridShader
        gridSize={nmToScene(GRID_PRESETS.FINE)}
        visible
        color={hexToRgb(colors.gridDot)}
        alpha={0.15}
      />
      <PadInstances pads={padData} defaultColor={colors.padFill} />
    </EdaCanvas>
  );
}

function hexToRgb(color: string): [number, number, number] {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }
  return [0.58, 0.64, 0.72];
}
