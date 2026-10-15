import { useMemo } from "react";
import type { DesignerPcbProjection } from "../../../../../sdks";
import { zonePourNets } from "../../../../../shared/pcb-areas/pour-params";
import {
  buildProjectionPours,
  type ProjectionPour,
} from "../../../../../shared/rendering/copper-fill/projection-pours";

const NO_PAD_NETS: Readonly<Record<string, string>> = {};

/**
 * The canvas's copper pours: the SAME `buildProjectionPours` result Gerber, DRC
 * and the snapshot read (OPENPCB-67 §3.8) — every trace and via of the board,
 * the full board settings, the projection's keepouts — keyed by effective zone
 * id in fill (derivation) order. Pours are built from COMMITTED geometry only;
 * drag overrides never reach the fill, so a drag does not re-run Clipper.
 */
export function useProjectionPours(
  projection: DesignerPcbProjection,
): ReadonlyMap<string, ProjectionPour> {
  const { board, netNames } = projection;
  const nets = useMemo(() => zonePourNets(board, netNames), [board, netNames]);
  return useMemo(
    () =>
      new Map(
        buildProjectionPours(
          {
            board,
            placements: projection.placements,
            traces: projection.traces,
            vias: projection.vias,
            freeHoles: projection.freeHoles,
            freePads: projection.freePads,
            padNets: projection.padNets ?? NO_PAD_NETS,
            zones: projection.zones,
            keepouts: projection.keepouts,
            netNames,
          },
          { nets },
        ).map((pour) => [pour.zone.id, pour] as const),
      ),
    [
      projection.zones,
      projection.keepouts,
      nets,
      projection.padNets,
      board,
      netNames,
      projection.placements,
      projection.traces,
      projection.vias,
      projection.freeHoles,
      projection.freePads,
    ],
  );
}
