// Pure planner for `pcb_apply_autolayout_candidate`.
//
// THE POINT OF THIS FILE IS THAT IT WRITES NOTHING. The executor's placement helpers
// (`movePcbPlacement`, `rotatePcbPlacement`, `flipPcbPlacement`) upsert the row on call,
// and executor branches signal failure by RETURNING an error result rather than throwing —
// so validating by calling them would leave earlier placements committed when a later trace
// turns out to be illegal, which is exactly the partial-apply behaviour the atomic command
// exists to remove. Everything is therefore planned against an in-memory transform map and
// handed back to the caller to persist in one pass, only if the whole plan is good.
//
// Placement ops COMPOSE in order: the placer can emit move + rotate + flip for the same
// component, and the committed result must equal what a user would get by performing those
// three actions in sequence.

import type {
  DesignerPcbCandidatePlacementOperation,
  PcbPlacedPart,
} from "../../../../sdks/designer";
import { snapCoordinateMm } from "../../../../shared/domain/editor-grid";

export type PlacementOpKind =
  | "pcb_move_placement"
  | "pcb_rotate_placement"
  | "pcb_flip_placement";

/** One candidate placement op, carrying the discriminator the command payload strips. */
export interface CandidatePlacementOp {
  kind: PlacementOpKind;
  op: DesignerPcbCandidatePlacementOperation;
}

export interface PlacementPlanError {
  /** Index into the op list — lets the caller say WHICH op failed, not just "invalid". */
  index: number;
  placementId: string;
  reason: "unknown_placement" | "invalid_rotation" | "invalid_position";
  detail: string;
}

export type PlacementPlanResult =
  | { ok: true; placements: PcbPlacedPart[] }
  | { ok: false; error: PlacementPlanError };

const CARDINAL_ROTATIONS = new Set([0, 90, 180, 270]);

/** Same integer-nm rounding `movePcbPlacement` applies, so plan == direct-dispatch. */
function roundMm(value: number): number {
  return snapCoordinateMm(value, 0);
}

function hasPlacementId(op: unknown): op is { placementId: string } {
  return typeof (op as { placementId?: unknown })?.placementId === "string";
}

/**
 * Compose every placement operation onto the current placements.
 *
 * `load` is the caller's row reader (`loadPcbPlacementById` bound to the tx). It is called
 * at most once per component: after that the working copy carries the running transform, so
 * a second op for the same component sees the first one's effect.
 *
 * Returns the FINAL state of each touched placement, in first-touched order. Nothing is
 * written.
 */
export function planCandidatePlacements(
  ops: readonly CandidatePlacementOp[],
  load: (placementId: string) => PcbPlacedPart | null,
): PlacementPlanResult {
  const working = new Map<string, PcbPlacedPart>();
  const order: string[] = [];

  for (const [index, entry] of ops.entries()) {
    const { kind, op } = entry;
    if (!hasPlacementId(op)) {
      return {
        ok: false,
        error: {
          index,
          placementId: "",
          reason: "unknown_placement",
          detail: `${kind} operation is missing placementId`,
        },
      };
    }
    const placementId = op.placementId;

    let current = working.get(placementId);
    if (!current) {
      const loaded = load(placementId);
      if (!loaded) {
        return {
          ok: false,
          error: {
            index,
            placementId,
            reason: "unknown_placement",
            detail: `placement ${placementId} does not exist on this board`,
          },
        };
      }
      current = loaded;
      order.push(placementId);
    }

    switch (kind) {
      case "pcb_move_placement": {
        const positionMm = (op as { positionMm?: { x: number; y: number } }).positionMm;
        if (
          !positionMm ||
          !Number.isFinite(positionMm.x) ||
          !Number.isFinite(positionMm.y)
        ) {
          return {
            ok: false,
            error: {
              index,
              placementId,
              reason: "invalid_position",
              detail: `move operation for ${placementId} has a non-finite position`,
            },
          };
        }
        working.set(placementId, {
          ...current,
          positionMm: { x: roundMm(positionMm.x), y: roundMm(positionMm.y) },
        });
        break;
      }
      case "pcb_rotate_placement": {
        const rotationDeg = (op as { rotationDeg?: number }).rotationDeg;
        // The contract pins 0/90/180/270; a KiCad-imported board can carry non-cardinal
        // angles, but the placer never EMITS one, so anything else is a contract breach
        // rather than something to silently round.
        if (typeof rotationDeg !== "number" || !CARDINAL_ROTATIONS.has(rotationDeg)) {
          return {
            ok: false,
            error: {
              index,
              placementId,
              reason: "invalid_rotation",
              detail: `rotate operation for ${placementId} has non-cardinal rotation ${String(rotationDeg)}`,
            },
          };
        }
        working.set(placementId, { ...current, rotationDeg });
        break;
      }
      case "pcb_flip_placement": {
        // Mirrors flipPcbPlacement exactly: side and mirror flag move together.
        working.set(placementId, {
          ...current,
          layer: current.layer === "B.Cu" ? "F.Cu" : "B.Cu",
          mirrored: !current.mirrored,
        });
        break;
      }
    }
  }

  return { ok: true, placements: order.map((id) => working.get(id)!) };
}
