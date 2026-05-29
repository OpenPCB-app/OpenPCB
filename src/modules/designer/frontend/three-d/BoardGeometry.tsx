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

export function BoardGeometry({
  backendURL,
  projection,
  boardThicknessMm = DEFAULT_BOARD_THICKNESS_MM,
  showComponents = true,
  showSilkscreen = true,
  maskColor,
}: {
  backendURL?: string | null;
  projection: DesignerPcbProjection;
  boardThicknessMm?: number;
  showComponents?: boolean;
  showSilkscreen?: boolean;
  maskColor?: string;
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
      <CopperPour projection={projection} boardThicknessMm={boardThicknessMm} />
      <CopperTraces
        traces={projection.traces}
        boardThicknessMm={boardThicknessMm}
      />
      <CopperVias
        vias={projection.vias}
        boardThicknessMm={boardThicknessMm}
        maskColor={maskColor}
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
