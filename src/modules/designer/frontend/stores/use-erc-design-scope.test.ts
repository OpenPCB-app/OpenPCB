// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ErcReport } from "../../../../sdks";
import { useErcStore } from "./erc-store";
import { useErcDesignScope } from "./use-erc-design-scope";

function report(designId: string): ErcReport {
  return {
    designId,
    revision: 1,
    violations: [],
    summary: { errors: 0, warnings: 0, infos: 0 },
  };
}

interface ViewProps {
  designId: string;
  runner: () => Promise<ErcReport>;
}

function ErcChild({ designId, runner }: ViewProps) {
  useEffect(() => {
    const state = useErcStore.getState();
    if (state.running || state.report?.designId === designId) return;
    void state.run(runner);
  }, [designId, runner]);
  return null;
}

function Workspace(props: ViewProps) {
  useErcDesignScope(props.designId);
  return createElement(ErcChild, props);
}

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useErcStore.getState().clear();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

test("opening the ERC panel does not invalidate its automatic run", async () => {
  await act(async () => {
    root.render(
      createElement(Workspace, {
        designId: "a",
        runner: async () => report("a"),
      }),
    );
  });
  expect(useErcStore.getState().report?.designId).toBe("a");
});

test("switching designs starts the new run before the old result arrives", async () => {
  let finishOld!: (value: ErcReport) => void;
  const old = new Promise<ErcReport>((resolve) => {
    finishOld = resolve;
  });
  await act(async () => {
    root.render(createElement(Workspace, { designId: "a", runner: () => old }));
  });
  await act(async () => {
    root.render(
      createElement(Workspace, {
        designId: "b",
        runner: async () => report("b"),
      }),
    );
  });
  await act(async () => {
    finishOld(report("a"));
  });
  expect(useErcStore.getState().report?.designId).toBe("b");
  expect(useErcStore.getState().running).toBe(false);
});
