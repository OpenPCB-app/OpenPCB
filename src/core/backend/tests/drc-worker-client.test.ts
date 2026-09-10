/**
 * Execution contract 09 §2, §3, §6, §8 — the DRC worker and its main-thread
 * owner.
 *
 * The load-bearing assertion is byte identity: the worker runs the unchanged
 * engine on a structured clone, so its report must stringify to exactly what
 * the in-thread `runDrc` produces for the same `(projection, lookup)`. The
 * rest pins the lifecycle the service (WP4) relies on — FIFO, cooperative
 * cancel, the terminate fallback, crash recovery, spawn failure — and that a
 * dense board no longer blocks the main loop.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import type { DesignerPcbProjection, DrcReport } from "../../../sdks/designer";
import { buildDrcItems } from "../../../shared/drc/drc-context";
import { DRC_STAGES, runDrc } from "../../../shared/drc/drc-engine";
import { DrcCancelledError } from "../../../shared/drc/types";
import type { RawFootprintLookup } from "../../../shared/pcb-geometry/courtyard";
import {
  disposeDrcWorker,
  runDrcOnWorker,
  setDrcWorkerEntry,
  setDrcWorkerFactoryForTesting,
  type DrcWorkerFactory,
  type DrcWorkerLike,
  type DrcWorkerProgress,
} from "../../../shared/drc/worker/drc-worker-client";
import {
  CANCEL_GRACE_MS,
  type DrcWorkerRequest,
  type DrcWorkerResponse,
} from "../../../shared/drc/worker/protocol";
import { buildFixture } from "./helpers/drc-determinism-fixture";
import { fixtureToProjection } from "./helpers/drc-golden";
import { SYNTHETIC_CORPUS, synthesizeBoard } from "./helpers/drc-synthetic";

const GOLDEN_DIR = path.resolve(import.meta.dir, "fixtures/drc/golden");

const goldens = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".expected.json"))
  .sort()
  .map((file) => ({
    name: file.replace(/\.json$/, ""),
    projection: fixtureToProjection(
      JSON.parse(readFileSync(path.join(GOLDEN_DIR, file), "utf8")),
    ),
  }));

type RawFootprintEntries = Array<[string, Record<string, unknown>]> | null;

/** The lookup the worker rebuilds from the same entries (contract §2.2). */
function lookupFor(entries: RawFootprintEntries): RawFootprintLookup | undefined {
  if (entries === null) return undefined;
  const byId = new Map(entries);
  return (footprintId: string) => byId.get(footprintId) ?? null;
}

