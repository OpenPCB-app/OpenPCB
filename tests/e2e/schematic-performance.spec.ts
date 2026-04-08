import { expect, test, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";

type HarnessFixture =
  | "base"
  | "base-altered"
  | "drag-wiring"
  | "medium-hardening";

type PerfSeriesSnapshot = {
  count: number;
  dropped: number;
  p50: number | null;
  p95: number | null;
  median: number | null;
  samples: number[];
};

type PerfEnvironmentMetadata = {
  timestampIso: string;
  href: string;
  userAgent: string;
  platform: string;
  language: string;
  hardwareConcurrency: number | null;
  devicePixelRatio: number;
  viewport: {
    width: number;
    height: number;
  };
  webdriver: boolean;
};

type SchematicPerfSnapshot = {
  schemaVersion: "schematic-e2e-perf/v1";
  fixture: HarnessFixture;
  scenarioId: string;
  syntheticDelayMs: number;
  pointerToVisualLatencyMs: PerfSeriesSnapshot;
  panZoomFrameTimeMs: PerfSeriesSnapshot & {
    pan: PerfSeriesSnapshot;
    zoom: PerfSeriesSnapshot;
  };
  environment: PerfEnvironmentMetadata;
};

type SloThresholds = {
  pointerP95Ms: number;
  frameMedianMs: number;
};

type PerfEvidence = {
  schemaVersion: "schematic-e2e-performance-report/v1";
  status: "pass" | "fail";
  scenarioId: string;
  fixture: HarnessFixture;
  thresholds: SloThresholds;
  metrics: {
    pointerToVisualLatencyMs: {
      sampleCount: number;
      droppedSamples: number;
      p50: number | null;
      p95: number | null;
      pass: boolean;
      violation?: string;
    };
    panZoomFrameTimeMs: {
      sampleCount: number;
      droppedSamples: number;
      median: number | null;
      p95: number | null;
      pass: boolean;
      violation?: string;
      panSampleCount: number;
      zoomSampleCount: number;
    };
  };
  violations: string[];
  snapshot: SchematicPerfSnapshot;
};

type SchematicPerfApi = {
  reset: () => void;
  snapshot: (options?: { includeRawSamples?: boolean }) => SchematicPerfSnapshot;
  setSyntheticDelayMs: (delayMs: number) => void;
  getSyntheticDelayMs: () => number;
};

declare global {
  interface Window {
    __SCHEMATIC_E2E_PERF__?: SchematicPerfApi;
  }
}

const THRESHOLDS: SloThresholds = {
  pointerP95Ms: 40,
  frameMedianMs: 16.7,
};

const EVIDENCE_DIR = path.resolve(
  process.cwd(),
  ".sisyphus",
  "evidence",
);

async function writeEvidence(fileName: string, payload: PerfEvidence) {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, fileName),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

async function gotoMediumHarness(
  page: Page,
  scenarioId: string,
  perfDelayMs = 0,
) {
  const query = new URLSearchParams({
    e2e: "schematic",
    fixture: "medium-hardening",
    scenario: scenarioId,
  });

  if (perfDelayMs > 0) {
    query.set("perfDelayMs", String(perfDelayMs));
  }

  await page.goto(`/?${query.toString()}`);
  await expect(page.getByText("Schematic E2E")).toBeVisible();
  await expect(page.getByTestId("e2e-symbols")).toHaveText("500");
  await expect(page.getByTestId("e2e-wires")).toHaveText("1000");
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
}

async function resetPerfProbe(page: Page) {
  const ok = await page.evaluate(() => {
    const probe = window.__SCHEMATIC_E2E_PERF__;
    if (!probe) {
      return false;
    }

    probe.reset();
    return true;
  });

  if (!ok) {
    throw new Error("missing __SCHEMATIC_E2E_PERF__ probe");
  }
}

async function readPerfSnapshot(page: Page): Promise<SchematicPerfSnapshot> {
  const snapshot = await page.evaluate(() => {
    return window.__SCHEMATIC_E2E_PERF__?.snapshot({
      includeRawSamples: true,
    });
  });

  if (!snapshot) {
    throw new Error("failed to read schematic performance snapshot");
  }

  return snapshot;
}

async function runPointerDragLoop(page: Page, iterations = 10) {
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("missing schematic canvas bounds");
  }

  for (let index = 0; index < iterations; index += 1) {
    const startX = box.x + box.width * 0.28 + (index % 4) * 24;
    const startY = box.y + box.height * 0.35 + (index % 3) * 22;
    const endX = startX + 180;
    const endY = startY + (index % 2 === 0 ? 90 : -90);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(25);
  }
}

