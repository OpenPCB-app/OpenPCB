// Canonical digest of the board's DESIGN CONTENT — the staleness key for a cloud
// Auto Layout / Route run.
//
// WHY NOT THE REVISION: `pcb_set_view_state` bumps the revision like any other command
// (it is only excluded from the undo stack), so panning, zooming or toggling a layer
// during a three-minute cloud job would invalidate every candidate it produced. Revision
// equality is therefore unusable as "did the board change?".
//
// WHY NOT HASH THE SNAPSHOT: the built `BoardSnapshot` carries REQUEST choices —
// `options`, `placeOptions`, `serializePours`, `routableNetClassIds`, `excludedNetIds` —
// so re-running with a different preset would read as a board edit. It also carries
// derived data (ratsnest) that moves with net-id churn without the design changing.
//
// So this digest is a deliberate PROJECTION: everything a cloud result depends on for
// validity, nothing else.
//
// FAIL-CLOSED RULE FOR FUTURE EDITORS: new PERSISTED board data must be added to
// `digestInput` below. An omission does not fail loudly — it silently lets a candidate be
// applied onto a board that has since changed underneath it. If you add a field to the
// PCB projection and are unsure, include it.
//
// The digest is desktop-local and need NOT match the service's `snapshotHash` (which
// hashes a different, request-shaped payload under different canonicalization rules).
// The service hash travels with an applied candidate as provenance only.

import { createHash } from "node:crypto";

import type { DesignerPcbProjection } from "../../../../sdks/designer";

/**
 * Coordinate quantization for the digest. Board data is stored in integer nm (traces,
 * vias) or mm floats (placements, outline); rounding mm to 1e-6 (i.e. 1 nm) keeps the
 * digest immune to float re-serialization noise while still catching every real edit —
 * the editor's finest grid is orders of magnitude coarser.
 */
const MM_QUANT = 1e6;

function q(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * MM_QUANT) / MM_QUANT;
}

function qPoint(p: { x: number; y: number } | null | undefined): [number | null, number | null] {
  return [q(p?.x), q(p?.y)];
}

function byKey<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => key(a).localeCompare(key(b)));
}

/**
 * Stable stringify: object keys sorted at every level, so insertion order (which follows
 * SQLite row order and map iteration) cannot change the digest.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const record = val as Record<string, unknown>;
      return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = record[k];
          return acc;
        }, {});
    }
    return val;
  });
}

/**
 * The digest projection. Everything here is persisted design content; nothing here is a
 * request option, a view-state value, or derived-on-read data.
 */
function digestInput(projection: DesignerPcbProjection): unknown {
  const { board } = projection;
  return {
    // — board + rules —
    layerCount: board.layerCount,
    thicknessMm: q(board.boardThicknessMm),
    fabricator: board.fabricator ?? null,
    outline: board.outline ?? null,
    cutouts: board.cutouts ?? null,
    designRules: board.designRules ?? null,
    netClasses: byKey(board.netClasses ?? [], (c) => c.id),
    perNetClassAssignments: board.perNetClassAssignments ?? null,
    diffPairs: byKey(board.diffPairs ?? [], (d) => d.id),
    lengthMatchGroups: byKey(board.lengthMatchGroups ?? [], (g) => g.id),
    drcRules: byKey(board.drcRules ?? [], (r) => r.id),

    // — components —
    placements: byKey(projection.placements, (p) => p.id).map((p) => ({
      id: p.id,
      reference: p.reference,
      layer: p.layer,
      position: qPoint(p.positionMm),
      rotationDeg: q(p.rotationDeg),
      mirrored: p.mirrored,
      // The footprint identity, not its geometry: a re-imported library that changes pad
      // shapes changes the hash, which is the intent.
      footprintId: p.footprint?.footprintId ?? null,
      sourceHash: p.footprint?.sourceHash ?? null,
    })),

    // — copper —
    traces: byKey(projection.traces, (t) => t.id).map((t) => ({
      id: t.id,
      layer: t.layer,
      widthMm: q(t.widthMm),
      netName: t.netName ?? null,
      // integer nm already — no quantization, and no float path to introduce noise
      points: t.pointsNm.map((pt) => [pt.x, pt.y]),
      segmentMode: t.segmentMode,
    })),
    vias: byKey(projection.vias, (v) => v.id).map((v) => ({
      id: v.id,
      center: qPoint(v.centerMm),
      diameterMm: q(v.diameterMm),
      drillMm: q(v.drillMm),
      fromLayer: v.fromLayer ?? null,
      toLayer: v.toLayer ?? null,
      netName: v.netName ?? null,
    })),
    zones: byKey(projection.zones ?? [], (z) => z.id),
    // Fail-closed: a keepout changes what is legal, so it must invalidate a
    // cached route/placement the way a zone does.
    keepouts: byKey(projection.keepouts ?? [], (k) => k.id),
    freeHoles: byKey(projection.freeHoles ?? [], (h) => h.id),
    freePads: byKey(projection.freePads ?? [], (p) => p.id),
  };
}

/**
 * sha256 over the canonical content projection.
 *
 * Deliberately EXCLUDED: `viewState` (and everything in it, including the persisted
 * auto-layout config), `ratsnest` and `netNames` (derived per read, and net ids are
 * ephemeral by design), `revision`, overlay silkscreen text/shapes (cosmetic — they cannot
 * invalidate a placement or a route).
 */
export function computeBoardContentDigest(projection: DesignerPcbProjection): string {
  return createHash("sha256").update(canonicalJson(digestInput(projection))).digest("hex");
}
