// Auto Layout run state.
//
// The old model was `"idle" | "place" | "route"` — desktop-sequenced stages, where the
// desktop applied a placement to the board and THEN asked for routing. There are no stages
// here: one cloud job produces complete candidates, and "place" / "route" are now progress
// detail INSIDE that job. Nothing in this state machine can mutate the board except the
// explicit `applying` transition.

import type {
  LayoutCandidate,
  LayoutResultEnvelope,
} from "../../../../../../sdks/designer/cloud-autolayout";
import type { AutoLayoutClientError } from "../api";

/** Per-candidate progress, as reported by the service's SSE frames. */
export interface CandidateProgress {
  candidateId: string;
  index: number;
  stage: string | null;
  finished: boolean;
}

export interface LayoutProgressState {
  /** Deterministic work-based fraction 0..1, or null before the first progress frame. */
  fraction: number | null;
  candidatesTotal: number | null;
  candidatesFinished: number;
  candidates: CandidateProgress[];
  /** Last frame type seen — drives the human-readable phase line. */
  lastFrame: string | null;
  /** True once the stream drops and the UI falls back to polling. */
  polling: boolean;
}

export const EMPTY_PROGRESS: LayoutProgressState = {
  fraction: null,
  candidatesTotal: null,
  candidatesFinished: 0,
  candidates: [],
  lastFrame: null,
  polling: false,
};

export interface RunContext {
  jobId: string;
  /** Content digest of the board the job was submitted for. */
  snapshotDigest: string;
  baseRevision: number;
  warnings: string[];
}

export type AutoLayoutRunState =
  | { type: "idle" }
  | { type: "submitting" }
  | { type: "running"; run: RunContext; progress: LayoutProgressState; cancelling: boolean }
  | {
      type: "review";
      run: RunContext;
      result: LayoutResultEnvelope;
      selectedCandidateId: string | null;
      /** Set once the board changes under a finished result: preview stays, Apply does not. */
      stale: boolean;
    }
  | {
      type: "applying";
      run: RunContext;
      result: LayoutResultEnvelope;
      selectedCandidateId: string;
    }
  | {
      type: "completed";
      run: RunContext;
      candidateId: string;
      revision: number;
      /** `null` when the post-apply DRC run did not produce a report. */
      drcErrors: number | null;
      drcWarnings: number | null;
      warnings: string[];
    }
  | { type: "failed"; error: AutoLayoutClientError; run: RunContext | null }
  | { type: "cancelled"; run: RunContext };

export type AutoLayoutAction =
  | { type: "submit" }
  | { type: "submitted"; run: RunContext }
  | { type: "progress"; frame: Record<string, unknown> }
  | { type: "polling" }
  | { type: "result"; result: LayoutResultEnvelope }
  | { type: "selectCandidate"; candidateId: string }
  | { type: "markStale" }
  | { type: "applyStarted" }
  | {
      type: "applied";
      candidateId: string;
      revision: number;
      /** `null` when the post-apply DRC run did not produce a report. */
      drcErrors: number | null;
      drcWarnings: number | null;
      warnings: string[];
    }
  | { type: "cancelRequested" }
  | { type: "cancelled" }
  | { type: "failed"; error: AutoLayoutClientError }
  | { type: "reset" };

/** The candidate the UI is currently showing, or null. */
export function selectedCandidate(
  state: AutoLayoutRunState,
): LayoutCandidate | null {
  if (state.type !== "review" && state.type !== "applying") return null;
  const id =
    state.type === "review" ? state.selectedCandidateId : state.selectedCandidateId;
  if (!id) return null;
  return state.result.candidates.find((c) => c.candidateId === id) ?? null;
}
