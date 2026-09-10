import { placementPads } from "../../pcb-geometry/pad-geometry";
import type { DrcContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";

/** Each placed part must carry a footprint with at least one pad. */
export function checkStructural(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  for (const p of ctx.projection.placements) {
    if (placementPads(p).length === 0) {
      out.push({
        code: "PLACED_PART_MISSING_FOOTPRINT",
        message: `Placed part ${p.reference} has no footprint pads — it cannot be routed or correlated to nets`,
        anchors: [{ kind: "placement", placementId: p.id }],
        locationMm: p.positionMm,
      });
    }
  }

  // A net bound to a NON-PLATED footprint pad is a design error the report
  // must not hide (manufacturability contract 10 §2.4). The pin stays a
  // ratsnest endpoint — the copper record keeps the net — but its per-pad item
  // key matches no kernel item, so its component is synthetic and the airwire
  // never clears: UNCONNECTED_NET reports the OPEN, this reports the CAUSE.
  // Overridable: waiving it does not remove the airwire, and no copper is
  // manufactured differently because of it.
  //
  // Two shapes of the same error (Astra run 2): (a) an unplated pad whose
  // copper spans two or more layers — the kernel splits it into null-net
  // per-layer items, so the net can never reach it; (b) an unplated pad with
  // NO copper at all (copper-less NPTH, or a `hole` free pad) — it owns no
  // record, so it is not even a ratsnest endpoint and the open would be
  // SILENT without this code. Unplated copper on exactly one layer (a drilled
  // `smd` / `conn` free pad) keeps its net and needs no report.
  const emit = (
    netId: string,
    anchor: DrcViolationDraft["anchors"][number],
    locationMm: { x: number; y: number },
    what: string,
  ): void => {
    const name = ctx.netNames[netId] ?? netId;
    out.push({
      code: "NPTH_PAD_NET",
      message: `Net "${name}" is assigned to a non-plated pad ${what} — use a plated pad`,
      anchors: [anchor],
      locationMm,
    });
  };
  const recordedPads = new Set<string>();
  const recordedFreePads = new Set<string>();
  for (const pad of ctx.pads) {
    if (pad.anchor.kind === "pad") {
      recordedPads.add(`${pad.anchor.placementId}|${pad.anchor.padNumber}`);
    } else if (pad.anchor.kind === "freePad") {
      recordedFreePads.add(pad.anchor.freePadId);
    }
    if (pad.plated || pad.netId === null || pad.layers.length < 2) continue;
    emit(
      pad.netId,
      pad.anchor,
      pad.center,
      "whose copper rings are mechanical and do not conduct between faces",
    );
  }
  // (b) copper-less: the hole exists (contract 10 §1.3), the copper does not.
  // Every copper-less occurrence is emitted; two occurrences of one pad number
  // share an id and the CANONICAL dedupe of 06 §6 picks the survivor, so the
  // report stays byte-identical under input reversal (an early `seen` set
  // would have let draft order choose the marker — Astra run 2b #6).
  const padNets = ctx.projection.padNets ?? {};
  for (const hole of ctx.holes) {
    if (hole.kind !== "npth" || hole.anchor.kind !== "pad") continue;
    const key = `${hole.anchor.placementId}|${hole.anchor.padNumber}`;
    if (recordedPads.has(key)) continue;
    const netId = padNets[key];
    if (!netId) continue;
    emit(netId, hole.anchor, hole.center, "that carries no copper at all");
  }
  for (const freePad of ctx.projection.freePads) {
    if (freePad.netId === null || recordedFreePads.has(freePad.id)) continue;
    if (freePad.padType !== "hole") continue;
    emit(
      freePad.netId,
      { kind: "freePad", freePadId: freePad.id },
      freePad.centerMm,
      "that carries no copper at all",
    );
  }
  return out;
}
