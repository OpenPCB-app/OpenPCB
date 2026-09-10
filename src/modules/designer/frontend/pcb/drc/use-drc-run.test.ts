/**
 * The DRC run transport (execution contract 09 §7): the SSE lifecycle, the
 * poll fallback when the stream drops, cooperative cancel, and the fact that
 * the report is fetched separately on every `completed` — over the stream or
 * by polling.
 *
 * The frontend Vitest project runs `environment: "node"` with no DOM harness,
 * so these tests drive `createDrcRunController` (the React-free half of
 * `use-drc-run.ts`) directly; `useDrcRun` only owns its lifecycle. `dispose()`
 * is what the hook's unmount / design-change cleanup calls.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { DrcReport, DrcRunSnapshot } from "../../../../../sdks";
import { useDrcStore } from "./drc-store";
import { createDrcRunController, type DrcRunApi } from "./use-drc-run";

interface Listener {
  (event: { data: string }): void;
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  closed = false;
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type);
    if (list) list.push(listener);
    else this.listeners.set(type, [listener]);
  }

  close(): void {
    this.closed = true;
  }

  /** Deliver one named SSE event. */
  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) });
    }
  }

  /** Simulate the stream dropping. */
  fail(): void {
    this.onerror?.();
  }
}

function report(revision: number): DrcReport {
  return {
    designId: "design-1",
    revision,
    violations: [],
    summary: { errors: 0, warnings: 0, infos: 0 },
    countsByCode: {},
  };
}

function snapshot(overrides: Partial<DrcRunSnapshot> = {}): DrcRunSnapshot {
  return {
    runId: "run-1",
    designId: "design-1",
    revision: 7,
    status: "queued",
    progress: {
      stage: "queued",
      index: 0,
      total: 17,
      fraction: 0,
      violationsSoFar: 0,
    },
    startedAt: "2026-09-09T10:00:00.000Z",
    ...overrides,
  };
}

function makeApi(overrides: Partial<DrcRunApi> = {}) {
  const api = {
    startDrcRun: vi.fn(async () => snapshot()),
    getDrcRun: vi.fn(async () => snapshot({ status: "running" })),
    cancelDrcRun: vi.fn(async () => snapshot({ status: "running" })),
    drcRunStreamUrl: vi.fn(
      (designId: string, runId: string) =>
        `http://localhost/api/modules/designer/designs/${designId}/drc/runs/${runId}/stream`,
    ),
    getDrcResult: vi.fn(async () => report(7) as DrcReport | null),
    ...overrides,
  };
  return api satisfies DrcRunApi;
}

function controllerFor(api: DrcRunApi) {
  return createDrcRunController({ api, designId: "design-1" });
}

function lastStream(): FakeEventSource {
  const stream = FakeEventSource.instances.at(-1);
  if (!stream) throw new Error("Expected a stream to have been opened");
  return stream;
}

