/**
 * Main-thread owner of the single DRC worker (execution contract 09 §2, §3).
 *
 * A module singleton: one persistent worker per backend process, spawned
 * lazily on the first run, runs serialised FIFO, respawned after a crash or a
 * hard cancel. Cancellation is cooperative first (a shared flag the engine's
 * `tick` reads) and hard second (`terminate()` after `CANCEL_GRACE_MS`), which
 * is the only way to stop a runaway pour zone.
 *
 * Every promise this module hands out settles exactly once, inside this
 * module — nothing may surface as an unhandled rejection in Electron's main
 * process (§3).
 */
import { Worker } from "node:worker_threads";
import type { DesignerPcbProjection, DrcReport } from "../../../sdks/designer";
import { DrcCancelledError, type DrcStage } from "../types";
import {
  CANCEL_GRACE_MS,
  type DrcWorkerRequest,
  type DrcWorkerResponse,
} from "./protocol";

/** Spawn budget: a worker that has not posted `ready` by then is unusable. */
const SPAWN_TIMEOUT_MS = 10_000;

export interface DrcWorkerProgress {
  stage: DrcStage;
  index: number;
  total: number;
  violationsSoFar: number;
}

export interface DrcWorkerRunInput {
  projection: DesignerPcbProjection;
  /** `null` reproduces "no lookup" in the worker exactly (contract §2.2). */
  rawFootprints: Array<[string, Record<string, unknown>]> | null;
}

export interface DrcWorkerRunOptions {
  signal?: AbortSignal;
  onProgress?: (progress: DrcWorkerProgress) => void;
}

type DrcWorkerMessageListener = (message: DrcWorkerResponse) => void;
type DrcWorkerErrorListener = (error: Error) => void;
type DrcWorkerExitListener = (exitCode: number) => void;

/** The subset of `node:worker_threads`' `Worker` this client uses. */
export interface DrcWorkerLike {
  postMessage(message: DrcWorkerRequest): void;
  on(event: "message", listener: DrcWorkerMessageListener): unknown;
  on(event: "error", listener: DrcWorkerErrorListener): unknown;
  on(event: "exit", listener: DrcWorkerExitListener): unknown;
  off(event: "message", listener: DrcWorkerMessageListener): unknown;
  off(event: "error", listener: DrcWorkerErrorListener): unknown;
  off(event: "exit", listener: DrcWorkerExitListener): unknown;
  terminate(): unknown;
}

export type DrcWorkerFactory = (entry: URL | string) => DrcWorkerLike;

