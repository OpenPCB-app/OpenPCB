/**
 * The route tool's live legality — a thin adapter over the SHARED pending-copper
 * core, not a second DRC (live-parity contract 07 §1, §8).
 *
 * Nothing in this file computes geometry. `checkPendingCopper` builds the
 * pending items with the same builder the board's items came from, runs the same
 * per-pair and per-item bodies batch runs and finishes through the same
 * `finalizeReport`, so the measurement the HUD shows is the measurement the DRC
 * report shows, to the bit. All this module adds is:
 *
 *  - `runLiveDrc` / `blockingViolations` — the two names the canvas calls;
 *  - `pendingCopperFromSession` — the ONE mapping from a route session (its
 *    finished runs, its vias and the ghost run under the cursor) to the
 *    `PcbTrace` / `PcbVia` rows the gate and the commit would see.
 */
import { effectiveNetClassId } from "../../../../../shared/pcb-areas/net-class-resolver";
import type {
  DrcViolation,
  PcbBoardSettings,
  PcbTrace,
  PcbVia,
} from "../../../../../sdks";
import type { LegalityContext } from "../../../../../shared/drc/drc-context";
import {
  checkPendingCopper,
  refusedViolations,
  type PendingCopper,
} from "../../../../../shared/drc/legality";
import type { PointNm, RouteSession } from "../tools/route-tool-state";

export type { PendingCopper };

const NM_PER_MM = 1_000_000;

export interface LiveDrcInput {
  /** The ONE context of this projection (`usePcbWorkspace.legalityContext`). */
  ctx: LegalityContext;
  /** The copper about to be committed; ids are the caller's `pending:*`. */
  pending: PendingCopper;
  /** Board item ids the pending copper replaces (a tune / geometry edit). */
  replaces?: readonly string[];
}

/**
 * The verdict on `pending` against the board `ctx` describes — every code in
 * the live set `L` (07 §3), warnings included. Callers that GATE filter it
 * through `blockingViolations`; callers that only COUNT (the HUD) use the
 * blocking subset for "conflicts" and the remainder for "warnings".
 */
export function runLiveDrc(input: LiveDrcInput): DrcViolation[] {
  return checkPendingCopper(
    input.ctx,
    input.pending,
    input.replaces ? { replaces: input.replaces } : {},
  );
}

/**
 * The subset a `legality: "refuse"` commit would be rejected for (07 §6):
 * membership is by CODE, waived violations never block, and the off-board tier
 * is demoted when the board's own outline is invalid.
 */
export function blockingViolations(
  ctx: LegalityContext,
  violations: readonly DrcViolation[],
): DrcViolation[] {
  return refusedViolations(ctx, violations);
}

/**
 * A route session as pending copper: every finished run in `boundaries[].run`
 * plus (when given) the ghost run under the cursor, and every `boundaries[].via`.
 *
 * Ids are namespaced `pending:` — they never reach the backend, and the client
 * never expects one to match a batch id or a waiver (07 §1). Every other field
 * carries the value the backend's own builder would assign, so the gate judges
 * the copper the commit will actually insert; the one declared divergence is a
 * width `buildPcbTraceForInsert` upgrades when it also upgrades the net class
 * (07 §6, §9).
 */
export function pendingCopperFromSession(
  session: RouteSession,
  ghostRunPointsNm: readonly PointNm[] | null,
  board: PcbBoardSettings,
): { traces: PcbTrace[]; vias: PcbVia[] } {
  // The class the SERVER will store: a per-net assignment upgrades the default
  // class the session offered (07 §6, R2 #3) — the same helper the builders use.
  const netClassId = effectiveNetClassId(board, session.netId, session.netClassId);
  const netClass = board.netClasses.find((nc) => nc.id === netClassId);
  const traces: PcbTrace[] = [];
  const vias: PcbVia[] = [];
  session.boundaries.forEach((b, i) => {
    if (b.run) {
      traces.push({
        id: `pending:trace:${i}`,
        netId: session.netId,
        netClassId,
        layer: b.run.layer,
        widthMm: b.run.widthMm,
        pointsNm: b.run.pointsNm,
        segmentMode: b.run.segmentMode,
      });
    }
    if (b.via) {
      vias.push({
        id: `pending:via:${i}`,
        netId: session.netId,
        netClassId,
        centerMm: {
          x: b.via.centerNm.x / NM_PER_MM,
          y: b.via.centerNm.y / NM_PER_MM,
        },
        diameterMm: b.via.diameterMmOverride ?? netClass?.viaDiameterMm ?? 0.8,
        drillMm: b.via.drillMmOverride ?? netClass?.viaDrillMm ?? 0.4,
        // The span the session commits: a THROUGH via, F.Cu→B.Cu.
        fromLayer: "F.Cu",
        toLayer: "B.Cu",
        viaType: "through",
        protection: netClass?.defaultViaProtection ?? "tented",
        provenance: "route",
      });
    }
  });
  // The ghost takes the index one past the last boundary, so it can never
  // collide with a finished run's id inside one session.
  if (ghostRunPointsNm && ghostRunPointsNm.length >= 2) {
    traces.push({
      id: `pending:trace:${session.boundaries.length}`,
      netId: session.netId,
      netClassId,
      layer: session.layer,
      widthMm: session.widthMm,
      pointsNm: ghostRunPointsNm.map((p) => ({ x: p.x, y: p.y })),
      segmentMode: session.segmentMode,
    });
  }
  return { traces, vias };
}