async function expectBytesEqual(
  label: string,
  projection: DesignerPcbProjection,
  rawFootprints: RawFootprintEntries,
): Promise<void> {
  const onWorker: DrcReport = await runDrcOnWorker({
    projection,
    rawFootprints,
  });
  const inThread = runDrc(projection, {
    lookupRawFootprint: lookupFor(rawFootprints),
  });
  expect(`${label}: ${JSON.stringify(onWorker)}`).toBe(
    `${label}: ${JSON.stringify(inThread)}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `ready` on the macrotask queue so worker messages can interleave. */
async function waitFor(ready: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (ready()) return;
    await sleep(5);
  }
  throw new Error(`timed out waiting for ${label}`);
}

type RunOutcome = { ok: true } | { ok: false; error: unknown };

/**
 * Bun 1.4's `expect(promise).rejects` deadlocks when it is stored and awaited
 * later, which the lifecycle tests must do (they act on the client between
 * starting a run and its rejection), so they capture the reason directly.
 */
function outcomeOf(promise: Promise<unknown>): Promise<RunOutcome> {
  return promise.then<RunOutcome, RunOutcome>(
    () => ({ ok: true }),
    (error: unknown) => ({ ok: false, error }),
  );
}

/**
 * A worker that is never a real thread: the lifecycle tests need one that
 * stalls (never answers a `run`) or crashes on demand.
 */
interface FakeWorkerEvents {
  message: DrcWorkerResponse;
  error: Error;
  exit: number;
}

class FakeWorker implements DrcWorkerLike {
  readonly received: DrcWorkerRequest[] = [];
  terminateCount = 0;
  private readonly listeners: {
    [K in keyof FakeWorkerEvents]: Array<(payload: FakeWorkerEvents[K]) => void>;
  } = { message: [], error: [], exit: [] };

  constructor(private readonly onRun: (worker: FakeWorker) => void) {
    // Ready lands on a later turn, exactly as a real spawn does.
    setTimeout(() => this.emit("message", { type: "ready" }), 0);
  }

  postMessage(message: DrcWorkerRequest): void {
    this.received.push(message);
    this.onRun(this);
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
}

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

afterAll(async () => {
  setDrcWorkerFactoryForTesting(null);
  setDrcWorkerEntry(null);
  await disposeDrcWorker();
});

describe("runDrcOnWorker — byte identity", () => {
  test("every golden matches the in-thread report", async () => {
    expect(goldens.length).toBeGreaterThanOrEqual(6);
    for (const { name, projection } of goldens) {
      await expectBytesEqual(name, projection, null);
    }
  });

  test("the determinism fixture and three corpus boards match", async () => {
    await expectBytesEqual("determinism-fixture", buildFixture(), null);
    for (const entry of SYNTHETIC_CORPUS.slice(0, 3)) {
      await expectBytesEqual(entry.name, synthesizeBoard(entry.opts), null);
    }
  });

  test("an absent, an empty and a populated raw-footprint map all match", async () => {
    const census = goldens.find((g) => g.name === "golden-census-2l");
    expect(census).toBeDefined();
    await expectBytesEqual("raw-null", census!.projection, null);
    await expectBytesEqual("raw-empty", census!.projection, []);
    // A map that actually crosses the clone boundary; the census footprints
    // carry no courtyard, so the report is the same either way.
    await expectBytesEqual("raw-populated", census!.projection, [
      ["fp", { layer: "F.Cu" }],
    ]);
  });
});

describe("runDrcOnWorker — progress", () => {
  test("stage frames walk DRC_STAGES in order, once each", async () => {
    const census = goldens.find((g) => g.name === "golden-census-2l")!;
    const frames: DrcWorkerProgress[] = [];
    await runDrcOnWorker(
      { projection: census.projection, rawFootprints: null },
      { onProgress: (frame) => frames.push(frame) },
    );
    const stages = frames.filter((f) => f.stage !== "pour");
    expect(stages.map((f) => f.stage)).toEqual(
      DRC_STAGES.map(([stage]) => stage),
    );
    expect(stages.map((f) => f.index)).toEqual(
      DRC_STAGES.map((_, index) => index),
    );
    expect(stages.every((f) => f.total === DRC_STAGES.length)).toBe(true);
    expect(stages[0]!.stage).toBe(DRC_STAGES[0]![0]);
    expect(stages.at(-1)!.stage).toBe(DRC_STAGES.at(-1)![0]);
    let seen = -1;
    for (const frame of stages) {
      expect(frame.violationsSoFar).toBeGreaterThanOrEqual(seen);
      seen = frame.violationsSoFar;
    }
  });

  test("a pour-bearing golden reports the first and last zone", async () => {
    const pours = goldens.find((g) => g.name === "golden-pours-2l")!;
    const zones = buildDrcItems(pours.projection).copperZones.length;
    expect(zones).toBeGreaterThanOrEqual(2);
    const frames: DrcWorkerProgress[] = [];
    await runDrcOnWorker(
      { projection: pours.projection, rawFootprints: null },
      { onProgress: (frame) => frames.push(frame) },
    );
    const pourFrames = frames.filter((f) => f.stage === "pour");
    // PROGRESS_MIN_MS throttles the middle of a fast pour; the first and the
    // last tick of a stage always post (contract §2), so those two are the
    // guarantee — indices in between are timing-dependent.
    expect(pourFrames.length).toBeGreaterThanOrEqual(2);
    expect(pourFrames[0]!.index).toBe(0);
    expect(pourFrames.at(-1)!.index).toBe(zones - 1);
    expect(pourFrames.every((f) => f.total === zones)).toBe(true);
    let previous = -1;
    for (const frame of pourFrames) {
      expect(frame.index).toBeGreaterThan(previous);
      previous = frame.index;
    }
  });
});

describe("runDrcOnWorker — cancellation", () => {
  test("an abort mid-run cancels cooperatively and reuses the worker", async () => {
    await disposeDrcWorker();
    let spawns = 0;
    const counting: DrcWorkerFactory = (entry) => {
      spawns += 1;
      return new Worker(entry);
    };
    setDrcWorkerFactoryForTesting(counting);
    try {
      const dense = synthesizeBoard({ seed: 1, items: 10000 });
      const controller = new AbortController();
      const cancelled = runDrcOnWorker(
        { projection: dense, rawFootprints: null },
        {
          signal: controller.signal,
          onProgress: () => controller.abort(),
        },
      );
      await expect(cancelled).rejects.toBeInstanceOf(DrcCancelledError);

      // The worker caught the throw and stayed alive for the next run.
      const census = goldens.find((g) => g.name === "golden-census-2l")!;
      const report = await runDrcOnWorker({
        projection: census.projection,
        rawFootprints: null,
      });
      expect(JSON.stringify(report)).toBe(
        JSON.stringify(runDrc(census.projection)),
      );
      expect(spawns).toBe(1);
    } finally {
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }
  }, 60_000);

  test("a stalled worker is terminated after the grace window and respawned", async () => {
    await disposeDrcWorker();
    const workers: FakeWorker[] = [];
    setDrcWorkerFactoryForTesting(() => {
      // Deliberately answers nothing — the runaway-kernel case.
      const worker = new FakeWorker(() => {});
      workers.push(worker);
      return worker;
    });
    try {
      const census = goldens.find((g) => g.name === "golden-census-2l")!;
      const controller = new AbortController();
      const stalled = outcomeOf(
        runDrcOnWorker(
          { projection: census.projection, rawFootprints: null },
          { signal: controller.signal },
        ),
      );
      await waitFor(
        () => workers.length === 1 && workers[0]!.received.length === 1,
        "the run to reach the fake worker",
      );
      controller.abort();
      // Cooperative first: nothing is terminated inside the grace window.
      await sleep(CANCEL_GRACE_MS / 2);
      expect(workers[0]!.terminateCount).toBe(0);

      const stalledResult = await stalled;
      expect(stalledResult.ok).toBe(false);
      if (!stalledResult.ok) {
        expect(stalledResult.error).toBeInstanceOf(DrcCancelledError);
      }
      expect(workers[0]!.terminateCount).toBe(1);

      // The next run spawns a fresh worker rather than reusing the dead one.
      const next = outcomeOf(
        runDrcOnWorker({ projection: census.projection, rawFootprints: null }),
      );
      expect(workers.length).toBe(2);
      await disposeDrcWorker();
      const nextResult = await next;
      expect(nextResult.ok).toBe(false);
      if (!nextResult.ok) {
        expect(nextResult.error).toBeInstanceOf(DrcCancelledError);
      }
    } finally {
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }
  });
});

describe("runDrcOnWorker — failures", () => {
  test("a worker that crashes mid-run fails the run; the next one works", async () => {
    await disposeDrcWorker();
    setDrcWorkerFactoryForTesting(
      () =>
        new FakeWorker((worker) => {
          worker.emit("error", new Error("worker exploded"));
        }),
    );
    const census = goldens.find((g) => g.name === "golden-census-2l")!;
    try {
      await expect(
        runDrcOnWorker({ projection: census.projection, rawFootprints: null }),
      ).rejects.toThrow(/worker exploded/);
    } finally {
      setDrcWorkerFactoryForTesting(null);
    }

    const report = await runDrcOnWorker({
      projection: census.projection,
      rawFootprints: null,
    });
    expect(JSON.stringify(report)).toBe(
      JSON.stringify(runDrc(census.projection)),
    );
    await disposeDrcWorker();
  });

  test("a spawn failure names the entry path", async () => {
    await disposeDrcWorker();
    const missing = "/nonexistent/drc-worker.js";
    setDrcWorkerEntry(missing);
    try {
      const census = goldens.find((g) => g.name === "golden-census-2l")!;
      await expect(
        runDrcOnWorker({ projection: census.projection, rawFootprints: null }),
      ).rejects.toThrow(missing);
    } finally {
      setDrcWorkerEntry(null);
      await disposeDrcWorker();
    }
  });
});

describe("runDrcOnWorker — loop freedom", () => {
  test("timers, an HTTP request and progress all land while a 10k board runs", async () => {
    isolateTestDb("drc-worker-loop");
    const { server } = await createRuntimeAndServer();
    const dense = synthesizeBoard({ seed: 1, items: 10000 });

    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 10);
    let healthStatus = 0;
    let firstProgress: DrcWorkerProgress | null = null;
    const stagesSeen = new Set<string>();

    // Everything is sampled at the instant the run settles, so the assertions
    // cannot be satisfied by work that only happened afterwards.
    const atResolve = { sampled: false, ticks: 0, health: 0, progress: false };
    const run = runDrcOnWorker(
      { projection: dense, rawFootprints: null },
      {
        onProgress: (frame) => {
          firstProgress ??= frame;
          stagesSeen.add(frame.stage);
        },
      },
    ).then((report) => {
      atResolve.sampled = true;
      atResolve.ticks = ticks;
      atResolve.health = healthStatus;
      atResolve.progress = stagesSeen.size >= 2;
      return report;
    });

    const health = await server.fetch(
      new Request("http://localhost/api/health"),
    );
    healthStatus = health.status;

    const report = await run;
    clearInterval(timer);

    expect(atResolve.sampled).toBe(true);
    expect(atResolve.ticks).toBeGreaterThanOrEqual(5);
    expect(atResolve.health).toBe(200);
    expect(atResolve.progress).toBe(true);
    expect(report.designId).toBe(dense.designId);
    await disposeDrcWorker();
  }, 60_000);
});
