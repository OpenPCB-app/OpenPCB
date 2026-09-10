/**
 * The batch-DRC run state machine (execution contract 09 §1, §4, §7). These
 * tests pin the two properties the panel depends on: the previous report stays
 * on screen for every non-`completed` ending, and a run's snapshot can only be
 * moved by that run — a superseded or late frame is ignored rather than
 * clobbering the active one.
 */
import { beforeEach, describe, expect, test } from "vitest";
import type {
  DrcReport,
  DrcRunSnapshot,
  DrcRunStatus,
} from "../../../../../sdks";
import { isDrcRunActive, useDrcStore } from "./drc-store";

function report(overrides: Partial<DrcReport> = {}): DrcReport {
  return {
    designId: "design-1",
    revision: 7,
    violations: [
      {
        id: "v1",
        code: "KEEPOUT_VIOLATION",
        ruleClass: "constraint",
        severity: "error",
        message: "Trace inside keepout",
        anchors: [{ kind: "trace", traceId: "t1" }],
      },
    ],
    summary: { errors: 1, warnings: 0, infos: 0 },
    countsByCode: { KEEPOUT_VIOLATION: 1 },
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<DrcRunSnapshot> & { status?: DrcRunStatus } = {},
): DrcRunSnapshot {
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

describe("drc-store run lifecycle", () => {
  beforeEach(() => {
    useDrcStore.getState().clear();
  });

  test("starts with no run", () => {
    const state = useDrcStore.getState();
    expect(state.run).toBeNull();
    expect(state.report).toBeNull();
    expect(state.error).toBeNull();
    expect(state.cancelNotice).toBeNull();
    expect(isDrcRunActive(state.run)).toBe(false);
  });

  test("beginRun makes the run active and clears the previous error / notice", () => {
    useDrcStore.getState().failRun("boom");
    useDrcStore.getState().cancelRun("user");
    useDrcStore.getState().beginRun(snapshot());
    const state = useDrcStore.getState();
    expect(state.run?.runId).toBe("run-1");
    expect(isDrcRunActive(state.run)).toBe(true);
    expect(state.error).toBeNull();
    expect(state.cancelNotice).toBeNull();
  });

  test("applyRunSnapshot advances the active run's progress", () => {
    useDrcStore.getState().beginRun(snapshot());
    useDrcStore.getState().applyRunSnapshot(
      snapshot({
        status: "running",
        progress: {
          stage: "clearance",
          index: 3,
          total: 17,
          fraction: 3 / 17,
          violationsSoFar: 2,
        },
      }),
    );
    const run = useDrcStore.getState().run;
    expect(run?.status).toBe("running");
    expect(run?.progress.stage).toBe("clearance");
    expect(run?.progress.violationsSoFar).toBe(2);
  });

  test("applyRunSnapshot ignores a snapshot from a different run", () => {
    useDrcStore.getState().beginRun(snapshot({ status: "running" }));
    useDrcStore.getState().applyRunSnapshot(
      snapshot({
        runId: "run-0",
        status: "running",
        progress: {
          stage: "stale",
          index: 9,
          total: 17,
          fraction: 0.5,
          violationsSoFar: 99,
        },
      }),
    );
    expect(useDrcStore.getState().run?.runId).toBe("run-1");
    expect(useDrcStore.getState().run?.progress.stage).toBe("queued");
  });

  test("applyRunSnapshot ignores frames arriving after the run went terminal", () => {
    useDrcStore.getState().beginRun(snapshot({ status: "running" }));
    useDrcStore.getState().completeRun(report());
    useDrcStore.getState().applyRunSnapshot(snapshot({ status: "running" }));
    expect(useDrcStore.getState().run?.status).toBe("completed");
  });

  test("applyRunSnapshot is a no-op when no run is active", () => {
    useDrcStore.getState().applyRunSnapshot(snapshot({ status: "running" }));
    expect(useDrcStore.getState().run).toBeNull();
  });

  test("completeRun swaps the report, stamps lastRunAt and keeps the terminal run", () => {
    useDrcStore.getState().setReport(report({ revision: 6 }));
    useDrcStore.getState().beginRun(snapshot({ status: "running" }));
    const before = Date.now();
    useDrcStore.getState().completeRun(report({ revision: 8 }));
    const state = useDrcStore.getState();
    expect(state.report?.revision).toBe(8);
    expect(state.run?.status).toBe("completed");
    expect(state.run?.runId).toBe("run-1");
    expect(state.lastRunAt).not.toBeNull();
    expect(state.lastRunAt!).toBeGreaterThanOrEqual(before);
    expect(isDrcRunActive(state.run)).toBe(false);
  });

  test("cancelRun keeps the previous report and records the reason", () => {
    useDrcStore.getState().setReport(report({ revision: 6 }));
    useDrcStore.getState().beginRun(snapshot({ status: "running" }));
    useDrcStore.getState().cancelRun("superseded");
    const state = useDrcStore.getState();
    expect(state.report?.revision).toBe(6);
    expect(state.run?.status).toBe("cancelled");
    expect(state.run?.cancelReason).toBe("superseded");
    expect(state.cancelNotice).toBe("superseded");
    expect(isDrcRunActive(state.run)).toBe(false);
  });

  test("dismissCancelNotice clears the notice without touching the run", () => {
    useDrcStore.getState().beginRun(snapshot({ status: "running" }));
    useDrcStore.getState().cancelRun("user");
    useDrcStore.getState().dismissCancelNotice();
    expect(useDrcStore.getState().cancelNotice).toBeNull();
    expect(useDrcStore.getState().run?.status).toBe("cancelled");
  });

  test("detachRun forgets the run without cancelling it or dropping the report", () => {
    useDrcStore.getState().setReport(report({ revision: 6 }));
    useDrcStore.getState().beginRun(snapshot({ status: "running" }));
    useDrcStore.getState().detachRun();
    const state = useDrcStore.getState();
    expect(state.run).toBeNull();
    expect(state.cancelNotice).toBeNull();
    expect(state.report?.revision).toBe(6);
  });

  test("failRun keeps the previous report and surfaces the message", () => {
    useDrcStore.getState().setReport(report({ revision: 6 }));
    useDrcStore.getState().beginRun(snapshot({ status: "running" }));
    useDrcStore.getState().failRun("worker crashed");
    const state = useDrcStore.getState();
    expect(state.report?.revision).toBe(6);
    expect(state.run?.status).toBe("failed");
    expect(state.run?.error).toBe("worker crashed");
    expect(state.error).toBe("worker crashed");
  });

  test("failRun with no run in flight still surfaces the message", () => {
    useDrcStore.getState().failRun("run failed to start");
    expect(useDrcStore.getState().run).toBeNull();
    expect(useDrcStore.getState().error).toBe("run failed to start");
  });

  test("setError surfaces a transport message without ending the run", () => {
    useDrcStore.getState().beginRun(snapshot({ status: "running" }));
    useDrcStore.getState().setError("Cancel failed");
    expect(useDrcStore.getState().error).toBe("Cancel failed");
    expect(isDrcRunActive(useDrcStore.getState().run)).toBe(true);
  });

  test("clear resets the run, report, error and notice but keeps the dock open", () => {
    useDrcStore.getState().setPanelOpen(true);
    useDrcStore.getState().beginRun(snapshot({ status: "running" }));
    useDrcStore.getState().completeRun(report());
    useDrcStore.getState().cancelRun("user");
    useDrcStore.getState().clear();
    const state = useDrcStore.getState();
    expect(state.run).toBeNull();
    expect(state.report).toBeNull();
    expect(state.error).toBeNull();
    expect(state.cancelNotice).toBeNull();
    expect(state.panelOpen).toBe(true);
  });

  test("isDrcRunActive covers every status", () => {
    expect(isDrcRunActive(null)).toBe(false);
    expect(isDrcRunActive(snapshot({ status: "queued" }))).toBe(true);
    expect(isDrcRunActive(snapshot({ status: "running" }))).toBe(true);
    expect(isDrcRunActive(snapshot({ status: "completed" }))).toBe(false);
    expect(isDrcRunActive(snapshot({ status: "cancelled" }))).toBe(false);
    expect(isDrcRunActive(snapshot({ status: "failed" }))).toBe(false);
  });
});
