import { useCallback, useEffect, useRef } from "react";
import type {
  DrcReport,
  DrcRunCancelReason,
  DrcRunSnapshot,
} from "../../../../../sdks";
import { isDrcRunActive, useDrcStore } from "./drc-store";

/**
 * Transport for the asynchronous batch DRC run (execution contract 09 §7).
 *
 * Three properties this file exists to guarantee:
 *
 *   * The stream is never the only way to finish. SSE is a progress
 *     optimization; when it drops, the terminal answer still arrives by
 *     polling `GET /runs/:runId`, so a dropped stream degrades instead of
 *     hanging the panel forever.
 *   * The report never travels with a run. Every terminal `completed` — over
 *     the stream or by polling — fetches `GET /drc` and swaps the report in
 *     one store call, so the panel goes straight from the previous report to
 *     the new one and is never briefly empty.
 *   * Cancellation is cooperative. `cancel()` posts and applies whatever
 *     snapshot comes back; the run is marked cancelled only when the backend
 *     says so.
 *
 * The controller is deliberately React-free so the whole state machine is
 * unit-testable against a fake `EventSource` and a fake api; `useDrcRun` is
 * the thin lifecycle wrapper that owns one controller per design.
 */

const POLL_INTERVAL_MS = 500;
/** ~30 s of poll fallback before the run is declared lost. */
const MAX_POLLS = 60;

/** The slice of `createDesignerApi` this controller needs. */
export interface DrcRunApi {
  startDrcRun(designId: string): Promise<DrcRunSnapshot>;
  getDrcRun(designId: string, runId: string): Promise<DrcRunSnapshot>;
  cancelDrcRun(designId: string, runId: string): Promise<DrcRunSnapshot>;
  drcRunStreamUrl(designId: string, runId: string): string;
  getDrcResult(designId: string): Promise<DrcReport | null>;
}

