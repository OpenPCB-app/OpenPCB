#!/usr/bin/env bun
// BoardSnapshot round-trip parity harness — runs the REAL desktop
// `buildBoardSnapshot()` on representative synthetic projections and prints
// the resulting `BoardSnapshot`s as a JSON array to stdout, so
// cloud-auto-layout's Python side can validate them (Pydantic model +
// `validate_snapshot`) against what the desktop actually serializes.
// Mirrors scripts/drc-parity-harness.ts's self-contained-fixture style;
// fixtures here are adapted from
// src/core/backend/tests/designer-board-snapshot.test.ts.
//
//   bun run scripts/board-snapshot-parity-harness.ts
//
// Emits 3 snapshots covering: (1) a minimal 2-net board (baseline), and a
// richer board — NPTH free pad with an oblong drill slot, mountType-tagged
// placements (smd + tht), a blind via, and a copper zone — serialized both
// (2) with `serializePours: false` (default; zone → warning, no pours) and
// (3) `serializePours: true` (zone → pour island, no warning). Each array
// element also carries the build `warnings` alongside the `snapshot`, so a
// consumer can check either without a second run.
import { buildBoardSnapshot } from "../src/modules/designer/backend/pcb/board-snapshot";
import { createDefaultPcbBoardSettings } from "../src/modules/designer/backend/pcb/pcb-defaults";
import type { FootprintRenderSourcePad } from "../src/shared/rendering/types";
import type {
  DesignerPcbProjection,
  PcbBoardSettings,
  PcbFreeHole,
  PcbFreePad,
  PcbPlacedPart,
  PcbVia,
  PcbZone,
  RatsnestSegment,
} from "../src/sdks/designer";

const TS = "2026-01-01T00:00:00.000Z";

function board(overrides: Partial<PcbBoardSettings> = {}): PcbBoardSettings {
  return { ...createDefaultPcbBoardSettings(TS), ...overrides };
}

function projection(parts: Partial<DesignerPcbProjection> = {}): DesignerPcbProjection {
  return {
    designId: parts.designId ?? "parity-harness",
    revision: parts.revision ?? 1,
    board: parts.board ?? board(),
    placements: parts.placements ?? [],
    traces: parts.traces ?? [],
    vias: parts.vias ?? [],
    freeHoles: parts.freeHoles ?? [],
    freePads: parts.freePads ?? [],
    overlayTexts: parts.overlayTexts ?? [],
    overlayShapes: parts.overlayShapes ?? [],
    zones: parts.zones ?? [],
    keepouts: [],
    ratsnest: parts.ratsnest ?? [],
    netNames: parts.netNames ?? {},
    padNets: parts.padNets,
    warnings: [],
  };
}

function smdPad(number: string, center: { x: number; y: number }): FootprintRenderSourcePad {
  return {
    id: `pad-${number}`,
    number,
    shape: "rect",
    centerMm: center,
    widthMm: 1,
    heightMm: 1,
    rotationDeg: 0,
  };
}

function thPad(number: string, center: { x: number; y: number }): FootprintRenderSourcePad {
  return { ...smdPad(number, center), shape: "circle", drillDiameterMm: 0.4 };
}

function placement(
  id: string,
  pads: FootprintRenderSourcePad[],
  positionMm = { x: 0, y: 0 },
  mountType: string | null = null,
): PcbPlacedPart {
  return {
    id,
    partId: id,
    componentId: "c",
    reference: id,
    positionMm,
    rotationDeg: 0,
    mirrored: false,
    layer: "F.Cu",
    footprint: {
      footprintId: "fp",
      name: "FP",
      mountType,
      sourceHash: null,
      preview: {
        kind: "footprint",
        units: "mm",
        name: "FP",
        pads,
        graphics: [],
        labels: [],
        bounds: null,
        warnings: [],
      },
    },
  };
}

