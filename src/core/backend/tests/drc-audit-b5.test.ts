/**
 * Audit regression suite B5 — engine architecture, waivers, live-DRC parity
 * (DRC_AUDIT_REPORT.md §4). Post-fix expectations; flip live per milestone.
 * Live-DRC tests exercise the frontend pure module under bun, matching the
 * repo convention (see route-tool-state.test.ts).
 */
import { afterAll, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type {
  DesignerCommandEnvelope,
  DesignerSDK,
  DrcReport,
  DrcRunSnapshot,
} from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import type { RawFootprintLookup } from "../../../shared/pcb-geometry/courtyard";
import {
  disposeDrcWorker,
  setDrcWorkerEntry,
  setDrcWorkerFactoryForTesting,
  type DrcWorkerLike,
} from "../../../shared/drc/worker/drc-worker-client";
import type {
  DrcWorkerRequest,
  DrcWorkerResponse,
} from "../../../shared/drc/worker/protocol";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import {
  blockingViolations,
  runLiveDrc,
} from "../../../modules/designer/frontend/pcb/drc/live-drc";
import { buildDrcItems } from "../../../shared/drc/drc-context";
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

// ── B5-SYNC harness (execution contract 09 §8) ─────────────────────────────

interface FakeWorkerEvents {
  message: DrcWorkerResponse;
  error: Error;
  exit: number;
}

/** A worker that answers only when the test says so. */
class ControlledWorker implements DrcWorkerLike {
  readonly received: DrcWorkerRequest[] = [];

  private readonly listeners: {
    [K in keyof FakeWorkerEvents]: Array<(payload: FakeWorkerEvents[K]) => void>;
  } = { message: [], error: [], exit: [] };

  constructor() {
    setTimeout(() => this.emit("message", { type: "ready" }), 0);
  }

  postMessage(message: DrcWorkerRequest): void {
    this.received.push(message);
  }

  on<K extends keyof FakeWorkerEvents>(
    event: K,
    listener: (payload: FakeWorkerEvents[K]) => void,
  ): void {
    this.listeners[event].push(listener);
  }

  off<K extends keyof FakeWorkerEvents>(
    event: K,
    listener: (payload: FakeWorkerEvents[K]) => void,
  ): void {
    const list = this.listeners[event];
    const index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
  }

  terminate(): Promise<number> {
    return Promise.resolve(0);
  }

  emit<K extends keyof FakeWorkerEvents>(
    event: K,
    payload: FakeWorkerEvents[K],
  ): void {
    for (const listener of [...this.listeners[event]]) listener(payload);
  }

  /** Answers the held run with exactly what the in-thread engine produces. */
  release(): void {
    const request = this.received.at(-1)!;
    const entries = request.rawFootprints;
    const lookup: RawFootprintLookup | undefined =
      entries === null
        ? undefined
        : ((byId) => (footprintId: string) => byId.get(footprintId) ?? null)(
            new Map(entries),
          );
    this.emit("message", {
      type: "done",
      runId: request.runId,
      report: runDrc(request.projection, { lookupRawFootprint: lookup }),
    });
  }
}

async function useControlledWorker(): Promise<ControlledWorker[]> {
  await disposeDrcWorker();
  const workers: ControlledWorker[] = [];
  setDrcWorkerFactoryForTesting(() => {
    const worker = new ControlledWorker();
    workers.push(worker);
    return worker;
  });
  return workers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function drcUrl(designId: string, suffix = ""): string {
  return `http://localhost/api/modules/designer/designs/${designId}/drc${suffix}`;
}

async function snapshotFrom(
  response: Response,
  expectedStatus = 200,
): Promise<DrcRunSnapshot> {
  expect(response.status).toBe(expectedStatus);
  const body = (await response.json()) as { data: DrcRunSnapshot };
  return body.data;
}

type TestServer = { fetch(req: Request): Promise<Response> };

async function waitForStatus(
  server: TestServer,
  designId: string,
  runId: string,
  status: DrcRunSnapshot["status"],
): Promise<void> {
  const deadline = Date.now() + 30_000;
  let last = "";
  while (Date.now() < deadline) {
    const snapshot = await snapshotFrom(
      await server.fetch(new Request(drcUrl(designId, `/runs/${runId}`))),
    );
    last = snapshot.status;
    if (snapshot.status === status) return;
    if (snapshot.status !== "queued" && snapshot.status !== "running") break;
    await sleep(10);
  }
  throw new Error(`run ${runId} ended '${last}', expected '${status}'`);
}

async function storedReport(
  server: TestServer,
  designId: string,
): Promise<DrcReport | null> {
  const response = await server.fetch(new Request(drcUrl(designId)));
  expect(response.status).toBe(200);
  const body = (await response.json()) as { data: { report: DrcReport | null } };
  return body.data.report;
}

/**
 * A trace the commit gate accepts: 1.5 mm apart, well clear of the default
 * 0.25 mm clearance. `baseRevision: null` skips the revision check so seeding
 * need not track the head.
 */
function traceEnvelope(
  designId: string,
  commandId: string,
  index: number,
  netClassId: string,
): DesignerCommandEnvelope {
  const y = Math.round(index * 1.5 * MM);
  return {
    commandId,
    sessionId: "b5-sync",
    aggregateId: designId,
    baseRevision: null,
    issuedAt: Date.now(),
    command: {
      type: "pcb_add_trace",
      layer: "F.Cu",
      pointsNm: [
        { x: 0, y },
        { x: 4 * MM, y },
      ],
      widthMm: 0.2,
      netId: null,
      netClassId,
      segmentMode: "manhattan-90",
    },
  };
}

/**
 * Eight traces and one off-board drill — a report with content, seeded in NINE
 * dispatches. Seeding is quadratic (every copper command rebuilds the legality
 * context), so this must stay small.
 */
async function seedBoard(sdk: DesignerSDK, designId: string): Promise<string> {
  const netClassId = (await sdk.getPcbProjection(designId))!.board.netClasses[0]!
    .id;
  const hole = await sdk.dispatchCommand(designId, {
    commandId: "b5-sync-hole",
    sessionId: "b5-sync",
    aggregateId: designId,
    baseRevision: null,
    issuedAt: Date.now(),
    command: {
      type: "pcb_add_free_hole",
      centerMm: { x: 24.8, y: 0 },
      drillMm: 1.2,
    },
  });
  expect(hole.ok).toBe(true);
  for (let i = 0; i < 8; i += 1) {
    const result = await sdk.dispatchCommand(
      designId,
      traceEnvelope(designId, `b5-sync-trace-${i}`, i, netClassId),
    );
    expect(result.ok).toBe(true);
  }
  return netClassId;
}

afterAll(async () => {
  setDrcWorkerFactoryForTesting(null);
  setDrcWorkerEntry(null);
  await disposeDrcWorker();
});

const MM = 1_000_000;

/**
 * The live gate resolves clearance through the SAME resolver as batch DRC
 * (rule-semantics contract §9), so these fixtures build one from the fixture
 * board rather than passing net classes and design rules by hand.
 */
/**
 * The ONE legality context the live gate judges against (live-parity contract
 * 07 §2) — the same `buildDrcItems` batch DRC builds, so these live cases and
 * the report read one physical model.
 */
function liveContext(parts: Parameters<typeof projection>[0] = {}) {
  return buildDrcItems(
    projection({ board: board(), netNames: { n1: "A", n2: "B" }, ...parts }),
  );
}

/** A pending run under the cursor, as the route tool would submit it. */
function pendingRun(
  pointsNm: Array<{ x: number; y: number }>,
  opts: { netId?: string | null; layer?: "F.Cu" | "B.Cu"; widthMm?: number } = {},
) {
  return {
    traces: [
      {
        id: "pending:trace:0",
        netId: opts.netId ?? null,
        netClassId: "default",
        layer: opts.layer ?? ("F.Cu" as const),
        widthMm: opts.widthMm ?? 0.2,
        pointsNm,
        segmentMode: "manhattan-45" as const,
      },
    ],
    vias: [],
  };
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
  test("B5-LIVE-ROT-PAD: rotated non-square pad is checked as rotated", () => {
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
    const ctx = liveContext({ placements: parts, padNets: { "U1|1": "n1" } });
    const violations = runLiveDrc({
      ctx,
      pending: pendingRun(
        [
          { x: 5.35 * MM, y: 3 * MM },
          { x: 5.35 * MM, y: 4.3 * MM },
        ],
        { netId: "n2" },
      ),
    });
    expect(blockingViolations(ctx, violations).length).toBeGreaterThan(0);
    expect(violations.some((v) => v.code === "TRACE_TO_PAD_CLEARANCE" || v.code === "NET_SHORT_CIRCUIT")).toBe(true);
  });

  // Fix: P7 (live TH pads span both sides, like the batch context).
  test("B5-LIVE-TH-PAD-SIDE: routing B.Cu sees top-side THT barrels", () => {
    const parts = [
      placement("U1", {
        positionMm: { x: 5, y: 5 },
        layer: "F.Cu",
        pads: [pad("1", { x: 0, y: 0 }, 1.6, 1.6, { drillDiameterMm: 0.8 })],
      }),
    ];
    const ctx = liveContext({ placements: parts, padNets: { "U1|1": "n1" } });
    const violations = runLiveDrc({
      ctx,
      pending: pendingRun(
        [
          { x: 3 * MM, y: 5 * MM },
          { x: 7 * MM, y: 5 * MM },
        ],
        // Opposite side of the placement.
        { netId: "n2", layer: "B.Cu" },
      ),
    });
    expect(blockingViolations(ctx, violations).length).toBeGreaterThan(0);
    expect(violations.some((v) => v.code === "TRACE_TO_PAD_CLEARANCE" || v.code === "NET_SHORT_CIRCUIT")).toBe(true);
  });

  // Closed in S8: pad geometry is not built by the gate at all any more. It
  // lives in the per-projection `LegalityContext`, so a pointer move pays for
  // the pending copper only (live-parity contract 07 §7).
  test("B5-LIVE-PADGEOMS: the gate reads pad geometry, never rebuilds it", () => {
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

    const ctx = liveContext({
      placements: parts,
      padNets: { "U1|1": "n1", "U2|1": "n1" },
    });
    const afterContextBuild = padsAccessCount;
    expect(afterContextBuild).toBeGreaterThan(0);

    // 4 points → 3 pending segments, and three separate pointer moves: not one
    // further read of a footprint's preview.
    for (let i = 0; i < 3; i += 1) {
      runLiveDrc({
        ctx,
        pending: pendingRun(
          [
            { x: 0 * MM, y: i * MM },
            { x: 3 * MM, y: i * MM },
            { x: 6 * MM, y: i * MM },
            { x: 9 * MM, y: i * MM },
          ],
          { netId: "n2" },
        ),
      });
    }

    expect(padsAccessCount).toBe(afterContextBuild);
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

  // Fixed in S10 (execution contract 09): the batch run left the request path.
  test("B5-SYNC: large-board DRC runs off the request path", async () => {
    // Leg (a) — a HELD worker makes the run's middle observable: the board
    // keeps accepting commands while a run is `running`, and only a released
    // run writes a row.
    const workers = await useControlledWorker();
    try {
      isolateTestDb("drc-audit-b5-sync");
      const { moduleRuntime, server } = await createRuntimeAndServer();
      const sdk = moduleRuntime
        .getSdkRegistry()
        .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
      const design = await sdk.createDesign({ name: "B5-SYNC" });
      const netClassId = await seedBoard(sdk, design.id);

      const started = await snapshotFrom(
        await server.fetch(
          new Request(drcUrl(design.id, "/runs"), { method: "POST" }),
        ),
        202,
      );
      expect(typeof started.runId).toBe("string");
      await waitFor(
        () => workers.length === 1 && workers[0]!.received.length === 1,
        "the run to reach the worker",
      );

      // THE regression: dispatch completes while the engine is still working.
      const midRun = await sdk.dispatchCommand(
        design.id,
        traceEnvelope(design.id, "b5-sync-mid-run", 9, netClassId),
      );
      expect(midRun.ok).toBe(true);
      const during = await snapshotFrom(
        await server.fetch(
          new Request(drcUrl(design.id, `/runs/${started.runId}`)),
        ),
      );
      expect(during.status).toBe("running");

      const ranOver = workers[0]!.received[0]!.projection;
      workers[0]!.release();
      await waitForStatus(server, design.id, started.runId, "completed");

      const stored = await storedReport(server, design.id);
      expect(JSON.stringify(stored)).toBe(JSON.stringify(runDrc(ranOver)));

      // A cancelled run leaves that row exactly as it is.
      const second = await snapshotFrom(
        await server.fetch(
          new Request(drcUrl(design.id, "/runs"), { method: "POST" }),
        ),
        202,
      );
      await waitFor(
        () => workers[0]!.received.length === 2,
        "the second run to reach the worker",
      );
      const cancelled = await snapshotFrom(
        await server.fetch(
          new Request(
            drcUrl(design.id, `/runs/${second.runId}/cancel`),
            { method: "POST" },
          ),
        ),
        202,
      );
      expect(cancelled.status).toBe("cancelled");
      workers[0]!.release();
      await sleep(20);
      expect(JSON.stringify(await storedReport(server, design.id))).toBe(
        JSON.stringify(stored),
      );
    } finally {
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }

    // Leg (b) — the same board, the real worker, end to end.
    isolateTestDb("drc-audit-b5-sync-real");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "B5-SYNC-real" });
    await seedBoard(sdk, design.id);

    const started = await snapshotFrom(
      await server.fetch(
        new Request(drcUrl(design.id, "/runs"), { method: "POST" }),
      ),
      202,
    );
    await waitForStatus(server, design.id, started.runId, "completed");
    const projection = (await sdk.getPcbProjection(design.id))!;
    expect(JSON.stringify(await storedReport(server, design.id))).toBe(
      JSON.stringify(runDrc(projection)),
    );
  }, 60_000);
});
