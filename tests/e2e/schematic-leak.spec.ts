import {
    expect,
    test,
    type CDPSession,
    type Locator,
    type Page,
    type TestInfo,
} from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const FIXTURE_URL = "/?e2e=schematic&fixture=medium-hardening";
const WARMUP_MS = 2 * 60_000;
const RUN_DURATION_MS = 10 * 60_000;
const SAMPLE_INTERVAL_MS = 5_000;
const MAX_POST_WARMUP_DELTA_MB = 15;
const MAX_SLOPE_MB_PER_MIN = 1.0;

const NEGATIVE_WARMUP_MS = 30_000;
const NEGATIVE_RUN_DURATION_MS = 3 * 60_000;

const MB = 1024 * 1024;

type CdpMetric = {
    name: string;
    value: number;
};

type MemorySample = {
    timestampMs: number;
    elapsedMs: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    nodes: number;
};

type LeakAnalysis = {
    postWarmupSampleCount: number;
    postWarmupDeltaMb: number;
    slopeMbPerMin: number;
    gatePassed: boolean;
    failures: string[];
};

type LeakReport = {
    fixture: "medium-hardening";
    mode: "normal" | "synthetic-leak";
    thresholds: {
        postWarmupDeltaMb: number;
        slopeMbPerMin: number;
    };
    timings: {
        runDurationMs: number;
        warmupMs: number;
        sampleIntervalMs: number;
    };
    samples: MemorySample[];
    analysis: LeakAnalysis;
};

type LeakRunOptions = {
    runDurationMs: number;
    warmupMs: number;
    sampleIntervalMs: number;
    injectSyntheticLeak: boolean;
};

function toMb(bytes: number): number {
    return bytes / MB;
}

function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function computeSlopeMbPerMin(samples: MemorySample[]): number {
    if (samples.length < 2) {
        return 0;
    }

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (const sample of samples) {
        const x = sample.elapsedMs / 60_000;
        const y = toMb(sample.heapUsedBytes);
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
    }

    const count = samples.length;
    const denominator = count * sumXX - sumX * sumX;
    if (denominator === 0) {
        return 0;
    }

    return (count * sumXY - sumX * sumY) / denominator;
}

async function writeLeakArtifact(
    testInfo: TestInfo,
    fileName: string,
    report: LeakReport,
): Promise<void> {
    const artifactPath = path.join(process.cwd(), ".sisyphus", "evidence", fileName);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await testInfo.attach(fileName, {
        path: artifactPath,
        contentType: "application/json",
    });
}

function readMetricValue(metrics: CdpMetric[], name: string): number | null {
    const value = metrics.find((metric) => metric.name === name)?.value;
    if (typeof value !== "number") {
        return null;
    }
    return value;
}

async function sampleHeap(
    page: Page,
    cdp: CDPSession,
    startedAt: number,
): Promise<MemorySample> {
    await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(50);
    const heap = await cdp.send("Runtime.getHeapUsage");
    const result = await cdp.send("Performance.getMetrics");

    const metrics = result.metrics as CdpMetric[];
    const timestampMs = Date.now();
    const nodes = readMetricValue(metrics, "Nodes") ?? 0;

    return {
        timestampMs,
        elapsedMs: timestampMs - startedAt,
        heapUsedBytes: heap.usedSize,
        heapTotalBytes: heap.totalSize,
        nodes,
    };
}

async function readCanvasPoint(page: Page, testId: string): Promise<{ x: number; y: number }> {
    const text = await page.getByTestId(testId).textContent();
    if (!text) {
        throw new Error(`Missing ${testId} text`);
    }
    const [x, y] = text.split(",").map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`Invalid ${testId} point: ${text}`);
    }
    return { x, y };
}

