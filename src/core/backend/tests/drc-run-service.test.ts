/**
 * Execution contract 09 §1, §3, §5, §7 — the run service's lifecycle.
 *
 * The worker itself is pinned by `drc-worker-client.test.ts`; what this file
 * owns is everything the service decides ON TOP of it: who joins whom, who
 * supersedes whom, what a waiting caller gets when its run is replaced, when a
 * row is written and — the load-bearing one — when it is NOT (a cancel, a
 * design deleted mid-run). Most cases drive a HELD fake worker so the run's
 * middle is observable rather than a race; one case runs the real worker end
 * to end so the wiring is exercised as shipped.
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
import type { CoreBackendModuleContext } from "../../contracts/modules/backend-module";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { DRC_STAGES, runDrc } from "../../../shared/drc/drc-engine";
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
import { createDesignerStore } from "../../../modules/designer/backend/store";
import {
  DrcRunCancelledError,
  resolveDrcRunService,
  type DrcRunService,
} from "../../../modules/designer/backend/drc/run-service";

const SESSION = "drc-run-service";

// ── the controllable worker ────────────────────────────────────────────────

interface FakeWorkerEvents {
  message: DrcWorkerResponse;
  error: Error;
  exit: number;
}

/**
 * A worker that answers only when the test says so. `release()` runs the real
 * engine in-thread on the request's own projection, so a released run persists
 * exactly the bytes `runDrc` would have produced.
 */
class ControlledWorker implements DrcWorkerLike {
  readonly received: DrcWorkerRequest[] = [];

  terminateCount = 0;

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
    this.terminateCount += 1;
    return Promise.resolve(0);
  }

  emit<K extends keyof FakeWorkerEvents>(
    event: K,
    payload: FakeWorkerEvents[K],
  ): void {
    for (const listener of [...this.listeners[event]]) listener(payload);
  }

  private latest(): DrcWorkerRequest {
    const request = this.received.at(-1);
    if (!request) throw new Error("no run reached the fake worker yet");
    return request;
  }

  /** The report the in-thread engine produces for the held run. */
  reportFor(): DrcReport {
    const request = this.latest();
    return runDrc(request.projection, {
      lookupRawFootprint: lookupFor(request.rawFootprints),
    });
  }

  release(): DrcReport {
    const report = this.reportFor();
    this.emit("message", {
      type: "done",
      runId: this.latest().runId,
      report,
    });
    return report;
  }

  cancelled(): void {
    this.emit("message", { type: "cancelled", runId: this.latest().runId });
  }

  fail(message: string): void {
    this.emit("message", { type: "error", runId: this.latest().runId, message });
  }

  progress(stage: string, index: number, total: number, so_far = 0): void {
    this.emit("message", {
      type: "progress",
      runId: this.latest().runId,
      stage: stage as never,
      index,
      total,
      violationsSoFar: so_far,
    });
  }
}

function lookupFor(
  entries: DrcWorkerRequest["rawFootprints"],
): RawFootprintLookup | undefined {
  if (entries === null) return undefined;
  const byId = new Map(entries);
  return (footprintId: string) => byId.get(footprintId) ?? null;
}

// ── harness ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error(`timed out waiting for ${label}`);
}

interface Harness {
  sdk: DesignerSDK;
  /** The full runtime server: `start()` is what the real-socket leg needs. */
  server: ReturnType<typeof createHttpServer>;
  service: DrcRunService;
  ctx: CoreBackendModuleContext;
}

