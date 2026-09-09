/**
 * Fixture-v2 → DesignerPcbProjection loader — the single implementation behind
 * scripts/drc-parity-harness.ts, scripts/update-drc-goldens.ts and the golden
 * suite (drc-golden.test.ts). Schema doc: scripts/drc-parity-harness.ts header.
 * Coordinates are integer nanometers unless the key says Mm.
 */
import { createDefaultPcbBoardSettings } from "../../../../modules/designer/backend/pcb/pcb-defaults";
import { computeRatsnest } from "../../../../modules/designer/backend/pcb/ratsnest";
import {
  boardPourSpecs,
  buildBoardPourFills,
} from "../../../../modules/designer/backend/pcb/board-connectivity";
import { placementPads } from "../../../../modules/designer/backend/pcb/pad-geometry";
import type {
  DesignerPcbProjection,
  PcbBoardSettings,
  PcbKeepout,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
  PcbZone,
  RatsnestSegment,
} from "../../../../sdks/designer";
import {
  collectCopperZones,
  collectKeepouts,
} from "../../../../shared/pcb-areas/copper-zones";
import {
  parsePcbKeepoutRecord,
  upgradePcbZoneRecord,
} from "../../../../shared/pcb-areas/zone-parse";
import { zonePourNets } from "../../../../shared/pcb-areas/pour-params";