export interface DrcRunController {
  /** Start a run, or no-op while one is already active. */
  start(): Promise<void>;
  /** Ask the backend to cancel the active run. Cooperative. */
  cancel(): Promise<void>;
  /** Close the stream and stop polling. Idempotent. */
  dispose(): void;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function parseEventData<T>(data: unknown): T | null {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export function createDrcRunController(params: {
  api: DrcRunApi;
  designId: string;
}): DrcRunController {
  const { api, designId } = params;
  const store = useDrcStore;

  let stream: EventSource | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  /** Set once this controller has seen (or synthesised) a terminal state. */
  let finished = false;

  function closeStream(): void {
    stream?.close();
    stream = null;
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function teardown(): void {
    closeStream();
    stopPolling();
  }

  async function finishCompleted(): Promise<void> {
    try {
      const report = await api.getDrcResult(designId);
      if (disposed) return;
      store.getState().completeRun(report);
    } catch (err) {
      if (disposed) return;
      store.getState().failRun(errorMessage(err, "DRC report unavailable"));
    }
  }

  function finishCancelled(reason: DrcRunCancelReason): void {
    if (disposed) return;
    store.getState().cancelRun(reason);
  }

  function finishFailed(message: string): void {
    if (disposed) return;
    store.getState().failRun(message);
  }

  /** Route a terminal snapshot (poll fallback, or a `start` that joined a finished run). */
  function handleTerminalSnapshot(snapshot: DrcRunSnapshot): void {
    finished = true;
    teardown();
    if (snapshot.status === "completed") {
      void finishCompleted();
    } else if (snapshot.status === "cancelled") {
      finishCancelled(snapshot.cancelReason ?? "user");
    } else {
      finishFailed(snapshot.error ?? "DRC run failed");
    }
  }

  function openStream(runId: string): void {
    closeStream();
    const source = new EventSource(api.drcRunStreamUrl(designId, runId));
    stream = source;

    const onSnapshot = (event: MessageEvent<string>): void => {
      if (disposed || finished) return;
      const snapshot = parseEventData<DrcRunSnapshot>(event.data);
      if (snapshot) store.getState().applyRunSnapshot(snapshot);
    };
    source.addEventListener("run.state", onSnapshot);
    source.addEventListener("run.progress", onSnapshot);

    source.addEventListener("run.completed", () => {
      if (disposed || finished) return;
      finished = true;
      teardown();
      void finishCompleted();
    });

    source.addEventListener("run.cancelled", (event: MessageEvent<string>) => {
      if (disposed || finished) return;
      finished = true;
      teardown();
      const payload = parseEventData<{ reason?: DrcRunCancelReason }>(
        event.data,
      );
      finishCancelled(payload?.reason ?? "user");
    });

    source.addEventListener("run.failed", (event: MessageEvent<string>) => {
      if (disposed || finished) return;
      finished = true;
      teardown();
      const payload = parseEventData<{ message?: string }>(event.data);
      finishFailed(payload?.message ?? "DRC run failed");
    });

    source.onerror = (): void => {
      // The server closes the stream on the terminal event, so an error after
      // one is expected noise. Otherwise fall back to polling the run.
      if (disposed || finished) return;
      closeStream();
      schedulePoll(runId, 0);
    };
  }

  function schedulePoll(runId: string, attempt: number): void {
    if (disposed || finished) return;
    if (attempt >= MAX_POLLS) {
      finished = true;
      finishFailed("Lost contact with the DRC run");
      return;
    }
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void poll(runId, attempt);
    }, POLL_INTERVAL_MS);
  }

  async function poll(runId: string, attempt: number): Promise<void> {
    if (disposed || finished) return;
    let snapshot: DrcRunSnapshot;
    try {
      snapshot = await api.getDrcRun(designId, runId);
    } catch {
      // A dropped run answers 404; retrying is still the right move until the
      // attempt budget runs out, at which point the run is declared lost.
      schedulePoll(runId, attempt + 1);
      return;
    }
    if (disposed || finished) return;
    if (isDrcRunActive(snapshot)) {
      store.getState().applyRunSnapshot(snapshot);
      schedulePoll(runId, attempt + 1);
      return;
    }
    handleTerminalSnapshot(snapshot);
  }

  // Re-attach on construction. `DesignerDrcView` is mounted conditionally (it
  // is a dock tab / view), so a run started before a tab switch survives in
  // the store while its controller is disposed. Without this the next mount
  // would see an active run, refuse to start, and sit on a frozen bar forever.
  const existing = store.getState().run;
  if (isDrcRunActive(existing)) {
    if (existing.designId === designId) {
      // The server replays the current state as the first `run.state` frame,
      // and the poll fallback covers a stream that never opens.
      openStream(existing.runId);
    } else {
      // Another design's run: forget it, do NOT cancel it.
      store.getState().detachRun();
    }
  }

  return {
    async start(): Promise<void> {
      if (disposed) return;
      const active = store.getState().run;
      if (isDrcRunActive(active) && active.designId === designId) return;
      teardown();
      finished = false;
      let snapshot: DrcRunSnapshot;
      try {
        snapshot = await api.startDrcRun(designId);
      } catch (err) {
        if (disposed) return;
        store.getState().failRun(errorMessage(err, "DRC run failed to start"));
        return;
      }
      if (disposed) return;
      store.getState().beginRun(snapshot);
      if (!isDrcRunActive(snapshot)) {
        handleTerminalSnapshot(snapshot);
        return;
      }
      openStream(snapshot.runId);
    },

    async cancel(): Promise<void> {
      if (disposed) return;
      const current = store.getState().run;
      if (!isDrcRunActive(current)) return;
      try {
        const snapshot = await api.cancelDrcRun(designId, current.runId);
        if (disposed) return;
        // Cooperative: the run is terminal only once the backend says so, so
        // keep listening and just record whatever came back.
        store.getState().applyRunSnapshot(snapshot);
      } catch (err) {
        if (disposed) return;
        store.getState().setError(errorMessage(err, "Cancel failed"));
      }
    },

    dispose(): void {
      disposed = true;
      teardown();
    },
  };
}

export interface UseDrcRun {
  start(): Promise<void>;
  cancel(): Promise<void>;
}

/**
 * Owns one `DrcRunController` per (api, design). Switching design or
 * unmounting closes the stream and stops polling; the store's run state is
 * left alone (the canvas clears it on design change).
 */
export function useDrcRun(params: {
  api: DrcRunApi;
  designId: string | null;
}): UseDrcRun {
  const { api, designId } = params;
  const controllerRef = useRef<DrcRunController | null>(null);

  useEffect(() => {
    if (!designId) {
      controllerRef.current = null;
      return;
    }
    const controller = createDrcRunController({ api, designId });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [api, designId]);

  const start = useCallback(async () => {
    await controllerRef.current?.start();
  }, []);
  const cancel = useCallback(async () => {
    await controllerRef.current?.cancel();
  }, []);

  return { start, cancel };
}