async function createHarness(label: string): Promise<Harness> {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: path.resolve(import.meta.dir, "../../.."),
  });
  await moduleRuntime.bootstrap();
  const server = createHttpServer({
    // Ephemeral: the real-socket leg calls `start()`, and the default 3000 is
    // whatever else is running on this machine (the e2e web server, `dev`).
    port: 0,
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  const sdk = moduleRuntime
    .getSdkRegistry()
    .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  // The designer's own module context, so the test resolves the SAME service
  // instance the routes and the SDK share (there is no public accessor).
  const ctx = (
    moduleRuntime as unknown as {
      loaded: Map<string, { context: CoreBackendModuleContext }>;
    }
  ).loaded.get("designer")!.context;
  const service = resolveDrcRunService(ctx, createDesignerStore(ctx));
  return { sdk, server, service, ctx };
}

/** Installs the controllable transport; the worker respawns per spawn. */
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

function url(designId: string, suffix = ""): string {
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

function envelope(
  designId: string,
  commandId: string,
  command: DesignerCommandEnvelope["command"],
): DesignerCommandEnvelope {
  return {
    commandId,
    sessionId: SESSION,
    aggregateId: designId,
    baseRevision: null,
    issuedAt: Date.now(),
    command,
  };
}

/**
 * A handful of copper primitives — enough to make a report, cheap to seed.
 * Traces are 1.5 mm apart: the commit gate refuses anything closer than the
 * default 0.25 mm clearance, and seeding must not fight it. The off-board
 * drill guarantees the report is non-empty.
 */
async function seedCopper(
  sdk: DesignerSDK,
  designId: string,
  count = 4,
): Promise<void> {
  const projection = (await sdk.getPcbProjection(designId))!;
  const netClassId = projection.board.netClasses[0]!.id;
  const seeded = projection.freeHoles?.length ?? 0;
  if (seeded === 0) {
    const hole = await sdk.dispatchCommand(
      designId,
      envelope(designId, `seed-hole-${designId}`, {
        type: "pcb_add_free_hole",
        centerMm: { x: 24.8, y: 0 },
        drillMm: 1.2,
      }),
    );
    expect(hole.ok).toBe(true);
  }
  const offset = projection.traces.length;
  for (let i = 0; i < count; i += 1) {
    const y = Math.round((offset + i) * 1.5 * 1_000_000);
    const result = await sdk.dispatchCommand(
      designId,
      envelope(designId, `seed-trace-${designId}-${offset + i}`, {
        type: "pcb_add_trace",
        layer: "F.Cu",
        pointsNm: [
          { x: 0, y },
          { x: 4_000_000, y },
        ],
        widthMm: 0.2,
        netId: null,
        netClassId,
        segmentMode: "manhattan-90",
      }),
    );
    expect(result.ok).toBe(true);
  }
}

afterAll(async () => {
  setDrcWorkerFactoryForTesting(null);
  setDrcWorkerEntry(null);
  await disposeDrcWorker();
});

// ── join / supersede / FIFO ────────────────────────────────────────────────

describe("DrcRunService — joining and superseding", () => {
  test("a second start over the same revision and options joins the run", async () => {
    const workers = await useControlledWorker();
    try {
      const { sdk, server } = await createHarness("drc-run-join");
      const design = await sdk.createDesign({ name: "join" });
      await seedCopper(sdk, design.id);

      const first = await snapshotFrom(
        await server.fetch(
          new Request(url(design.id, "/runs"), { method: "POST" }),
        ),
        202,
      );
      await waitFor(
        () => workers.length === 1 && workers[0]!.received.length === 1,
        "the first run to reach the worker",
      );
      const second = await snapshotFrom(
        await server.fetch(
          new Request(url(design.id, "/runs"), { method: "POST" }),
        ),
        202,
      );

      expect(second.runId).toBe(first.runId);
      // The join never queues a second engine run.
      expect(workers[0]!.received.length).toBe(1);

      workers[0]!.release();
      await waitFor(
        () => workers[0]!.received.length === 1,
        "the run to settle",
      );
    } finally {
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }
  }, 20_000);

  test("a waiver change supersedes the run and its waiter gets the NEW report", async () => {
    const workers = await useControlledWorker();
    try {
      const { sdk, service } = await createHarness("drc-run-supersede");
      const design = await sdk.createDesign({ name: "supersede" });
      await seedCopper(sdk, design.id);

      const first = await service.start(design.id);
      const waiter = service.runAndWait(design.id);
      await waitFor(
        () => workers.length === 1 && workers[0]!.received.length === 1,
        "the first run to reach the worker",
      );

      // A view-state waiver bumps the revision, so the next start cannot join.
      const seed = workers[0]!.reportFor();
      expect(seed.violations.length).toBeGreaterThan(0);
      const waived = seed.violations[0]!.id;
      const applied = await sdk.dispatchCommand(
        design.id,
        envelope(design.id, "waive-1", {
          type: "pcb_set_view_state",
          patch: { drcWaivedViolationIds: [waived] },
        }),
      );
      expect(applied.ok).toBe(true);

      const second = await service.start(design.id);
      expect(second.runId).not.toBe(first.runId);
      const superseded = service.get(first.runId)!;
      expect(superseded.status).toBe("cancelled");
      expect(superseded.cancelReason).toBe("superseded");

      // The engine acknowledges the cancel; the executor then runs the new one.
      workers[0]!.cancelled();
      await waitFor(
        () => workers[0]!.received.length === 2,
        "the superseding run to reach the worker",
      );
      const newReport = workers[0]!.release();

      // The waiter attached to the FIRST run resolves with the SECOND's report.
      const report = await waiter;
      expect(JSON.stringify(report)).toBe(JSON.stringify(newReport));
      expect(report.revision).toBe(second.revision);
      expect(second.revision).toBeGreaterThan(first.revision);
    } finally {
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }
  }, 20_000);

  test("runs of two designs execute FIFO, one at a time", async () => {
    const workers = await useControlledWorker();
    try {
      const { sdk, service } = await createHarness("drc-run-fifo");
      const a = await sdk.createDesign({ name: "fifo-a" });
      const b = await sdk.createDesign({ name: "fifo-b" });
      await seedCopper(sdk, a.id, 3);
      await seedCopper(sdk, b.id, 3);

      const runA = await service.start(a.id);
      const runB = await service.start(b.id);
      await waitFor(
        () => workers.length === 1 && workers[0]!.received.length === 1,
        "design A's run to reach the worker",
      );

      expect(service.get(runA.runId)!.status).toBe("running");
      expect(service.get(runB.runId)!.status).toBe("queued");

      workers[0]!.release();
      await waitFor(
        () => service.get(runB.runId)!.status === "running",
        "design B's run to start once A finished",
      );
      expect(service.get(runA.runId)!.status).toBe("completed");
      expect(workers[0]!.received.length).toBe(2);
      workers[0]!.release();
      await waitFor(
        () => service.get(runB.runId)!.status === "completed",
        "design B's run to complete",
      );
    } finally {
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }
  }, 20_000);
});

// ── nothing partial, nothing orphaned ──────────────────────────────────────

describe("DrcRunService — persistence boundaries", () => {
  test("a cancelled run leaves the previously stored report untouched", async () => {
    const workers = await useControlledWorker();
    try {
      const { sdk, server, service } = await createHarness("drc-run-cancel");
      const design = await sdk.createDesign({ name: "cancel" });
      await seedCopper(sdk, design.id, 3);

      // A first, completed run gives us a row to protect.
      const first = await service.start(design.id);
      await waitFor(
        () => workers.length === 1 && workers[0]!.received.length === 1,
        "the first run to reach the worker",
      );
      workers[0]!.release();
      await waitFor(
        () => service.get(first.runId)!.status === "completed",
        "the first run to complete",
      );
      const stored = (await (
        await server.fetch(new Request(url(design.id)))
      ).json()) as { data: { report: DrcReport | null } };
      expect(stored.data.report).not.toBeNull();

      // Move the board so a second run would store something different.
      await seedCopper(sdk, design.id, 2);
      const second = await service.start(design.id);
      await waitFor(
        () => workers[0]!.received.length === 2,
        "the second run to reach the worker",
      );

      const cancelled = await snapshotFrom(
        await server.fetch(
          new Request(url(design.id, `/runs/${second.runId}/cancel`), {
            method: "POST",
          }),
        ),
        202,
      );
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.cancelReason).toBe("user");

      // Even a worker that answers `done` after the cancel writes nothing.
      workers[0]!.release();
      await sleep(20);
      const after = (await (
        await server.fetch(new Request(url(design.id)))
      ).json()) as { data: { report: DrcReport | null } };
      expect(JSON.stringify(after.data.report)).toBe(
        JSON.stringify(stored.data.report),
      );
      expect(service.get(second.runId)!.status).toBe("cancelled");
    } finally {
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }
  }, 20_000);

  test("a design deleted mid-run ends cancelled, writes no row, rejects cleanly", async () => {
    const rejections: unknown[] = [];
    const sentinel = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", sentinel);
    const workers = await useControlledWorker();
    try {
      const { sdk, server, service, ctx } = await createHarness("drc-run-deleted");
      const design = await sdk.createDesign({ name: "deleted" });
      await seedCopper(sdk, design.id, 3);

      const run = await service.start(design.id);
      // The outcome is captured NOW: a waiter that only attaches its handler
      // after the rejection would itself be the unhandled rejection.
      const waiter = service
        .runAndWait(design.id)
        .then(() => null, (error: unknown) => error);
      await waitFor(
        () => workers.length === 1 && workers[0]!.received.length === 1,
        "the run to reach the worker",
      );

      const deleted = await server.fetch(
        new Request(`http://localhost/api/modules/designer/designs/${design.id}`, {
          method: "DELETE",
        }),
      );
      expect(deleted.status).toBe(204);

      workers[0]!.release();
      await waitFor(
        () => service.get(run.runId)!.status === "cancelled",
        "the run to end cancelled",
      );
      expect(service.get(run.runId)!.cancelReason).toBe("design-deleted");
      // Not "failed": no write was attempted, so no FK breach happened.
      const rows = ctx.db.rawSql<{ n: number }>(
        "select count(*) as n from designer_drc_results where design_id = ?",
        [design.id],
      );
      expect(rows[0]!.n).toBe(0);

      expect(String(await waiter)).toContain("design-deleted");
      await sleep(50);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", sentinel);
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }
  }, 20_000);

  test("a worker error fails the run and stores nothing", async () => {
    const workers = await useControlledWorker();
    try {
      const { sdk, server, service } = await createHarness("drc-run-failed");
      const design = await sdk.createDesign({ name: "failed" });
      await seedCopper(sdk, design.id, 3);

      const run = await service.start(design.id);
      await waitFor(
        () => workers.length === 1 && workers[0]!.received.length === 1,
        "the run to reach the worker",
      );
      workers[0]!.fail("check exploded");
      await waitFor(
        () => service.get(run.runId)!.status === "failed",
        "the run to fail",
      );
      expect(service.get(run.runId)!.error).toBe("check exploded");
      const stored = (await (
        await server.fetch(new Request(url(design.id)))
      ).json()) as { data: { report: DrcReport | null } };
      expect(stored.data.report).toBeNull();
    } finally {
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }
  }, 20_000);
});

// ── the SSE surface ────────────────────────────────────────────────────────

describe("DrcRunService — the run stream", () => {
  test("a late connect replays the terminal state and closes", async () => {
    const workers = await useControlledWorker();
    try {
      const { sdk, server, service } = await createHarness("drc-run-sse-late");
      const design = await sdk.createDesign({ name: "sse-late" });
      await seedCopper(sdk, design.id, 3);

      const run = await service.start(design.id);
      await waitFor(
        () => workers.length === 1 && workers[0]!.received.length === 1,
        "the run to reach the worker",
      );
      workers[0]!.release();
      await waitFor(
        () => service.get(run.runId)!.status === "completed",
        "the run to complete",
      );

      const response = await server.fetch(
        new Request(url(design.id, `/runs/${run.runId}/stream`)),
      );
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      // The stream closes on its own — this read terminates.
      const body = await response.text();
      expect(body).toContain("event: run.state");
      expect(body).toContain("event: run.completed");
      expect(body).toContain('"errors"');
      expect(service.listenerCount(run.runId)).toBe(0);
    } finally {
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }
  }, 20_000);

  test("a disconnect unsubscribes without cancelling the run", async () => {
    const workers = await useControlledWorker();
    try {
      const { sdk, server, service } = await createHarness("drc-run-sse-drop");
      const design = await sdk.createDesign({ name: "sse-drop" });
      await seedCopper(sdk, design.id, 3);

      const run = await service.start(design.id);
      await waitFor(
        () => workers.length === 1 && workers[0]!.received.length === 1,
        "the run to reach the worker",
      );

      const controller = new AbortController();
      const response = await server.fetch(
        new Request(url(design.id, `/runs/${run.runId}/stream`), {
          signal: controller.signal,
        }),
      );
      const reader = response.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain("event: run.state");
      expect(service.listenerCount(run.runId)).toBe(1);

      controller.abort();
      await waitFor(
        () => service.listenerCount(run.runId) === 0,
        "the stream to unsubscribe",
      );
      // A dropped stream is not a cancel (§5).
      expect(service.get(run.runId)!.status).toBe("running");
      await reader.cancel().catch(() => {});

      workers[0]!.release();
      await waitFor(
        () => service.get(run.runId)!.status === "completed",
        "the run to complete regardless",
      );
    } finally {
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }
  }, 20_000);

  test("progress frames carry a stage fraction the panel can draw", async () => {
    const workers = await useControlledWorker();
    try {
      const { sdk, service } = await createHarness("drc-run-progress");
      const design = await sdk.createDesign({ name: "progress" });
      await seedCopper(sdk, design.id, 3);

      const run = await service.start(design.id);
      await waitFor(
        () => workers.length === 1 && workers[0]!.received.length === 1,
        "the run to reach the worker",
      );
      const seen: DrcRunSnapshot[] = [];
      service.subscribe(run.runId, (snapshot) => seen.push(snapshot));

      // The stage count is `DRC_STAGES.length`, not a literal: the run service
      // divides a POUR frame by it, so a session that adds a stage must not
      // have to re-derive this expectation by hand.
      const stages = DRC_STAGES.length;
      workers[0]!.progress("clearance", 7, stages, 3);
      // A pour frame reports zones; it must stay inside the stage that asked.
      workers[0]!.progress("pour", 1, 4, 5);
      await waitFor(() => seen.length >= 2, "two progress frames");

      expect(seen[0]!.progress.stage).toBe("clearance");
      expect(seen[0]!.progress.fraction).toBeCloseTo(7 / stages, 6);
      expect(seen[1]!.progress.stage).toBe("pour");
      expect(seen[1]!.progress.fraction).toBeCloseTo((7 + 1 / 4) / stages, 6);
      expect(seen[1]!.progress.violationsSoFar).toBe(5);

      workers[0]!.release();
      await waitFor(
        () => service.get(run.runId)!.status === "completed",
        "the run to complete",
      );
    } finally {
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }
  }, 20_000);
});

// ── shutdown ───────────────────────────────────────────────────────────────

describe("DrcRunService — shutdown", () => {
  test("a start racing dispose rejects `shutdown` and queues nothing", async () => {
    const workers = await useControlledWorker();
    try {
      const { sdk, service } = await createHarness("drc-run-dispose-race");
      const design = await sdk.createDesign({ name: "dispose-race" });
      await seedCopper(sdk, design.id, 2);

      // Same tick: `dispose()` lands while `start` is awaiting the projection
      // load. A run created after that point would sit `queued` forever,
      // because `pump()` no-ops on a disposed service.
      const racing = service
        .start(design.id)
        .then(() => null, (error: unknown) => error);
      service.dispose();
      const error = await racing;
      expect(error).toBeInstanceOf(DrcRunCancelledError);
      expect((error as DrcRunCancelledError).reason).toBe("shutdown");
      // Nothing reached the worker, so nothing was left queued behind it.
      expect(workers.length).toBe(0);

      // A disposed service keeps refusing rather than hanging.
      const again = await service
        .start(design.id)
        .then(() => null, (e: unknown) => e);
      expect(again).toBeInstanceOf(DrcRunCancelledError);

      // And a fresh module context still runs: dispose is per service, and the
      // registry is keyed on `ctx.db`, not process-wide.
      const next = await createHarness("drc-run-dispose-race-next");
      const fresh = await next.sdk.createDesign({ name: "after-dispose" });
      await seedCopper(next.sdk, fresh.id, 2);
      const started = await snapshotFrom(
        await next.server.fetch(
          new Request(url(fresh.id, "/runs"), { method: "POST" }),
        ),
        202,
      );
      expect(["queued", "running"]).toContain(started.status);
      await waitFor(
        () => workers.length === 1 && workers[0]!.received.length === 1,
        "the fresh service's run to reach the worker",
      );
      workers[0]!.release();
      await waitFor(
        () => next.service.get(started.runId)!.status === "completed",
        "the fresh service's run to complete",
      );
    } finally {
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }
  }, 20_000);

  test("POST /drc/runs on a disposed service is a 409 problem, not a 500", async () => {
    const workers = await useControlledWorker();
    try {
      const { sdk, server, service } = await createHarness("drc-run-dispose-route");
      const design = await sdk.createDesign({ name: "dispose-route" });
      await seedCopper(sdk, design.id, 2);
      service.dispose();

      const response = await server.fetch(
        new Request(url(design.id, "/runs"), { method: "POST" }),
      );
      expect(response.status).toBe(409);
      expect(response.headers.get("content-type")).toContain(
        "application/problem+json",
      );
      const problem = (await response.json()) as { type?: string };
      expect(problem.type).toBe(
        "https://openpcb.dev/problems/drc-run-cancelled",
      );
      expect(workers.length).toBe(0);
    } finally {
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }
  }, 20_000);

  test("the SDK answers null when the run it joined is cancelled", async () => {
    const workers = await useControlledWorker();
    try {
      const { sdk, server, service } = await createHarness("drc-run-sdk-cancel");
      const design = await sdk.createDesign({ name: "sdk-cancel" });
      await seedCopper(sdk, design.id, 3);

      // The assistant / MCP read. It must not throw at its caller when the
      // user cancels the run it happened to join (09 §7).
      const pending = sdk.runDrc(design.id);
      await waitFor(
        () => workers.length === 1 && workers[0]!.received.length === 1,
        "the SDK's run to reach the worker",
      );
      // Same revision and options: this JOINS the SDK's run and names it.
      const joined = await service.start(design.id);
      const cancelled = await snapshotFrom(
        await server.fetch(
          new Request(url(design.id, `/runs/${joined.runId}/cancel`), {
            method: "POST",
          }),
        ),
        202,
      );
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.cancelReason).toBe("user");
      expect(await pending).toBeNull();
    } finally {
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }
  }, 20_000);
});

