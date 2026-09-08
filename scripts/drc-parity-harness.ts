#!/usr/bin/env bun
// DRC parity harness — runs the REAL desktop DRC on a fixture and emits its verdict
// as JSON, so cloud-auto-router's Python legality oracle can be cross-checked against
// it (conservative envelope: anything the oracle marks legal, this must NOT error).
//
//   echo '<fixture json>' | bun run scripts/drc-parity-harness.ts [--verbose]
//
// Fixture schema v2 (all keys optional; a v1 fixture parses byte-identically).
// Coords are integer nanometers unless the key says Mm; widths/clearances are mm:
//   {
//     "schemaVersion": 2,                       // informational
//     "fabricator": "custom",                  // default "custom" (no FAB warnings)
//     "clearance":  { "traceToTraceMm": 0.25 } // overrides of designRules.clearance
//     "minimums":   { ... },                   // overrides of designRules.minimums
//     "layerCount": 2,
//     "boardThicknessMm": 1.6,
//     "outline": { "kind": "rect", ... },      // full PcbBoardOutline; default 200×200 rect
//     "cutouts": [{ "id", "shape": { ... } }],
//     "netClasses": [ ...PcbNetClass ],        // REPLACES the default classes when given
//     "perNetClassAssignments": { "n1": "wide" },
//     // per-layer copper fill is a "zones" row: { "region": { "kind": "board" },
//     //   "id": "board:F.Cu", "layer": "F.Cu", "netId": "n1" }
//     "traces": [{ "id","netId","netClassId","layer","widthMm","pointsNm":[[x,y],...] }],
//     "vias":   [{ "id","netId","centerMm":[x,y],"diameterMm","drillMm","fromLayer","toLayer",
//                  "viaType","protection" }],
//     "placements": [{ "id","reference","positionMm":{x,y},"rotationDeg","mirrored","layer",
//                      "pads": [ ...FootprintRenderSourcePad ] }],
//     "padNets":  { "U1|1": "n1" },
//     "freePads": [ ...PcbFreePad ], "freeHoles": [ ...PcbFreeHole ],
//     "zones": [ ...PcbZone ], "overlayTexts": [...], "overlayShapes": [...],
//     "computeRatsnest": true,                 // derive projection.ratsnest from
//                                              // placements+padNets via the real
//                                              // computeRatsnest — POUR-AWARE:
//                                              // one fill-kernel run per net-bound
//                                              // effective zone feeds the graph
//     "netNames": { "n1": "NET_A" }
//   }
//
// Output (stable v1 shape): {"errors","warnings","violations":[{"code","severity"}]}
// With --verbose each violation also carries id/message/layer/location/measured/required.
import { runDrc } from "../src/modules/designer/backend/drc/drc-engine";
import { fixtureToProjection } from "../src/core/backend/tests/helpers/drc-golden";

const verbose = process.argv.includes("--verbose");
const fixture = JSON.parse(await Bun.stdin.text());
const report = runDrc(fixtureToProjection(fixture));

console.log(
  JSON.stringify({
    errors: report.summary.errors,
    warnings: report.summary.warnings,
    violations: report.violations.map((v) =>
      verbose
        ? {
            code: v.code,
            severity: v.severity,
            id: v.id,
            message: v.message,
            layer: v.layer ?? null,
            locationMm: v.locationMm ?? null,
            measuredMm: v.measuredMm ?? null,
            requiredMm: v.requiredMm ?? null,
          }
        : { code: v.code, severity: v.severity },
    ),
  }),
);