const TS = "2026-01-01T00:00:00.000Z";
const NM = 1_000_000;

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON fixture */
export function fixtureToProjection(fixture: any): DesignerPcbProjection {
  const board: PcbBoardSettings = createDefaultPcbBoardSettings(TS);
  board.fabricator = fixture.fabricator ?? "custom";
  // Goldens are FLOOR-FREE unless the fixture asks for one: the 0.1 mm
  // `minimums.clearanceMm` is a NEW-BOARD default (rule-semantics §12 item 5)
  // and applying it here would silently re-baseline every existing golden.
  delete board.designRules.minimums.clearanceMm;
  if (fixture.clearance)
    Object.assign(board.designRules.clearance, fixture.clearance);
  if (fixture.minimums)
    Object.assign(board.designRules.minimums, fixture.minimums);
  if (fixture.drcRules) board.drcRules = fixture.drcRules;
  if (fixture.drcSeverityOverrides)
    board.drcSeverityOverrides = fixture.drcSeverityOverrides;
  if (fixture.layerCount) board.layerCount = fixture.layerCount;
  if (fixture.boardThicknessMm)
    board.boardThicknessMm = fixture.boardThicknessMm;
  if (fixture.netClasses) board.netClasses = fixture.netClasses;
  if (fixture.perNetClassAssignments)
    board.perNetClassAssignments = fixture.perNetClassAssignments;
  if (fixture.cutouts) board.cutouts = fixture.cutouts;
  if (fixture.diffPairs) board.diffPairs = fixture.diffPairs;
  if (fixture.lengthMatchGroups)
    board.lengthMatchGroups = fixture.lengthMatchGroups;
  // Wide default outline so v1 fixtures are never accidentally off-board /
  // near the edge; v2 fixtures may supply a real outline.
  board.outline = fixture.outline ?? {
    kind: "rect",
    widthMm: 200,
    heightMm: 200,
    centerMm: { x: 0, y: 0 },
  };

  const traces: PcbTrace[] = (fixture.traces ?? []).map((t: any) => ({
    id: t.id,
    netId: t.netId ?? null,
    netClassId: t.netClassId ?? "default",
    layer: t.layer ?? "F.Cu",
    widthMm: t.widthMm,
    segmentMode: t.segmentMode ?? "manhattan-90",
    pointsNm: t.pointsNm.map(
      (p: [number, number] | { x: number; y: number }) =>
        Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y },
    ),
  }));

  const vias: PcbVia[] = (fixture.vias ?? []).map((v: any) => ({
    id: v.id,
    netId: v.netId ?? null,
    netClassId: v.netClassId ?? "default",
    centerMm: { x: v.centerMm[0] / NM, y: v.centerMm[1] / NM },
    diameterMm: v.diameterMm,
    drillMm: v.drillMm,
    fromLayer: v.fromLayer ?? "F.Cu",
    toLayer: v.toLayer ?? "B.Cu",
    viaType: v.viaType ?? "through",
    protection: v.protection ?? "tented",
    provenance: "route",
  }));

  const placements: PcbPlacedPart[] = (fixture.placements ?? []).map(
    (p: any) => ({
      id: p.id,
      partId: p.partId ?? p.id,
      componentId: p.componentId ?? "c",
      reference: p.reference ?? p.id,
      positionMm: p.positionMm ?? { x: 0, y: 0 },
      rotationDeg: p.rotationDeg ?? 0,
      mirrored: p.mirrored ?? false,
      layer: p.layer ?? "F.Cu",
      footprint: {
        footprintId: p.footprintId ?? "fp",
        name: p.footprintName ?? "FP",
        mountType: null,
        sourceHash: null,
        preview: {
          kind: "footprint",
          units: "mm",
          name: p.footprintName ?? "FP",
          pads: p.pads ?? [],
          graphics: p.graphics ?? [],
          labels: [],
          bounds: null,
          warnings: [],
        },
      },
    }),
  );

  const padNets: Record<string, string> = fixture.padNets ?? {};

  // Fixture zones are stored in the v1 shape; the goldens stay byte-identical
  // because they go through the SAME read-time upgrade the store uses.
  const zones: PcbZone[] = [];
  for (const raw of fixture.zones ?? []) {
    const upgraded = upgradePcbZoneRecord(raw);
    if (upgraded.zone) zones.push(upgraded.zone);
  }
  // Keepouts take the same read path the store uses (fail-closed parse).
  const keepouts: PcbKeepout[] = [];
  for (const raw of fixture.keepouts ?? []) {
    const parsed = parsePcbKeepoutRecord(raw);
    if (parsed) keepouts.push(parsed);
  }
  const knownNetIds = new Set(Object.keys(fixture.netNames ?? {}));

  // Derive the ratsnest through the real computeRatsnest so UNCONNECTED_NET is
  // fixture-testable, with the same pour wiring loadPcbProjection uses: the
  // effective copper areas, board rows and explicit zones alike.
  function deriveRatsnest(): RatsnestSegment[] {
    const netNames = new Map<string, string>(
      Object.entries(fixture.netNames ?? {}),
    );
    const copper = {
      layerCount: board.layerCount,
      placements,
      padNetIds: new Map(Object.entries(padNets)),
      freePads: fixture.freePads ?? [],
      traces,
      vias,
    };
    // One kernel run per net-bound zone, exactly as DRC does it (contract §9).
    const pours = buildBoardPourFills(copper, {
      outline: board.outline,
      designRules: board.designRules,
      cutouts: board.cutouts ?? [],
      freeHoles: fixture.freeHoles ?? [],
      pours: boardPourSpecs(
        collectCopperZones({
          zones,
          layerCount: board.layerCount,
          knownNetIds,
        }).zones,
        board.designRules,
        collectKeepouts({ keepouts, layerCount: board.layerCount }).keepouts,
        zonePourNets(board, fixture.netNames ?? {}),
      ),
    });
    return computeRatsnest({
      ...copper,
      netNames,
      netClasses: board.netClasses,
      perNetClassAssignments: board.perNetClassAssignments,
      pours,
    });
  }

  return {
    designId: "parity",
    revision: 1,
    board,
    placements,
    traces,
    vias,
    freeHoles: fixture.freeHoles ?? [],
    freePads: fixture.freePads ?? [],
    overlayTexts: fixture.overlayTexts ?? [],
    overlayShapes: fixture.overlayShapes ?? [],
    zones,
    keepouts,
    ratsnest: fixture.computeRatsnest ? deriveRatsnest() : [],
    netNames: fixture.netNames ?? {},
    ...(Object.keys(padNets).length > 0 ? { padNets } : {}),
    warnings: [],
  };
}

/** Count of copper/drill primitives a fixture contributes (fixture-v2). */
export function fixturePrimitiveCount(p: DesignerPcbProjection): number {
  const padCount = p.placements.reduce(
    (sum, pl) => sum + placementPads(pl).length,
    0,
  );
  return (
    p.traces.length +
    p.vias.length +
    padCount +
    p.freePads.length +
    p.freeHoles.length
  );
}