// ── the stream over a real socket ──────────────────────────────────────────

describe("DrcRunService — the run stream over a real socket", () => {
  test("a client disconnect unsubscribes without cancelling the run", async () => {
    const workers = await useControlledWorker();
    const { sdk, server, service } = await createHarness("drc-run-sse-socket");
    const listening = await server.start();
    try {
      const design = await sdk.createDesign({ name: "sse-socket" });
      await seedCopper(sdk, design.id, 3);
      const run = await service.start(design.id);
      await waitFor(
        () => workers.length === 1 && workers[0]!.received.length === 1,
        "the run to reach the worker",
      );

      // Through node:http this time: `server.fetch` never touches the socket
      // layer, so only this leg exercises the response-`close` abort wiring.
      const base = `http://127.0.0.1:${listening.port}/api/modules/designer/designs/${design.id}/drc`;
      const controller = new AbortController();
      const response = await fetch(`${base}/runs/${run.runId}/stream`, {
        signal: controller.signal,
      });
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const reader = response.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain(
        "event: run.state",
      );
      expect(service.listenerCount(run.runId)).toBe(1);

      controller.abort();
      await waitFor(
        () => service.listenerCount(run.runId) === 0,
        "the socket disconnect to unsubscribe",
      );
      // A dropped stream is not a cancel (§5).
      expect(service.get(run.runId)!.status).toBe("running");

      workers[0]!.release();
      await waitFor(
        () => service.get(run.runId)!.status === "completed",
        "the run to complete regardless",
      );
    } finally {
      await listening.close();
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }
  }, 20_000);
});