interface QueuedRun {
  readonly input: DrcWorkerRunInput;
  readonly onProgress: ((progress: DrcWorkerProgress) => void) | undefined;
  readonly resolve: (report: DrcReport) => void;
  readonly reject: (error: Error) => void;
  detachAbort: () => void;
  settled: boolean;
  aborted: boolean;
  /** Assigned when the run leaves the queue. */
  runId: string;
  flag: Int32Array | null;
  /** True once the `run` message reached the worker. */
  posted: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

interface WorkerSpawn {
  readonly instance: DrcWorkerLike;
  readonly entry: URL | string;
  readonly ready: Promise<DrcWorkerLike>;
  resolveReady: ((instance: DrcWorkerLike) => void) | null;
  rejectReady: ((error: Error) => void) | null;
  timer: ReturnType<typeof setTimeout> | null;
  readonly onMessage: DrcWorkerMessageListener;
  readonly onError: DrcWorkerErrorListener;
  readonly onExit: DrcWorkerExitListener;
}

const defaultFactory: DrcWorkerFactory = (entry) => new Worker(entry);

let factory: DrcWorkerFactory = defaultFactory;
let overrideEntry: URL | string | null = null;
let spawn: WorkerSpawn | null = null;
let active: QueuedRun | null = null;
const queue: QueuedRun[] = [];
let runCounter = 0;

/**
 * The ONE bundler-aware seam (contract 09 §2.1). Three runtimes:
 *
 * - Bun (`npm run dev`, `bun test`, Playwright): transpiles a `.ts` worker
 *   entry natively, so the sibling source file is the entry.
 * - The tsup CJS bundle: `import.meta.url` is defined to the bundle entry's
 *   own file URL, so `./drc-worker.js` resolves next to it — `dist/main/`.
 * - Electron (dev and packaged): `backend-server.ts` sets the absolute path
 *   explicitly, because packaged the entry lives in `app.asar.unpacked`.
 */
function resolveDrcWorkerEntry(): URL | string {
  if (overrideEntry !== null) return overrideEntry;
  return process.versions.bun
    ? new URL("./drc-worker.ts", import.meta.url)
    : new URL("./drc-worker.js", import.meta.url);
}

/** Overrides the entry for the NEXT spawn; call before the first run. */
export function setDrcWorkerEntry(entry: URL | string | null): void {
  overrideEntry = entry;
}

/**
 * Substitutes the transport so lifecycle tests can hold, stall or crash a
 * worker. `null` restores the real one. Applies to the NEXT spawn, so tests
 * dispose first. Never called in production.
 */
export function setDrcWorkerFactoryForTesting(
  next: DrcWorkerFactory | null,
): void {
  factory = next ?? defaultFactory;
}

/** Every worker failure names its entry path — the first thing to check. */
function workerError(entry: URL | string, detail: string): Error {
  return new Error(`DRC worker ${String(entry)}: ${detail}`);
}

/** Detaches and terminates the current worker; the next run respawns. */
function dropWorker(): Promise<void> {
  const current = spawn;
  spawn = null;
  if (!current) return Promise.resolve();
  if (current.timer !== null) {
    clearTimeout(current.timer);
    current.timer = null;
  }
  current.instance.off("message", current.onMessage);
  current.instance.off("error", current.onError);
  current.instance.off("exit", current.onExit);
  // A spawn dropped before `ready` must not leave `ensureWorker` pending
  // forever (it holds the queued run's projection) — R1 #4.
  const rejectReady = current.rejectReady;
  current.resolveReady = null;
  current.rejectReady = null;
  rejectReady?.(workerError(current.entry, "dropped before ready"));
  return Promise.resolve(current.instance.terminate()).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * The worker died or never started. The spawn promise (if still pending) or
 * the active run takes the error; queued runs stay queued and respawn.
 */
function handleWorkerFailure(error: Error): void {
  const pendingSpawn = spawn?.rejectReady ?? null;
  const run = active;
  void dropWorker();
  if (pendingSpawn) {
    // `startRun` awaits this and settles the run it belongs to.
    pendingSpawn(error);
    return;
  }
  if (run) {
    active = null;
    settleErr(run, error);
  }
  pump();
}

function cleanup(run: QueuedRun): void {
  run.settled = true;
  run.detachAbort();
  if (run.graceTimer !== null) {
    clearTimeout(run.graceTimer);
    run.graceTimer = null;
  }
}

function settleOk(run: QueuedRun, report: DrcReport): void {
  if (run.settled) return;
  cleanup(run);
  run.resolve(report);
}

function settleErr(run: QueuedRun, error: Error): void {
  if (run.settled) return;
  cleanup(run);
  run.reject(error);
}

function handleMessage(message: DrcWorkerResponse): void {
  if (message.type === "ready") {
    const current = spawn;
    if (!current) return;
    if (current.timer !== null) {
      clearTimeout(current.timer);
      current.timer = null;
    }
    const resolveReady = current.resolveReady;
    current.resolveReady = null;
    current.rejectReady = null;
    resolveReady?.(current.instance);
    return;
  }

  const run = active;
  // A message from a run that was already hard-cancelled or crashed out.
  if (!run || run.settled || run.runId !== message.runId) return;

  switch (message.type) {
    case "progress":
      // A cancelled caller gets no further progress; its promise is next.
      if (!run.aborted && run.onProgress) {
        // A listener that throws must not become an uncaught exception on the
        // main thread's message listener; progress is advisory.
        try {
          run.onProgress({
            stage: message.stage,
            index: message.index,
            total: message.total,
            violationsSoFar: message.violationsSoFar,
          });
        } catch {
          // ignore — the run and its promise are unaffected
        }
      }
      return;
    case "done":
      active = null;
      // An abort that landed while the engine was already past its last
      // checkpoint still rejects: a caller that cancelled never gets a report.
      if (run.aborted) settleErr(run, new DrcCancelledError());
      else settleOk(run, message.report);
      pump();
      return;
    case "cancelled":
      active = null;
      settleErr(run, new DrcCancelledError());
      pump();
      return;
    case "error": {
      active = null;
      const error = new Error(message.message);
      // Keep the worker-side stack: it names the check that threw.
      if (message.stack) error.stack = message.stack;
      settleErr(run, error);
      pump();
      return;
    }
  }
}

function ensureWorker(): Promise<DrcWorkerLike> {
  if (spawn) return spawn.ready;

  const entry = resolveDrcWorkerEntry();
  let instance: DrcWorkerLike;
  try {
    instance = factory(entry);
  } catch (error) {
    // Some runtimes reject a bad entry synchronously, others via `error`.
    const detail = error instanceof Error ? error.message : String(error);
    return Promise.reject(workerError(entry, `failed to spawn: ${detail}`));
  }

  let resolveReady: (worker: DrcWorkerLike) => void = () => {};
  let rejectReady: (error: Error) => void = () => {};
  const ready = new Promise<DrcWorkerLike>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Only the run that triggered the spawn awaits `ready`; a failure that
  // happens with no run in flight must not surface as an unhandled rejection.
  void ready.catch(() => {});

  const created: WorkerSpawn = {
    instance,
    entry,
    ready,
    resolveReady,
    rejectReady,
    timer: setTimeout(() => {
      handleWorkerFailure(
        workerError(
          entry,
          `posted no ready message within ${SPAWN_TIMEOUT_MS} ms`,
        ),
      );
    }, SPAWN_TIMEOUT_MS),
    onMessage: (message) => handleMessage(message),
    onError: (error) => handleWorkerFailure(workerError(entry, error.message)),
    onExit: (exitCode) =>
      handleWorkerFailure(workerError(entry, `exited with code ${exitCode}`)),
  };
  spawn = created;
  instance.on("message", created.onMessage);
  instance.on("error", created.onError);
  instance.on("exit", created.onExit);
  return ready;
}

async function startRun(
  run: QueuedRun,
  cancel: SharedArrayBuffer,
): Promise<void> {
  let instance: DrcWorkerLike;
  try {
    instance = await ensureWorker();
  } catch (error) {
    if (active === run) active = null;
    settleErr(run, error instanceof Error ? error : new Error(String(error)));
    pump();
    return;
  }
  // Aborted or disposed while the worker was spawning.
  if (active !== run || run.settled) return;
  run.posted = true;
  try {
    instance.postMessage({
      type: "run",
      runId: run.runId,
      projection: run.input.projection,
      rawFootprints: run.input.rawFootprints,
      cancel,
    });
  } catch (error) {
    // A thread that died between `ready` and this post, or a projection the
    // structured clone refuses. Either way the run must settle, not hang.
    active = null;
    void dropWorker();
    settleErr(run, error instanceof Error ? error : new Error(String(error)));
    pump();
  }
}

function pump(): void {
  if (active !== null) return;
  const run = queue.shift();
  if (!run) return;
  active = run;
  const cancel = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  run.flag = new Int32Array(cancel);
  void startRun(run, cancel);
}

/** Hard cancel: the engine never reached a checkpoint in time (§3 step 2). */
function hardCancel(run: QueuedRun): void {
  if (run.settled || active !== run) return;
  active = null;
  void dropWorker();
  settleErr(run, new DrcCancelledError());
  pump();
}

function abortRun(run: QueuedRun): void {
  if (run.settled) return;
  run.aborted = true;

  if (active !== run) {
    const index = queue.indexOf(run);
    if (index >= 0) queue.splice(index, 1);
    settleErr(run, new DrcCancelledError());
    return;
  }
  if (!run.posted) {
    // Nothing reached the worker; the spawn (if any) stays usable.
    active = null;
    settleErr(run, new DrcCancelledError());
    pump();
    return;
  }
  // Cooperative first: the engine reads this at its next checkpoint.
  Atomics.store(run.flag!, 0, 1);
  run.graceTimer = setTimeout(() => hardCancel(run), CANCEL_GRACE_MS);
}

/**
 * Runs the engine on the worker and resolves with a report byte-identical to
 * `runDrc(projection, { lookupRawFootprint })` (contract §6). Runs are FIFO,
 * one at a time; `signal` cancels a queued or running one.
 */
export function runDrcOnWorker(
  input: DrcWorkerRunInput,
  opts: DrcWorkerRunOptions = {},
): Promise<DrcReport> {
  if (opts.signal?.aborted) return Promise.reject(new DrcCancelledError());
  return new Promise<DrcReport>((resolve, reject) => {
    runCounter += 1;
    const run: QueuedRun = {
      input,
      onProgress: opts.onProgress,
      resolve,
      reject,
      detachAbort: () => {},
      settled: false,
      aborted: false,
      runId: `drc-${runCounter}`,
      flag: null,
      posted: false,
      graceTimer: null,
    };
    const signal = opts.signal;
    if (signal) {
      const onAbort = (): void => abortRun(run);
      signal.addEventListener("abort", onAbort, { once: true });
      run.detachAbort = () => signal.removeEventListener("abort", onAbort);
    }
    queue.push(run);
    pump();
  });
}

/**
 * Terminates the worker and rejects everything in flight. Tests call it in
 * `afterAll`; Electron calls it before closing the backend runtime.
 */
export async function disposeDrcWorker(): Promise<void> {
  const run = active;
  active = null;
  const queued = queue.splice(0, queue.length);
  const terminated = dropWorker();
  if (run) settleErr(run, new DrcCancelledError("shutdown"));
  for (const pending of queued) {
    settleErr(pending, new DrcCancelledError("shutdown"));
  }
  await terminated;
}
