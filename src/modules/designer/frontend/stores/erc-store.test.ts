import { beforeEach, describe, expect, test } from "vitest";
import type { ErcReport } from "../../../../sdks";
import { ercIssueCount, useErcStore } from "./erc-store";

function report(overrides: Partial<ErcReport> = {}): ErcReport {
  return {
    designId: "design-1",
    revision: 7,
    violations: [
      {
        code: "UNCONNECTED_INPUT_PIN",
        severity: "warning",
        message: "Pin U1.3 (input) is not connected to any net",
        anchors: [{ kind: "pin", pinId: "u1:3" }],
      },
      {
        code: "OUTPUT_OUTPUT_SHORT",
        severity: "error",
        message: 'Net "N1" drives 2 output pins together',
        anchors: [{ kind: "net", netId: "n1" }],
      },
    ],
    summary: { errors: 1, warnings: 1, infos: 3 },
    ...overrides,
  };
}

function deferredReport() {
  let resolve!: (value: ErcReport) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ErcReport>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("erc-store", () => {
  beforeEach(() => {
    useErcStore.getState().clear();
  });

  test("starts empty", () => {
    const state = useErcStore.getState();
    expect(state.report).toBeNull();
    expect(state.running).toBe(false);
    expect(state.error).toBeNull();
    expect(state.selectedIndex).toBeNull();
  });

  test("setReport stores the report and drops the focused row", () => {
    useErcStore.getState().select(1);
    useErcStore.getState().setReport(report());
    expect(useErcStore.getState().report?.designId).toBe("design-1");
    expect(useErcStore.getState().selectedIndex).toBeNull();
  });

  test("select focuses a violation index", () => {
    useErcStore.getState().setReport(report());
    useErcStore.getState().select(1);
    expect(useErcStore.getState().selectedIndex).toBe(1);
    useErcStore.getState().select(null);
    expect(useErcStore.getState().selectedIndex).toBeNull();
  });

  test("clear resets every field", () => {
    useErcStore.getState().setReport(report());
    useErcStore.getState().select(0);
    useErcStore.getState().clear();
    expect(useErcStore.getState()).toMatchObject({
      report: null,
      running: false,
      error: null,
      selectedIndex: null,
    });
  });

  test("run stores the report the runner resolves", async () => {
    await useErcStore.getState().run(async () => report());
    expect(useErcStore.getState().report?.revision).toBe(7);
    expect(useErcStore.getState().running).toBe(false);
    expect(useErcStore.getState().error).toBeNull();
  });

  test("a failing run surfaces the message and leaves the report alone", async () => {
    useErcStore.getState().setReport(report());
    await useErcStore.getState().run(async () => {
      throw new Error("boom");
    });
    expect(useErcStore.getState().error).toBe("boom");
    expect(useErcStore.getState().running).toBe(false);
    expect(useErcStore.getState().report?.designId).toBe("design-1");
    expect(useErcStore.getState().reportIsPrevious).toBe(true);
  });

  test("a missing result preserves the previous report as history", async () => {
    const previous = report();
    useErcStore.getState().setReport(previous);
    await useErcStore.getState().run(async () => null);
    expect(useErcStore.getState()).toMatchObject({
      report: previous,
      reportIsPrevious: true,
      running: false,
      error: "ERC report unavailable",
    });
  });

  test("a report for another design cannot replace the requested report", async () => {
    const previous = report();
    useErcStore.getState().setReport(previous);
    await useErcStore.getState().run(async () => report({ designId: "design-2" }), "design-1");
    expect(useErcStore.getState().report).toBe(previous);
    expect(useErcStore.getState().error).toBe("ERC report does not match the requested design");
  });

  test("a new run marks the retained report as previous until success", async () => {
    useErcStore.getState().setReport(report());
    const next = deferredReport();
    const pending = useErcStore.getState().run(() => next.promise);
    expect(useErcStore.getState().reportIsPrevious).toBe(true);
    next.resolve(report({ revision: 8 }));
    await pending;
    expect(useErcStore.getState().reportIsPrevious).toBe(false);
  });

  test("run is ignored while another run is in flight", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = useErcStore.getState().run(async () => {
      await gate;
      return report();
    });
    await useErcStore.getState().run(async () => report({ revision: 99 }));
    expect(useErcStore.getState().report).toBeNull();
    release?.();
    await first;
    expect(useErcStore.getState().report?.revision).toBe(7);
  });

  test("the badge count is errors + warnings, never infos", () => {
    expect(ercIssueCount(null)).toBe(0);
    expect(ercIssueCount(report())).toBe(2);
    expect(
      ercIssueCount(report({ summary: { errors: 0, warnings: 0, infos: 9 } })),
    ).toBe(0);
  });

  test("a cleared run cannot overwrite the next design's report", async () => {
    const old = deferredReport();
    const pending = useErcStore.getState().run(() => old.promise);
    useErcStore.getState().clear();
    const current = report({ designId: "design-2" });
    await useErcStore.getState().run(async () => current);
    old.resolve(report());
    await pending;
    expect(useErcStore.getState().report).toEqual(current);
  });

  test("a cleared rejection cannot end or fail the current run", async () => {
    const old = deferredReport();
    const first = useErcStore.getState().run(() => old.promise);
    useErcStore.getState().clear();
    const current = deferredReport();
    const second = useErcStore.getState().run(() => current.promise);
    old.reject(new Error("obsolete failure"));
    await first;
    expect(useErcStore.getState()).toMatchObject({ running: true, error: null });
    current.resolve(report({ designId: "design-2" }));
    await second;
    expect(useErcStore.getState().report?.designId).toBe("design-2");
  });

  test("an explicit replacement supersedes an in-flight run", async () => {
    const old = deferredReport();
    const pending = useErcStore.getState().run(() => old.promise);
    const replacement = report({ revision: 9 });
    useErcStore.getState().setReport(replacement);
    expect(useErcStore.getState().running).toBe(false);
    old.resolve(report());
    await pending;
    expect(useErcStore.getState().report).toEqual(replacement);
  });

  test("an accepted run drops selection from the previous report", async () => {
    useErcStore.getState().setReport(report());
    useErcStore.getState().select(1);
    await useErcStore.getState().run(async () => report({ violations: [] }));
    expect(useErcStore.getState().selectedIndex).toBeNull();
  });
});