async function runPanAndZoomLoop(page: Page, iterations = 12) {
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.hover();

  for (let index = 0; index < iterations; index += 1) {
    await page.mouse.wheel(90, 120);
    await page.waitForTimeout(16);
  }

  await page.keyboard.down("Control");
  for (let index = 0; index < iterations; index += 1) {
    await page.mouse.wheel(0, index % 2 === 0 ? -140 : 140);
    await page.waitForTimeout(16);
  }
  await page.keyboard.up("Control");

  await page.waitForTimeout(300);
}

function buildEvidence(
  snapshot: SchematicPerfSnapshot,
  thresholds: SloThresholds,
): PerfEvidence {
  const pointerP95 = snapshot.pointerToVisualLatencyMs.p95;
  const frameMedian = snapshot.panZoomFrameTimeMs.median;

  const pointerPass =
    pointerP95 !== null && pointerP95 <= thresholds.pointerP95Ms;
  const framePass =
    frameMedian !== null && frameMedian <= thresholds.frameMedianMs;

  const violations: string[] = [];
  if (!pointerPass) {
    violations.push(
      `pointer p95 ${pointerP95 ?? "na"}ms > ${thresholds.pointerP95Ms}ms`,
    );
  }
  if (!framePass) {
    violations.push(
      `pan/zoom median ${frameMedian ?? "na"}ms > ${thresholds.frameMedianMs}ms`,
    );
  }

  return {
    schemaVersion: "schematic-e2e-performance-report/v1",
    status: violations.length === 0 ? "pass" : "fail",
    scenarioId: snapshot.scenarioId,
    fixture: snapshot.fixture,
    thresholds,
    metrics: {
      pointerToVisualLatencyMs: {
        sampleCount: snapshot.pointerToVisualLatencyMs.count,
        droppedSamples: snapshot.pointerToVisualLatencyMs.dropped,
        p50: snapshot.pointerToVisualLatencyMs.p50,
        p95: pointerP95,
        pass: pointerPass,
        violation: pointerPass ? undefined : violations[0],
      },
      panZoomFrameTimeMs: {
        sampleCount: snapshot.panZoomFrameTimeMs.count,
        droppedSamples: snapshot.panZoomFrameTimeMs.dropped,
        median: frameMedian,
        p95: snapshot.panZoomFrameTimeMs.p95,
        pass: framePass,
        violation: framePass
          ? undefined
          : violations.find((entry) => entry.startsWith("pan/zoom")),
        panSampleCount: snapshot.panZoomFrameTimeMs.pan.count,
        zoomSampleCount: snapshot.panZoomFrameTimeMs.zoom.count,
      },
    },
    violations,
    snapshot,
  };
}

test.describe("schematic canvas performance SLO", () => {
  test("medium fixture meets strict balanced latency/frame SLOs", async ({
    page,
  }) => {
    const scenarioId = "perf-medium-balanced-slo";
    await gotoMediumHarness(page, scenarioId);
    await resetPerfProbe(page);

    await runPointerDragLoop(page, 12);
    await runPanAndZoomLoop(page, 14);

    const snapshot = await readPerfSnapshot(page);
    const evidence = buildEvidence(snapshot, THRESHOLDS);
    await writeEvidence("task-4-performance.json", evidence);

    expect(snapshot.pointerToVisualLatencyMs.count).toBeGreaterThan(20);
    expect(snapshot.panZoomFrameTimeMs.count).toBeGreaterThan(20);
    expect(snapshot.panZoomFrameTimeMs.pan.count).toBeGreaterThan(10);
    expect(snapshot.panZoomFrameTimeMs.zoom.count).toBeGreaterThan(10);

    const pointerP95 = snapshot.pointerToVisualLatencyMs.p95;
    const frameMedian = snapshot.panZoomFrameTimeMs.median;

    expect(pointerP95).not.toBeNull();
    expect(frameMedian).not.toBeNull();
    expect(pointerP95!).toBeLessThanOrEqual(THRESHOLDS.pointerP95Ms);
    expect(frameMedian!).toBeLessThanOrEqual(THRESHOLDS.frameMedianMs);
    expect(evidence.status).toBe("pass");
  });

  test("negative mode flags SLO violation with artificial delay", async ({
    page,
  }) => {
    const scenarioId = "perf-medium-negative-delay";
    await gotoMediumHarness(page, scenarioId, 40);
    await resetPerfProbe(page);

    await runPointerDragLoop(page, 8);
    await runPanAndZoomLoop(page, 8);

    const snapshot = await readPerfSnapshot(page);
    const evidence = buildEvidence(snapshot, THRESHOLDS);
    await writeEvidence("task-4-performance-error.json", evidence);

    expect(snapshot.syntheticDelayMs).toBe(40);
    expect(evidence.status).toBe("fail");
    expect(evidence.violations.length).toBeGreaterThan(0);
    expect(
      (snapshot.pointerToVisualLatencyMs.p95 ?? 0) > THRESHOLDS.pointerP95Ms ||
        (snapshot.panZoomFrameTimeMs.median ?? 0) > THRESHOLDS.frameMedianMs,
    ).toBeTruthy();
  });
});
