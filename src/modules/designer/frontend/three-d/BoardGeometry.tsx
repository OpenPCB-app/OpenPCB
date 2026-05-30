import { type ReactElement } from "react";
import type { DesignerPcbProjection } from "../../../../sdks";
import { ComponentModelLayer } from "./ComponentModelLayer";
import { BoardSubstrate } from "./primitives/BoardSubstrate";
import { CopperBarrels } from "./primitives/CopperBarrels";
import { CopperPads } from "./primitives/CopperPads";
import { CopperPour } from "./primitives/CopperPour";
import { CopperTraces } from "./primitives/CopperTraces";
import { CopperVias } from "./primitives/CopperVias";
import { FootprintOverlayLayer } from "./FootprintOverlayLayer";
import { DEFAULT_BOARD_THICKNESS_MM } from "./primitives/geometry-utils";
import { COPPER_FILL_GREEN } from "./primitives/materials";

export function BoardGeometry({
  backendURL,
  projection,
  boardThicknessMm = DEFAULT_BOARD_THICKNESS_MM,
  showComponents = true,
  showSilkscreen = true,
  maskColor,
  fillColor = COPPER_FILL_GREEN,
}: {
  backendURL?: string | null;
  projection: DesignerPcbProjection;
  boardThicknessMm?: number;
  showComponents?: boolean;
  showSilkscreen?: boolean;
  maskColor?: string;
  /** Soldermask-over-copper shade for traces/pour/vias; tracks the board colour. */
  fillColor?: string;
  /** Accepted for API compatibility; the matte two-tone board ignores it. */
  maskOpacity?: number;
}): ReactElement {
  return (
    <group data-testid="designer-3d-board-geometry">
      <BoardSubstrate
        projection={projection}
        thicknessMm={boardThicknessMm}
        faceColor={maskColor}
      />
      <CopperPour
        projection={projection}
        boardThicknessMm={boardThicknessMm}
        fillColor={fillColor}
      />
      <CopperTraces
        traces={projection.traces}
        boardThicknessMm={boardThicknessMm}
        fillColor={fillColor}
      />
      <CopperVias
        vias={projection.vias}
        boardThicknessMm={boardThicknessMm}
        fillColor={fillColor}
      />
      <CopperBarrels
        projection={projection}
        boardThicknessMm={boardThicknessMm}
      />
      <CopperPads
        placements={projection.placements}
        boardThicknessMm={boardThicknessMm}
      />
      {showSilkscreen ? (
        <FootprintOverlayLayer
          placements={projection.placements}
          boardThicknessMm={boardThicknessMm}
        />
      ) : null}
      {showComponents ? (
        <ComponentModelLayer
          backendURL={backendURL}
          placements={projection.placements}
          boardThicknessMm={boardThicknessMm}
        />
      ) : null}
    </group>
  );
}