// ── the legacy entry point, on the real worker ─────────────────────────────

describe("DrcRunService — the legacy /drc/run entry point", () => {
  test("the route's report is the SDK's, both through the real worker", async () => {
    await disposeDrcWorker();
    setDrcWorkerFactoryForTesting(null);
    try {
      const { sdk, server } = await createHarness("drc-run-legacy");
      const design = await sdk.createDesign({ name: "legacy" });
      await seedCopper(sdk, design.id, 4);

      const response = await server.fetch(
        new Request(url(design.id, "/run"), { method: "POST" }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: { report: DrcReport } };
      const viaSdk = await sdk.runDrc(design.id);
      expect(viaSdk).toEqual(body.data.report);

      // And the stored row is what a fresh in-thread run would produce.
      const projection = (await sdk.getPcbProjection(design.id))!;
      const stored = (await (
        await server.fetch(new Request(url(design.id)))
      ).json()) as { data: { report: DrcReport } };
      expect(JSON.stringify(stored.data.report)).toBe(
        JSON.stringify(runDrc(projection)),
      );
    } finally {
      await disposeDrcWorker();
    }
  }, 60_000);

  test("the SDK still answers null for a design that does not exist", async () => {
    await disposeDrcWorker();
    setDrcWorkerFactoryForTesting(null);
    const { sdk } = await createHarness("drc-run-missing");
    expect(await sdk.runDrc("no-such-design")).toBeNull();
  });
});
