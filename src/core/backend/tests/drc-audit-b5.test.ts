/**
 * Audit regression suite B5 — engine architecture, waivers, live-DRC parity
 * (DRC_AUDIT_REPORT.md §4). Post-fix expectations; flip live per milestone.
 * Live-DRC tests exercise the frontend pure module under bun, matching the
 * repo convention (see route-tool-state.test.ts).
 */
import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { DesignerCommandEnvelope, DesignerSDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { runLiveDrc } from "../../../modules/designer/frontend/pcb/drc/live-drc";
import { createRuleResolver } from "../../../shared/drc/rule-resolver";
import {
  board,
  codes,
  pad,
  placement,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";

function isolateTestDb(testLabel: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${testLabel}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

async function createRuntimeAndServer() {
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: repoRoot,
  });
  await moduleRuntime.bootstrap();
  const server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  return { moduleRuntime, server };
}

const MM = 1_000_000;

/**
 * The live gate resolves clearance through the SAME resolver as batch DRC
 * (rule-semantics contract §9), so these fixtures build one from the fixture
 * board rather than passing net classes and design rules by hand.
 */
function liveResolver() {
  return createRuleResolver(
    board(),
    { n1: "A", n2: "B" },
    { validCopperLayers: ["F.Cu", "B.Cu"] },
  );
}

describe("audit B5 — architecture / waivers / live parity", () => {
  // Fixed in P2c (layer-invalid items still collision-checked; span non-waivable).
  test("B5-VIA-MASK: layer-invalid via cannot mask a dead short", () => {
    const build = () =>
      projection({
        netNames: { n1: "A", n2: "B" },
        vias: [
          // In1→In2 on a 2-layer board → viaSpanLayers() = [] today, making
          // the via invisible to every clearance/short loop.
          via("v", {
            netId: "n1",
            center: { x: 5, y: 5 },
            fromLayer: "In1.Cu",
            toLayer: "In2.Cu",
          }),
        ],
        traces: [trace("t", "n2", [[3, 5], [7, 5]])],
      });
    const report = runDrc(build());
    expect(codes(report)).toContain("VIA_LAYER_SPAN");
    // Post-fix: the physical copper collision surfaces as well.
    expect(codes(report)).toContain("NET_SHORT_CIRCUIT");
    // And waiving the span violation must NOT hide it (non-waivable).
    const spanId = report.violations.find(
      (v) => v.code === "VIA_LAYER_SPAN",
    )!.id;
    const waived = runDrc(build(), { waivedIds: [spanId] });
    expect(waived.summary.errors).toBeGreaterThan(0);
  });

  // Fixed in P2c (pad/via layer legality check — PAD_LAYER_MISMATCH).
  test("B5-PAD-LAYER: off-stackup pad layer is flagged AND still collides", () => {
    const report = runDrc(
      projection({
        placements: [
          placement("U1", {
            positionMm: { x: 5, y: 5 },
            pads: [pad("1", { x: 0, y: 0 }, 1.2, 1.2, { layer: "In1.Cu" })],
          }),
        ],
        padNets: { "U1|1": "n1" },
        netNames: { n1: "A", n2: "B" },
        // Different-net B.Cu trace through the pad — an In1.Cu pad on a
        // 2-layer board is checked on all valid layers, so the short surfaces.
        traces: [trace("t", "n2", [[3, 5], [7, 5]], { layer: "B.Cu" })],
      }),
    );
    expect(codes(report).map(String)).toContain("PAD_LAYER_MISMATCH");
    expect(codes(report)).toContain("NET_SHORT_CIRCUIT");
  });

  // Fixed in P3 (violation-id v2 buckets location — waivers stop drifting).
  test("B5-WAIVER-DRIFT: waiver expires when the hotspot moves", () => {
    const marginal = projection({
      netNames: { n1: "A", n2: "B" },
      traces: [
        trace("a", "n1", [[0, 0], [10, 0]]),
        trace("b", "n2", [[0, 0.44], [10, 0.44]]), // gap 0.24 < 0.25
      ],
    });
    const id = runDrc(marginal).violations.find(
      (v) => v.code === "TRACE_TO_TRACE_CLEARANCE",
    )!.id;
    // Same pair, violation location moved to the other end of the board.
    const moved = projection({
      netNames: { n1: "A", n2: "B" },
      traces: [
        trace("a", "n1", [[0, 0], [10, 0]]),
        trace("b", "n2", [
          [0, 5],
          [9.9, 5],
          [9.9, 0.21], // dives in near x≈9.9 only
          [10, 0.21],
        ]),
      ],
    });
    const waived = runDrc(moved, { waivedIds: [id] });
    // Post-fix: the old waiver no longer matches the new hotspot.
    expect(
      waived.violations.some(
        (v) => v.code === "TRACE_TO_TRACE_CLEARANCE" && !v.waived,
      ),
    ).toBe(true);
  });

  // Fix: P7 (live pads use true rotated rings via the shared batch builders).
  test.todo("B5-LIVE-ROT-PAD: rotated non-square pad is checked as rotated", () => {
    // Rewritten: the previous geometry passed today for the wrong reason —
    // its trace (y 3→7) fully overlapped BOTH the true rotated pad AND
    // today's unrotated AABB, so it didn't distinguish the two models.
    //
    // U1 at (5,5) rotated 90°, pad 2.0×0.5 (local W×H). computePadGeoms
    // does not swap width/height for rotation, so today's AABB stays
    // 2.0×0.5 around the ROTATED center: x∈[4,6], y∈[4.75,5.25]. The TRUE
    // rotated copper is 0.5×2.0: x∈[4.75,5.25], y∈[4,6].
    //
    // padClearance = max(netClass.clearanceMm, traceToPadMm) = 0.25;
    // pendingHalf = 0.2/2 = 0.1 → required = 0.35 (live-drc.ts ~L145-150,
    // ~L204).
    //
    // Pending trace: vertical centerline at x=5.35 (copper x∈[5.25,5.45]),
    // from y=3 to y=4.3.
    //   - Against the TRUE rotated pad (x∈[4.75,5.25], y∈[4,6]): x-gap is 0
    //     (5.25 touches 5.25) and y overlaps 4.0–4.3 (≥0.2 mm overlap) — a
    //     real violation post-fix.
    //   - Against today's unrotated AABB (x∈[4,6], y∈[4.75,5.25]): the
    //     centerline's x (5.35) is INSIDE the box's x-span, so the reported
    //     gap is purely the y-distance from the segment's near end (4.3) to
    //     the box's bottom edge (4.75) = 0.45 mm ≥ required (0.35) + 0.05 mm
    //     margin — clean today.
    const parts = [
      placement("U1", {
        positionMm: { x: 5, y: 5 },
        rotationDeg: 90,
        // 2.0×0.5 pad rotated 90° → occupies 0.5×2.0 in world space.
        pads: [pad("1", { x: 0, y: 0 }, 2.0, 0.5)],
      }),
    ];
    const violations = runLiveDrc({
      traceNm: [
        { x: 5.35 * MM, y: 3 * MM },
        { x: 5.35 * MM, y: 4.3 * MM },
      ],
      traceWidthMm: 0.2,
      netId: "n2",
      layer: "F.Cu",
      traces: [],
      placements: parts,
      padNetMap: new Map([["U1|1", "n1"]]),
      resolver: liveResolver(),
    });
    expect(violations.length).toBeGreaterThan(0);
  });

  // Fix: P7 (live TH pads span both sides, like the batch context).
  test.todo("B5-LIVE-TH-PAD-SIDE: routing B.Cu sees top-side THT barrels", () => {
    const parts = [
      placement("U1", {
        positionMm: { x: 5, y: 5 },
        layer: "F.Cu",
        pads: [pad("1", { x: 0, y: 0 }, 1.6, 1.6, { drillDiameterMm: 0.8 })],
      }),
    ];
    const violations = runLiveDrc({
      traceNm: [
        { x: 3 * MM, y: 5 * MM },
        { x: 7 * MM, y: 5 * MM },
      ],
      traceWidthMm: 0.2,
      netId: "n2",
      layer: "B.Cu", // opposite side of the placement
      traces: [],
      placements: parts,
      padNetMap: new Map([["U1|1", "n1"]]),
      resolver: liveResolver(),
    });
    expect(violations.length).toBeGreaterThan(0);
  });

  // Fixed (computePadGeoms hoisted; verified S0 2026-09-06). Residual
  // per-cursor-move rebuild tracked in docs/pcb-hardening/00-ground-truth.md.
  test("B5-LIVE-PADGEOMS: pad geometry built once per live run", () => {
    let padsAccessCount = 0;
    const parts = [
      placement("U1", {
        positionMm: { x: 5, y: 5 },
        pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
      }),
      placement("U2", {
        positionMm: { x: 20, y: 5 },
        pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
      }),
    ];
    for (const part of parts) {
      const preview = part.footprint.preview!;
      const realPads = preview.pads;
      Object.defineProperty(preview, "pads", {
        configurable: true,
        get() {
          padsAccessCount += 1;
          return realPads;
        },
      });
    }

    runLiveDrc({
      // 4 points → 3 pending segments; pad geometry must not be rebuilt once
      // per segment.
      traceNm: [
        { x: 0 * MM, y: 0 * MM },
        { x: 3 * MM, y: 0 * MM },
        { x: 6 * MM, y: 0 * MM },
        { x: 9 * MM, y: 0 * MM },
      ],
      traceWidthMm: 0.2,
      netId: "n2",
      layer: "F.Cu",
      traces: [],
      placements: parts,
      padNetMap: new Map([
        ["U1|1", "n1"],
        ["U2|1", "n1"],
      ]),
      resolver: liveResolver(),
    });

    expect(padsAccessCount).toBe(parts.length);
  });

  // Fixed in P2 (stackup 2–32; 6-layer no longer silently degrades to 2).
  test("B5-6LAYER: 6-layer board validates In3.Cu instead of degrading", () => {
    const report = runDrc(
      projection({
        // Post-P2 PcbLayerCount accepts 6; the cast documents today's gap.
        board: { ...board(), layerCount: 6 },
        traces: [trace("t", null, [[0, 0], [10, 0]], { layer: "In1.Cu" })],
      }),
    );
    // In1.Cu is valid copper on a 6-layer board — no mismatch.
    expect(codes(report)).not.toContain("TRACE_LAYER_MISMATCH");
  });

  // Fix: P7 (async DRC task executor; run route stops blocking the loop).
  test.todo("B5-SYNC: large-board DRC runs off the request path", async () => {
    // Architectural: asserted in the P7 task-executor tests (enqueue +
    // progress + cancel), not through runDrc itself.
    //
    // Per TODO.md P7 (§5): "the route runs synchronously at ≤2000 primitives
    // and otherwise returns 202 {taskId}". No route-level test harness
    // exists for /drc/run specifically, but the designer route module is
    // exercised elsewhere over real HTTP (designer-autolayout-auth.test.ts)
    // via `runtime.server.fetch(...)` against a bootstrapped ModuleRuntime —
    // reused here rather than calling the handler function directly.
    isolateTestDb("drc-audit-b5-sync");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "B5-SYNC" });
    const initial = await designerSdk.getPcbProjection(design.id);
    const netClassId = initial!.board.netClasses[0]!.id;

    // >2000 copper primitives — one 2-point trace per command, well past
    // the sync threshold. baseRevision: null skips the revision check so
    // each dispatch doesn't need to track the running head revision.
    const TRACE_COUNT = 2100;
    for (let i = 0; i < TRACE_COUNT; i += 1) {
      const y = i * 0.1;
      const result = await designerSdk.dispatchCommand(design.id, {
        commandId: `cmd-trace-${i}`,
        sessionId: "s",
        aggregateId: design.id,
        baseRevision: null,
        issuedAt: Date.now(),
        command: {
          type: "pcb_add_trace",
          layer: "F.Cu",
          pointsNm: [
            { x: 0, y: Math.round(y * 1_000_000) },
            { x: 1_000_000, y: Math.round(y * 1_000_000) },
          ],
          widthMm: 0.2,
          netId: null,
          netClassId,
          segmentMode: "manhattan-90",
        },
      } satisfies DesignerCommandEnvelope);
      expect(result.ok).toBe(true);
    }

    const res = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${design.id}/drc/run`,
        { method: "POST" },
      ),
    );
    // Today: always synchronous, always 200 with a report — this fails.
    expect(res.status).toBe(202);
    const body = (await res.json()) as { taskId?: unknown };
    expect(typeof body.taskId).toBe("string");
  });
});