describe("createDrcRunController", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    useDrcStore.getState().clear();
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("start begins the run and opens the stream for its runId", async () => {
    const api = makeApi();
    await controllerFor(api).start();

    expect(api.startDrcRun).toHaveBeenCalledTimes(1);
    expect(useDrcStore.getState().run?.runId).toBe("run-1");
    expect(lastStream().url).toContain("/drc/runs/run-1/stream");
  });

  test("run.state and run.progress frames reach the store", async () => {
    const api = makeApi();
    await controllerFor(api).start();
    const stream = lastStream();

    stream.emit("run.state", snapshot({ status: "running" }));
    expect(useDrcStore.getState().run?.status).toBe("running");

    stream.emit(
      "run.progress",
      snapshot({
        status: "running",
        progress: {
          stage: "clearance",
          index: 4,
          total: 17,
          fraction: 4 / 17,
          violationsSoFar: 3,
        },
      }),
    );
    const progress = useDrcStore.getState().run?.progress;
    expect(progress?.stage).toBe("clearance");
    expect(progress?.violationsSoFar).toBe(3);
  });

  test("run.completed fetches the report once and swaps it in", async () => {
    const api = makeApi();
    useDrcStore.getState().setReport(report(6));
    await controllerFor(api).start();
    const stream = lastStream();

    stream.emit("run.completed", { summary: report(7).summary });
    await vi.waitFor(() =>
      expect(useDrcStore.getState().report?.revision).toBe(7),
    );
    expect(api.getDrcResult).toHaveBeenCalledTimes(1);
    expect(useDrcStore.getState().run?.status).toBe("completed");
    expect(stream.closed).toBe(true);
  });

  test("run.cancelled keeps the previous report", async () => {
    const api = makeApi();
    useDrcStore.getState().setReport(report(6));
    await controllerFor(api).start();

    lastStream().emit("run.cancelled", { reason: "user" });

    expect(api.getDrcResult).not.toHaveBeenCalled();
    expect(useDrcStore.getState().report?.revision).toBe(6);
    expect(useDrcStore.getState().run?.status).toBe("cancelled");
    expect(useDrcStore.getState().cancelNotice).toBe("user");
  });

  test("run.failed keeps the previous report and surfaces the message", async () => {
    const api = makeApi();
    useDrcStore.getState().setReport(report(6));
    await controllerFor(api).start();

    lastStream().emit("run.failed", { message: "worker crashed" });

    expect(useDrcStore.getState().report?.revision).toBe(6);
    expect(useDrcStore.getState().error).toBe("worker crashed");
    expect(useDrcStore.getState().run?.status).toBe("failed");
  });

  test("a dropped stream falls back to polling until the run completes", async () => {
    vi.useFakeTimers();
    const statuses: DrcRunSnapshot[] = [
      snapshot({ status: "running" }),
      snapshot({ status: "completed" }),
    ];
    const api = makeApi({
      getDrcRun: vi.fn(
        async () => statuses.shift() ?? snapshot({ status: "completed" }),
      ),
    });
    useDrcStore.getState().setReport(report(6));
    await controllerFor(api).start();

    lastStream().fail();
    expect(lastStream().closed).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    expect(api.getDrcRun).toHaveBeenCalledTimes(1);
    expect(useDrcStore.getState().run?.status).toBe("running");

    await vi.advanceTimersByTimeAsync(500);
    expect(api.getDrcRun).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(useDrcStore.getState().report?.revision).toBe(7);
    expect(api.getDrcResult).toHaveBeenCalledTimes(1);
    expect(useDrcStore.getState().run?.status).toBe("completed");
  });

  test("start is a no-op while a run is active", async () => {
    const api = makeApi();
    const controller = controllerFor(api);
    await controller.start();
    await controller.start();
    expect(api.startDrcRun).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  test("cancel posts once and applies the returned snapshot without ending the run", async () => {
    const api = makeApi({
      cancelDrcRun: vi.fn(async () =>
        snapshot({
          status: "running",
          progress: {
            stage: "cancelling",
            index: 5,
            total: 17,
            fraction: 5 / 17,
            violationsSoFar: 1,
          },
        }),
      ),
    });
    const controller = controllerFor(api);
    await controller.start();
    await controller.cancel();

    expect(api.cancelDrcRun).toHaveBeenCalledTimes(1);
    expect(api.cancelDrcRun).toHaveBeenCalledWith("design-1", "run-1");
    // Cooperative: only the backend's terminal event ends the run.
    expect(useDrcStore.getState().run?.status).toBe("running");
    expect(useDrcStore.getState().run?.progress.stage).toBe("cancelling");
    expect(lastStream().closed).toBe(false);

    lastStream().emit("run.cancelled", { reason: "user" });
    expect(useDrcStore.getState().run?.status).toBe("cancelled");
  });

  test("cancel is a no-op when no run is active", async () => {
    const api = makeApi();
    await controllerFor(api).cancel();
    expect(api.cancelDrcRun).not.toHaveBeenCalled();
  });

  test("dispose closes the stream and stops the poll fallback", async () => {
    vi.useFakeTimers();
    const api = makeApi();
    const controller = controllerFor(api);
    await controller.start();
    const stream = lastStream();

    controller.dispose();
    expect(stream.closed).toBe(true);

    // A frame arriving after dispose changes nothing, and no poll is scheduled.
    stream.emit("run.completed", {});
    await vi.advanceTimersByTimeAsync(2_000);
    expect(api.getDrcResult).not.toHaveBeenCalled();
    expect(api.getDrcRun).not.toHaveBeenCalled();
  });

  test("re-attaches to an in-flight run for this design on construction", async () => {
    const api = makeApi();
    useDrcStore.getState().setReport(report(6));
    // A previous mount started this run and was then disposed (dock tab
    // switch); the store still holds it.
    useDrcStore.getState().beginRun(snapshot({ status: "running" }));

    const controller = controllerFor(api);

    expect(api.startDrcRun).not.toHaveBeenCalled();
    expect(lastStream().url).toContain("/drc/runs/run-1/stream");

    lastStream().emit("run.completed", {});
    await vi.waitFor(() =>
      expect(useDrcStore.getState().report?.revision).toBe(7),
    );
    expect(useDrcStore.getState().run?.status).toBe("completed");
    controller.dispose();
  });

  test("detaches an in-flight run belonging to another design and starts a new one", async () => {
    const api = makeApi();
    useDrcStore.getState().setReport(report(6));
    useDrcStore.getState().beginRun(
      snapshot({
        runId: "run-other",
        designId: "design-2",
        status: "running",
      }),
    );

    const controller = controllerFor(api);

    // Detached, not cancelled — no notice, and the report is untouched.
    expect(useDrcStore.getState().run).toBeNull();
    expect(useDrcStore.getState().cancelNotice).toBeNull();
    expect(useDrcStore.getState().report?.revision).toBe(6);
    expect(FakeEventSource.instances).toHaveLength(0);

    await controller.start();
    expect(api.startDrcRun).toHaveBeenCalledTimes(1);
    expect(useDrcStore.getState().run?.runId).toBe("run-1");
  });

  test("start joins a run that already finished and fetches its report", async () => {
    const api = makeApi({
      startDrcRun: vi.fn(async () => snapshot({ status: "completed" })),
    });
    useDrcStore.getState().setReport(report(6));
    await controllerFor(api).start();

    await vi.waitFor(() =>
      expect(useDrcStore.getState().report?.revision).toBe(7),
    );
    expect(api.getDrcResult).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  test("start joining a cancelled run keeps the previous report", async () => {
    const api = makeApi({
      startDrcRun: vi.fn(async () =>
        snapshot({ status: "cancelled", cancelReason: "superseded" }),
      ),
    });
    useDrcStore.getState().setReport(report(6));
    await controllerFor(api).start();

    expect(api.getDrcResult).not.toHaveBeenCalled();
    expect(useDrcStore.getState().report?.revision).toBe(6);
    expect(useDrcStore.getState().cancelNotice).toBe("superseded");
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  test("polling gives up after the attempt budget and fails the run", async () => {
    vi.useFakeTimers();
    const api = makeApi({
      getDrcRun: vi.fn(async () => {
        throw new Error("404");
      }),
    });
    useDrcStore.getState().setReport(report(6));
    await controllerFor(api).start();

    lastStream().fail();
    // 60 attempts at 500 ms; the 61st schedule trips the budget instead.
    await vi.advanceTimersByTimeAsync(60 * 500);

    expect(api.getDrcRun).toHaveBeenCalledTimes(60);
    expect(useDrcStore.getState().error).toBe("Lost contact with the DRC run");
    expect(useDrcStore.getState().run?.status).toBe("failed");
    // The previous report survives a lost run.
    expect(useDrcStore.getState().report?.revision).toBe(6);
  });

  test("a failed start surfaces the error and opens no stream", async () => {
    const api = makeApi({
      startDrcRun: vi.fn(async () => {
        throw new Error("backend down");
      }),
    });
    await controllerFor(api).start();
    expect(useDrcStore.getState().error).toBe("backend down");
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