function freePad(overrides: Partial<PcbFreePad> = {}): PcbFreePad {
  return {
    id: "fp1",
    centerMm: { x: 0, y: 0 },
    rotationDeg: 0,
    padType: "smd",
    shape: "circle",
    widthMm: 1,
    heightMm: 1,
    drillMm: null,
    layer: "F.Cu",
    netId: null,
    solderMaskExpansionMm: null,
    solderPasteExpansionMm: null,
    lockedAt: null,
    ...overrides,
  };
}

function freeHole(overrides: Partial<PcbFreeHole> = {}): PcbFreeHole {
  return {
    id: "h1",
    centerMm: { x: 0, y: 0 },
    drillMm: 1,
    lockedAt: null,
    ...overrides,
  };
}

function via(overrides: Partial<PcbVia> = {}): PcbVia {
  return {
    id: "v1",
    netId: "net_a",
    netClassId: "default",
    centerMm: { x: 0, y: 0 },
    diameterMm: 0.6,
    drillMm: 0.3,
    fromLayer: "F.Cu",
    toLayer: "B.Cu",
    viaType: "through",
    protection: "tented",
    provenance: "route",
    ...overrides,
  };
}

function rats(netId: string, netClassId = "default"): RatsnestSegment {
  return {
    netId,
    netClassId,
    fromMm: { x: 1, y: 1 },
    toMm: { x: 9, y: 1 },
    from: { kind: "pad", placementId: "U1", padNumber: "1" },
    to: { kind: "pad", placementId: "U2", padNumber: "1" },
  };
}

function zone(overrides: Partial<PcbZone> = {}): PcbZone {
  return {
    id: "z1",
    name: null,
    enabled: true,
    lockedAt: null,
    netName: "GND",
    netId: "net_gnd",
    layer: "F.Cu",
    region: {
      kind: "polygon",
      pointsMm: [
        { x: -10, y: -5 },
        { x: 10, y: -5 },
        { x: 10, y: 5 },
        { x: -10, y: 5 },
      ],
    },
    priority: 0,
    ...overrides,
  };
}

// ── fixture 1: minimal 2-net board ────────────────────────────────────────

const minimal = projection({
  designId: "parity-minimal",
  placements: [placement("U1", [smdPad("1", { x: 0, y: 0 }), smdPad("2", { x: 2, y: 0 })])],
  padNets: { "U1|1": "net_a", "U1|2": "net_b" },
  netNames: { net_a: "NET_A", net_b: "NET_B" },
  ratsnest: [rats("net_a")],
});

// ── fixture 2: rich board (NPTH + slot + mountType + blind via + zone) ────

const rich = projection({
  designId: "parity-rich",
  board: board({ layerCount: 4 }),
  placements: [
    placement("U1", [smdPad("1", { x: 0, y: 0 }), smdPad("2", { x: 2, y: 0 })], { x: 0, y: 0 }, "smd"),
    placement("U2", [thPad("1", { x: 0, y: 0 })], { x: 5, y: 0 }, "through_hole"),
  ],
  padNets: { "U1|1": "net_a", "U1|2": "net_b", "U2|1": "net_c" },
  netNames: { net_a: "NET_A", net_b: "NET_B", net_c: "NET_C", net_gnd: "GND" },
  ratsnest: [rats("net_a"), rats("net_gnd", "default")],
  freePads: [
    freePad({
      id: "npth1",
      padType: "hole",
      drillMm: 0.8,
      centerMm: { x: 3, y: 4 },
      drillSlot: { lengthMm: 2, widthMm: 0.8, angleDeg: 0 },
    }),
  ],
  freeHoles: [freeHole({ id: "h1", centerMm: { x: -5, y: -5 }, drillMm: 1 })],
  vias: [via({ id: "v1", viaType: "blind", fromLayer: "F.Cu", toLayer: "In1.Cu" })],
  zones: [zone()],
});

// ── run + emit ─────────────────────────────────────────────────────────────

const samples = [
  { name: "minimal", ...buildBoardSnapshot(minimal) },
  { name: "rich_pours_off", ...buildBoardSnapshot(rich, { serializePours: false }) },
  { name: "rich_pours_on", ...buildBoardSnapshot(rich, { serializePours: true }) },
];

console.log(JSON.stringify(samples));
