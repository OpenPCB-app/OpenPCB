// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { DesignerSchematicProjection, DrcReport, DrcRunSnapshot, ErcReport } from "../../../../sdks";
import { useErcStore } from "../stores/erc-store";
import { useDrcStore } from "../pcb/drc/drc-store";
import { usePcbViewStore } from "../pcb/pcb-view-store";
import { DesignerErcView } from "./DesignerErcView";
import { DesignerDrcView } from "./DesignerDrcView";

const mocks = vi.hoisted(() => ({
  api: { runErc: vi.fn(), getDrcResult: vi.fn(), getPcbProjection: vi.fn() },
  start: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
}));
vi.mock("../api", () => ({ createDesignerApi: () => mocks.api }));
vi.mock("../pcb/drc/use-drc-run", () => ({
  useDrcRun: () => ({ start: mocks.start, cancel: mocks.cancel }),
}));
vi.mock("../pcb/use-pcb-design-rules-dialog", () => ({
  usePcbDesignRulesDialog: () => ({ available: false, open: vi.fn(), dialog: null }),
}));

function report(designId = "design-1", revision = 7): ErcReport {
  return { designId, revision, violations: [], summary: { errors: 0, warnings: 0, infos: 0 } };
}

function drcReport(designId = "design-1", revision = 7): DrcReport {
  return { ...report(designId, revision), violations: [], countsByCode: {} };
}

function snapshot(status: DrcRunSnapshot["status"] = "running"): DrcRunSnapshot {
  return {
    designId: "design-1", revision: 7, runId: "run-1", status,
    startedAt: "2026-10-22T12:00:00.000Z",
    progress: { stage: "queued", index: 0, total: 17, fraction: 0, violationsSoFar: 0 },
  };
}

function ercView(revision: number | null = 7): ReactElement {
  const projection: DesignerSchematicProjection | null = revision === null ? null : {
    designId: "design-1", revision, parts: [], wires: [], labels: [], primitives: [], junctions: [], nets: [],
  };
  return createElement(DesignerErcView, {
    moduleId: "designer", designId: "design-1", projection,
    onSelectOnCanvas: vi.fn(), onFrameBoundsMm: vi.fn(),
  });
}

