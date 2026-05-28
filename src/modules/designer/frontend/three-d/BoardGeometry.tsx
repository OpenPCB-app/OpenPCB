import { type ReactElement } from "react";
import type { DesignerPcbProjection } from "../../../../sdks";
import { ComponentModelLayer } from "./ComponentModelLayer";
import { BoardSubstrate } from "./primitives/BoardSubstrate";
import { CopperBarrels } from "./primitives/CopperBarrels";
import { CopperPads } from "./primitives/CopperPads";
import { CopperTraces } from "./primitives/CopperTraces";
import { CopperVias } from "./primitives/CopperVias";
import { FootprintOverlayLayer } from "./FootprintOverlayLayer";
import { DEFAULT_BOARD_THICKNESS_MM } from "./primitives/geometry-utils";

export function BoardGeometry({
  backendURL,
  projection,
  boardThicknessMm = DEFAULT_BOARD_THICKNESS_MM,
}: {
  backendURL?: string | null;
  projection: DesignerPcbProjection;
  boardThicknessMm?: number;
}): ReactElement {
  return (
    <group data-testid="designer-3d-board-geometry">
      <BoardSubstrate projection={projection} thicknessMm={boardThicknessMm} />
      <CopperTraces
        traces={projection.traces}
        boardThicknessMm={boardThicknessMm}
      />
      <CopperVias vias={projection.vias} boardThicknessMm={boardThicknessMm} />
      <CopperBarrels
        projection={projection}
        boardThicknessMm={boardThicknessMm}
      />
      <CopperPads
        placements={projection.placements}
        boardThicknessMm={boardThicknessMm}
      />
      <FootprintOverlayLayer
        placements={projection.placements}
        boardThicknessMm={boardThicknessMm}
      />
      <ComponentModelLayer
        backendURL={backendURL}
        placements={projection.placements}
        boardThicknessMm={boardThicknessMm}
      />
    </group>
  );
}
