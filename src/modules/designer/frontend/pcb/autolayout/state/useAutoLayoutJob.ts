// Auto Layout job lifecycle: submit → follow → review → apply.
//
// Three properties this hook exists to guarantee:
//
//   * ONE job per run. Submission is guarded by a ref, not by render state, so a double
//     click or a re-render cannot start a second (expensive) cloud job. The previous
//     implementation memoized request bodies for the same reason; the guard is stronger.
//   * The stream is never the only way to finish. SSE is a progress optimization; the
//     terminal answer always comes from a status fetch, so a dropped stream degrades to
//     polling instead of hanging the UI forever.
//   * Nothing here touches the board. The only mutation is `apply()`, which goes through
//     the backend's atomic endpoint.
//
// SSE is consumed with fetch + a reader rather than EventSource because EventSource cannot
// send the cloud bearer header the proxy requires.

import { useCallback, useEffect, useReducer, useRef } from "react";

import type { LayoutResultEnvelope } from "../../../../../../sdks/designer/cloud-autolayout";
import {
  AutoLayoutClientError,
  type AutoLayoutApi,
  type SubmitLayoutRequest,
} from "../api";
import { INITIAL_STATE, autoLayoutReducer } from "./reducer";
import type { AutoLayoutRunState } from "./types";

const POLL_INTERVAL_MS = 1_500;
/** ~15 min: a K=5 composite job places AND routes each candidate. */
const MAX_POLLS = 600;

function asClientError(error: unknown): AutoLayoutClientError {
  return error instanceof AutoLayoutClientError
    ? error
    : new AutoLayoutClientError(
        "AUTO_LAYOUT_UNKNOWN",
        error instanceof Error ? error.message : "Auto Layout failed",
      );
}

export interface UseAutoLayoutJob {
  state: AutoLayoutRunState;
  run: (request: SubmitLayoutRequest) => Promise<void>;
  cancel: () => Promise<void>;
  select: (candidateId: string) => void;
  apply: () => Promise<void>;
  reset: () => void;
  /** Called by the canvas when the board's content digest changes mid-run. */
  markStale: () => void;
}

export function useAutoLayoutJob(options: {
  api: AutoLayoutApi;
  sessionId: string;
  /** Refetch the projection after a successful apply. */
  onApplied?: (revision: number) => void;
}): UseAutoLayoutJob {
  const [state, dispatch] = useReducer(autoLayoutReducer, INITIAL_STATE);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const { api, sessionId, onApplied } = options;

  // Abort any in-flight stream when the component goes away; the cloud job keeps running
  // and can be re-attached by re-opening the dialog (status is server-side).
  useEffect(() => () => abortRef.current?.abort(), []);

  /** Follow SSE, then fall back to polling for the terminal answer. */
  const follow = useCallback(
    async (jobId: string) => {
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      let lastEventId: string | null = null;
      try {
        const response = await fetch(api.streamUrl(jobId), {
          headers: { accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (response.ok && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split("\n\n");
            buffer = chunks.pop() ?? "";
            for (const chunk of chunks) {
              for (const line of chunk.split("\n")) {
                if (line.startsWith("id:")) lastEventId = line.slice(3).trim();
                if (!line.startsWith("data:")) continue;
                try {
                  dispatch({
                    type: "progress",
                    frame: JSON.parse(line.slice(5).trim()) as Record<string, unknown>,
                  });
                } catch {
                  // a malformed frame is a dropped tick, never a failed run
                }
              }
            }
          }
        }
      } catch {
        // stream unavailable / dropped — polling below is the source of truth
      }
      void lastEventId; // resume is handled by re-opening the stream, not mid-read

      if (controller.signal.aborted) return;
      dispatch({ type: "polling" });

      for (let poll = 0; poll < MAX_POLLS; poll += 1) {
        if (controller.signal.aborted) return;
        let status: Awaited<ReturnType<AutoLayoutApi["status"]>>;
        try {
          status = await api.status(jobId);
        } catch (error) {
          dispatch({ type: "failed", error: asClientError(error) });
          return;
        }
        if (status.status === "done" || status.status === "cancelled") {
          if (status.result) {
            dispatch({
              type: "result",
              result: status.result as LayoutResultEnvelope,
            });
          } else {
            dispatch({ type: "cancelled" });
          }
          return;
        }
        if (status.status === "failed") {
          dispatch({
            type: "failed",
            error: new AutoLayoutClientError(
              "AUTO_LAYOUT_SERVICE_ERROR",
              status.error ?? "Auto Layout failed in the cloud.",
            ),
          });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      dispatch({
        type: "failed",
        error: new AutoLayoutClientError(
          "AUTO_LAYOUT_SERVICE_ERROR",
          "Auto Layout is taking longer than expected. Check back from the Auto Layout dialog.",
        ),
      });
    },
    [api],
  );

  const run = useCallback(
    async (request: SubmitLayoutRequest) => {
      // Guard on a ref: React can re-render (or StrictMode double-invoke) between the
      // state update and the fetch, and each duplicate submit is a full cloud job.
      if (busyRef.current) return;
      busyRef.current = true;
      dispatch({ type: "submit" });
      try {
        const submitted = await api.submit(request);
        dispatch({
          type: "submitted",
          run: {
            jobId: submitted.jobId,
            snapshotDigest: submitted.snapshotDigest,
            baseRevision: submitted.baseRevision,
            warnings: submitted.warnings ?? [],
          },
        });
        void follow(submitted.jobId);
      } catch (error) {
        dispatch({ type: "failed", error: asClientError(error) });
      } finally {
        busyRef.current = false;
      }
    },
    [api, follow],
  );

  const cancel = useCallback(async () => {
    const current = stateRef.current;
    if (current.type !== "running") return;
    dispatch({ type: "cancelRequested" });
    try {
      await api.cancel(current.run.jobId);
      // Deliberately NOT dispatching "cancelled" here: cancellation is cooperative, the
      // job stops when it notices, and it may still return a partial result worth showing.
    } catch (error) {
      dispatch({ type: "failed", error: asClientError(error) });
    }
  }, [api]);

  const select = useCallback((candidateId: string) => {
    dispatch({ type: "selectCandidate", candidateId });
  }, []);

  const markStale = useCallback(() => dispatch({ type: "markStale" }), []);

  const apply = useCallback(async () => {
    const current = stateRef.current;
    if (current.type !== "review" || !current.selectedCandidateId) return;
    if (current.stale) return; // Apply is disabled in the UI; belt and braces
    const candidateId = current.selectedCandidateId;
    dispatch({ type: "applyStarted" });
    try {
      const applied = await api.apply({
        jobId: current.run.jobId,
        candidateId,
        snapshotDigest: current.run.snapshotDigest,
        // Stable per attempt so a retry after a lost response replays the original commit
        // instead of applying the candidate twice.
        applyRequestId: crypto.randomUUID(),
        sessionId,
      });
      dispatch({
        type: "applied",
        candidateId,
        revision: applied.revision,
        // `null`, not 0: the post-apply DRC run is reported-never-gating and
        // can come back without a report (cancelled / superseded). "0 errors"
        // would claim a clean board nothing checked.
        drcErrors: applied.drc?.summary.errors ?? null,
        drcWarnings: applied.drc?.summary.warnings ?? null,
        warnings: applied.warnings ?? [],
      });
      onApplied?.(applied.revision);
    } catch (error) {
      dispatch({ type: "failed", error: asClientError(error) });
    }
  }, [api, onApplied, sessionId]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "reset" });
  }, []);

  return { state, run, cancel, select, apply, reset, markStale };
}