async function dragSymbol(
    page: Page,
    canvas: Locator,
    box: { x: number; y: number },
    source: { x: number; y: number },
    delta: { x: number; y: number },
): Promise<void> {
    const startX = box.x + source.x;
    const startY = box.y + source.y;
    const moveX = startX + delta.x;
    const moveY = startY + delta.y;

    await canvas.dispatchEvent("mousemove", {
        clientX: startX,
        clientY: startY,
        button: 0,
        buttons: 0,
    });
    await canvas.dispatchEvent("mousedown", {
        clientX: startX,
        clientY: startY,
        button: 0,
        buttons: 1,
    });
    await page.waitForTimeout(25);
    await canvas.dispatchEvent("mousemove", {
        clientX: startX,
        clientY: startY + 10,
        button: 0,
        buttons: 1,
    });
    await page.waitForTimeout(25);
    await canvas.dispatchEvent("mousemove", {
        clientX: moveX,
        clientY: moveY,
        button: 0,
        buttons: 1,
    });
    await page.waitForTimeout(25);
    await canvas.dispatchEvent("mouseup", {
        clientX: moveX,
        clientY: moveY,
        button: 0,
        buttons: 0,
    });
}

async function panCanvas(
    canvas: Locator,
    box: { x: number; y: number; width: number; height: number },
): Promise<void> {
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await canvas.dispatchEvent("mousedown", {
        clientX: startX,
        clientY: startY,
        button: 1,
        buttons: 4,
    });
    await canvas.dispatchEvent("mousemove", {
        clientX: startX + 24,
        clientY: startY + 16,
        button: 1,
        buttons: 4,
    });
    await canvas.dispatchEvent("mouseup", {
        clientX: startX + 24,
        clientY: startY + 16,
        button: 1,
        buttons: 0,
    });
}

async function zoomCanvas(
    canvas: Locator,
    box: { x: number; y: number; width: number; height: number },
    zoomIn: boolean,
): Promise<void> {
    await canvas.dispatchEvent("wheel", {
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height / 2,
        deltaY: zoomIn ? -120 : 120,
        deltaX: 0,
        deltaMode: 0,
        ctrlKey: true,
    });
}

async function injectSyntheticLeak(page: Page): Promise<void> {
    await page.evaluate(() => {
        const root = window as unknown as { __e2eSyntheticLeak?: ArrayBuffer[] };
        if (!root.__e2eSyntheticLeak) {
            root.__e2eSyntheticLeak = [];
        }

        root.__e2eSyntheticLeak.push(new ArrayBuffer(512 * 1024));
    });
}

function analyzeLeak(samples: MemorySample[], warmupMs: number): LeakAnalysis {
    const postWarmup = samples.filter((sample) => sample.elapsedMs >= warmupMs);
    if (postWarmup.length < 2) {
        throw new Error(
            `Insufficient post-warmup samples: ${postWarmup.length}; need at least 2`,
        );
    }

    const first = postWarmup[0]!;
    const last = postWarmup[postWarmup.length - 1]!;
    const postWarmupDeltaMb = toMb(last.heapUsedBytes - first.heapUsedBytes);
    const slopeMbPerMin = computeSlopeMbPerMin(postWarmup);
    const failures: string[] = [];

    if (postWarmupDeltaMb > MAX_POST_WARMUP_DELTA_MB) {
        failures.push(
            `post-warmup heap delta ${round3(postWarmupDeltaMb)} MB exceeds ${MAX_POST_WARMUP_DELTA_MB} MB`,
        );
    }

    if (slopeMbPerMin > MAX_SLOPE_MB_PER_MIN) {
        failures.push(
            `heap slope ${round3(slopeMbPerMin)} MB/min exceeds ${MAX_SLOPE_MB_PER_MIN} MB/min`,
        );
    }

    return {
        postWarmupSampleCount: postWarmup.length,
        postWarmupDeltaMb: round3(postWarmupDeltaMb),
        slopeMbPerMin: round3(slopeMbPerMin),
        gatePassed: failures.length === 0,
        failures,
    };
}