function drcView(revision: number | null = 7): ReactElement {
  return createElement(DesignerDrcView, {
    moduleId: "designer", designId: "design-1", revision, onShowViolation: vi.fn(),
  });
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  useErcStore.getState().clear();
  useDrcStore.getState().clear();
  usePcbViewStore.setState((state) => ({ viewState: { ...state.viewState, drcWaivedViolationIds: [] } }));
  mocks.api.runErc.mockImplementation(() => new Promise<ErcReport>(() => {}));
  mocks.api.getDrcResult.mockResolvedValue(null);
  mocks.api.getPcbProjection.mockResolvedValue(null);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function render(view: ReactElement): Promise<void> {
  await act(async () => root.render(view));
  expect(host.innerHTML).not.toContain("status-success");
}

describe("truthful ERC results", () => {
  test("fresh empty results stay neutral and state limited scope", async () => {
    useErcStore.getState().setReport(report());
    await render(ercView());
    expect(host.textContent).toContain("No reported ERC violations");
    expect(host.textContent).toContain("does not certify electrical correctness");
  });

  test("revision changes and unavailable projections label history", async () => {
    useErcStore.getState().setReport(report());
    await render(ercView());
    await render(ercView(8));
    expect(host.textContent).toContain("the design changed");
    expect(host.textContent).toContain("Previous ERC report: no reported violations");
    await render(ercView(null));
    expect(host.textContent).toContain("current design revision is unavailable");
  });

  test("pending and failed reruns keep clearly marked history", async () => {
    useErcStore.getState().setReport(report());
    await render(ercView());
    let fail!: (reason: Error) => void;
    let pending!: Promise<void>;
    await act(async () => {
      pending = useErcStore.getState().run(() => new Promise<ErcReport>((_, reject) => { fail = reject; }));
    });
    expect(host.textContent).toContain("Showing the previous ERC report");
    expect(host.querySelector("button")?.disabled).toBe(true);
    await act(async () => { fail(new Error("ERC backend down")); await pending; });
    expect(host.textContent).toContain("ERC backend down");
    expect(host.textContent).toContain("Previous ERC report: no reported violations");
    expect(host.querySelector("button")?.disabled).toBe(false);
  });

  test("absent and wrong-design reports never display an empty result", async () => {
    useErcStore.getState().setReport(report("other-design"));
    await render(ercView());
    expect(host.textContent).not.toContain("No reported");
    expect(host.textContent).not.toContain("Previous ERC report");
    expect(host.textContent).toContain("Running…");
  });

  test("unsupported metadata findings remain visible with severity", async () => {
    useErcStore.getState().setReport({
      ...report(), summary: { errors: 1, warnings: 0, infos: 0 },
      violations: [{ code: "PIN_TYPE_UNKNOWN", severity: "error", message: "Unsupported pin electrical metadata", anchors: [] }],
    });
    await render(ercView());
    expect(host.textContent).toContain("Unsupported pin electrical metadata");
    expect(host.textContent).not.toContain("No reported ERC violations");
    expect(host.innerHTML).toContain("bg-drc-error");
  });
});

describe("truthful DRC results", () => {
  test("fresh empty reports stay neutral and state limited scope", async () => {
    useDrcStore.getState().setReport(drcReport());
    await render(drcView());
    expect(host.textContent).toContain("No reported DRC violations");
    expect(host.textContent).toContain("does not certify board manufacturability");
  });

  test("stale and unknown-revision reports are history", async () => {
    useDrcStore.getState().setReport(drcReport());
    await render(drcView(8));
    expect(host.textContent).toContain("the design changed");
    expect(host.textContent).toContain("Previous DRC report");
    await render(drcView(null));
    expect(host.textContent).toContain("current design revision is unavailable");
  });

  test.each(["running", "failed", "cancelled"] as const)("%s run keeps a previous report label", async (status) => {
    useDrcStore.getState().setReport(drcReport());
    useDrcStore.getState().beginRun(snapshot());
    if (status === "failed") useDrcStore.getState().failRun("worker crashed");
    if (status === "cancelled") useDrcStore.getState().cancelRun("user");
    await render(drcView());
    expect(host.textContent).toContain("Showing the previous DRC report");
    expect(host.textContent).toContain("Previous DRC report: no unwaived reported violations");
    if (status === "failed") expect(host.textContent).toContain("worker crashed");
    if (status === "cancelled") expect(host.textContent).toContain("Run cancelled");
    expect(host.querySelector("button")?.disabled).toBe(status === "running");
  });

  test("pending start disables the run button and labels prior report", async () => {
    useDrcStore.getState().setReport(drcReport());
    useDrcStore.getState().beginStart();
    await render(drcView());
    expect(host.textContent).toContain("Starting…");
    expect(host.textContent).toContain("Showing the previous DRC report");
    expect(host.querySelector("button")?.disabled).toBe(true);
  });

  test("absent and wrong-design reports have no empty result", async () => {
    useDrcStore.getState().setReport(drcReport("other-design"));
    await render(drcView());
    expect(host.textContent).not.toContain("No reported DRC violations");
    expect(host.textContent).not.toContain("Previous DRC report");
  });

  test("waiving every finding does not claim that no violations exist", async () => {
    useDrcStore.getState().setReport({
      ...drcReport(),
      violations: [{ id: "v1", code: "KEEPOUT_VIOLATION", ruleClass: "constraint", severity: "error", message: "Trace inside keepout", anchors: [] }],
    });
    usePcbViewStore.setState((state) => ({ viewState: { ...state.viewState, drcWaivedViolationIds: ["v1"] } }));
    await render(drcView());
    expect(host.textContent).toContain("No unwaived reported DRC violations");
    expect(host.textContent).toContain("1 reported violation is waived");
    expect(host.textContent).not.toContain("No reported DRC violations");
  });

  test.each(["NET_SHORT_CIRCUIT", "DRC_RULE_INVALID"] as const)("%s ignores forged stored waivers", async (code) => {
    useDrcStore.getState().setReport({
      ...drcReport(), summary: { errors: 1, warnings: 0, infos: 0 },
      violations: [{ id: "critical", code, ruleClass: "constraint", severity: "error", message: "Safety-critical finding remains", anchors: [] }],
    });
    usePcbViewStore.setState((state) => ({ viewState: { ...state.viewState, drcWaivedViolationIds: ["critical"] } }));
    await render(drcView());
    expect(host.textContent).toContain("Safety-critical finding remains");
    expect(host.querySelector('[title="Toggle error"]')?.textContent).toBe("1");
    expect(host.querySelector('[title="Un-waive"]')).toBeNull();
    expect(host.querySelector('[title="Waive (accept)"]')).toBeNull();
    expect(host.textContent).not.toContain("No unwaived reported DRC violations");
  });
});
