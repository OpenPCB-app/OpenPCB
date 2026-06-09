#!/usr/bin/env bun
// DRC parity harness — runs the REAL desktop DRC on a fixture and emits its verdict
// as JSON, so cloud-auto-router's Python legality oracle can be cross-checked against
// it (conservative envelope: anything the oracle marks legal, this must NOT error).
//
//   echo '<fixture json>' | bun run scripts/drc-parity-harness.ts
//
// Fixture shape (coords are integer nanometers; widths/clearances are mm):
//   {
//     "fabricator": "custom",                  // optional, default "custom" (no FAB warnings)
//     "clearance":  { "traceToTraceMm": 0.25 } // optional overrides of designRules.clearance
//     "minimums":   { ... },                   // optional overrides of designRules.minimums
//     "layerCount": 2,                          // optional
//     "traces": [{ "id","netId","netClassId","layer","widthMm","pointsNm":[[x,y],...] }],
//     "vias":   [{ "id","netId","centerMm":[x,y],"diameterMm","drillMm","fromLayer","toLayer" }],
//     "netNames": { "n1": "NET_A" }
//   }
import { runDrc } from "../src/modules/designer/backend/drc/drc-engine";
import { createDefaultPcbBoardSettings } from "../src/modules/designer/backend/pcb/pcb-defaults";
import type {
  DesignerPcbProjection,
  PcbBoardSettings,
  PcbTrace,
  PcbVia,
} from "../src/sdks/designer";

const TS = "2026-01-01T00:00:00.000Z";
const NM = 1_000_000;

const fixture = JSON.parse(await Bun.stdin.text());

const board: PcbBoardSettings = createDefaultPcbBoardSettings(TS);
board.fabricator = fixture.fabricator ?? "custom";
if (fixture.clearance)
  Object.assign(board.designRules.clearance, fixture.clearance);
if (fixture.minimums)
  Object.assign(board.designRules.minimums, fixture.minimums);
if (fixture.layerCount) board.layerCount = fixture.layerCount;
// widen the outline so fixture geometry is never accidentally off-board / near the edge
board.outline = {
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
  pointsNm: t.pointsNm.map(([x, y]: [number, number]) => ({ x, y })),
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
  viaType: "through",
  protection: "tented",
  provenance: "route",
}));

const projection: DesignerPcbProjection = {
  designId: "parity",
  revision: 1,
  board,
  placements: [],
  traces,
  vias,
  freeHoles: [],
  freePads: [],
  overlayTexts: [],
  overlayShapes: [],
  zones: [],
  ratsnest: [],
  netNames: fixture.netNames ?? {},
  warnings: [],
};

const report = runDrc(projection);
console.log(
  JSON.stringify({
    errors: report.summary.errors,
    warnings: report.summary.warnings,
    violations: report.violations.map((v) => ({
      code: v.code,
      severity: v.severity,
    })),
  }),
);