async function runStressLeakScenario(
    page: Page,
    options: LeakRunOptions,
): Promise<LeakReport> {
    await page.goto(FIXTURE_URL);
    await expect(page.getByText("Schematic E2E")).toBeVisible();
    await expect(page.getByTestId("e2e-symbols")).toHaveText("500");
    await expect(page.getByTestId("e2e-wires")).toHaveText("1000");

    const canvas = page.getByTestId("schematic-canvas");
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) {
        throw new Error("missing canvas bounds");
    }

    const startedAt = Date.now();
    const samples: MemorySample[] = [];
    let nextSampleAt = startedAt;
    let iteration = 0;

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");

    try {
        while (Date.now() - startedAt < options.runDurationMs) {
            const symbol1 = await readCanvasPoint(page, "e2e-symbol1");
            const symbol2 = await readCanvasPoint(page, "e2e-symbol2");

            await panCanvas(canvas, canvasBox);
            await zoomCanvas(canvas, canvasBox, true);
            await zoomCanvas(canvas, canvasBox, false);
            await canvas.click({ position: symbol2 });

            const dragDeltaY = iteration % 2 === 0 ? 30 : -30;
            await dragSymbol(
                page,
                canvas,
                { x: canvasBox.x, y: canvasBox.y },
                symbol1,
                { x: 0, y: dragDeltaY },
            );

            if (options.injectSyntheticLeak) {
                await injectSyntheticLeak(page);
            }

            const now = Date.now();
            if (now >= nextSampleAt) {
                samples.push(await sampleHeap(page, cdp, startedAt));
                nextSampleAt += options.sampleIntervalMs;
            }

            iteration += 1;
        }

        samples.push(await sampleHeap(page, cdp, startedAt));
    } finally {
        await cdp.detach();
    }

    const analysis = analyzeLeak(samples, options.warmupMs);

    return {
        fixture: "medium-hardening",
        mode: options.injectSyntheticLeak ? "synthetic-leak" : "normal",
        thresholds: {
            postWarmupDeltaMb: MAX_POST_WARMUP_DELTA_MB,
            slopeMbPerMin: MAX_SLOPE_MB_PER_MIN,
        },
        timings: {
            runDurationMs: options.runDurationMs,
            warmupMs: options.warmupMs,
            sampleIntervalMs: options.sampleIntervalMs,
        },
        samples,
        analysis,
    };
}

test.describe.configure({ mode: "serial" });

test.describe("schematic canvas leak gate", () => {
    test("10-minute stress run stays below leak threshold", async ({ page, browserName }, testInfo) => {
        test.skip(browserName !== "chromium", "CDP memory metrics require Chromium");
        test.setTimeout(13 * 60_000);

        const report = await runStressLeakScenario(page, {
            runDurationMs: RUN_DURATION_MS,
            warmupMs: WARMUP_MS,
            sampleIntervalMs: SAMPLE_INTERVAL_MS,
            injectSyntheticLeak: false,
        });
        await writeLeakArtifact(testInfo, "task-5-leak.json", report);

        expect(report.analysis.postWarmupDeltaMb).toBeLessThanOrEqual(
            MAX_POST_WARMUP_DELTA_MB,
        );
        expect(report.analysis.slopeMbPerMin).toBeLessThanOrEqual(
            MAX_SLOPE_MB_PER_MIN,
        );
        expect(report.analysis.gatePassed).toBe(true);
    });

    test("negative mode detects synthetic leak and fails gate", async ({ page, browserName }, testInfo) => {
        test.skip(browserName !== "chromium", "CDP memory metrics require Chromium");
        test.setTimeout(5 * 60_000);

        const report = await runStressLeakScenario(page, {
            runDurationMs: NEGATIVE_RUN_DURATION_MS,
            warmupMs: NEGATIVE_WARMUP_MS,
            sampleIntervalMs: SAMPLE_INTERVAL_MS,
            injectSyntheticLeak: true,
        });
        await writeLeakArtifact(testInfo, "task-5-leak-error.json", report);

        expect(report.analysis.gatePassed).toBe(false);
        expect(report.analysis.failures.length).toBeGreaterThan(0);
        expect(
            report.analysis.postWarmupDeltaMb > MAX_POST_WARMUP_DELTA_MB ||
                report.analysis.slopeMbPerMin > MAX_SLOPE_MB_PER_MIN,
        ).toBe(true);
    });
});
