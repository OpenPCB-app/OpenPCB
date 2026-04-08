import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ComponentPalette } from "@/components/pcb/palette/ComponentPalette";
import { FloatingPropertiesPopover } from "@/components/pcb/properties/FloatingPropertiesPopover";
import {
  useSchematicInteractionController,
  type SchematicInteractionController,
} from "@/components/pcb/useSchematicInteractionController";
import { SchematicCanvasR3F as SchematicCanvas } from "@/lib/render-engine/adapters/SchematicCanvasR3F";
import { createHitTestCache } from "@/components/pcb/canvas/hit-test";
import { collectDirectlyAttachedPinIds } from "@/components/pcb/canvas/wires";
import { useSchematicStore } from "@/stores/schematic-store";
import type { Point, SchematicDocument } from "@/components/pcb/types";
import mediumHardeningFixture from "../../../tests/e2e/fixtures/medium-hardening.json";
import mediumHardeningManifest from "../../../tests/e2e/fixtures/medium-hardening-manifest.json";

type HarnessFixture =
  | "base"
  | "base-altered"
  | "drag-wiring"
  | "medium-hardening";

type SerializableValue =
  | null
  | boolean
  | number
  | string
  | SerializableValue[]
  | { [key: string]: SerializableValue };

type FixtureManifest = {
  viewportSeed?: {
    offsetX: number;
    offsetY: number;
    zoom: number;
  };
};

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

type PerfSnapshotOptions = {
  includeRawSamples?: boolean;
};

type SchematicPerfApi = {
  reset: () => void;
  snapshot: (options?: PerfSnapshotOptions) => SchematicPerfSnapshot;
  setSyntheticDelayMs: (delayMs: number) => void;
  getSyntheticDelayMs: () => number;
};

declare global {
  interface Window {
    __SCHEMATIC_E2E_PERF__?: SchematicPerfApi;
  }
}

const PERF_SAMPLE_LIMIT = 8_192;
const WHEEL_CAPTURE_WINDOW_MS = 220;

const DEFAULT_VIEWPORT = { offsetX: 200, offsetY: 150, zoom: 1 / 12_700 };

type R3fCanvasState = {
  camera?: {
    position: {
      x: number;
      y: number;
    };
    zoom: number;
  };
  size?: {
    width: number;
    height: number;
  };
};

type R3fCanvasElement = HTMLCanvasElement & {
  __r3f?: {
    root?: {
      getState?: () => R3fCanvasState;
    };
  };
};

function projectWorldToR3fScreen(point: Point): Point | null {
  if (typeof document === "undefined") {
    return null;
  }

  const host = document.querySelector<HTMLElement>(
    '[data-testid="schematic-canvas"]',
  );
  const canvas = host?.querySelector("canvas") as R3fCanvasElement | null;
  const state = canvas?.__r3f?.root?.getState?.();
  const camera = state?.camera;
  const size = state?.size;

  if (
    !camera ||
    !size ||
    !Number.isFinite(camera.zoom) ||
    camera.zoom === 0 ||
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height)
  ) {
    return null;
  }

  const xScene = point.x / 1_000_000;
  const yScene = point.y / 1_000_000;

  return {
    x: (xScene - camera.position.x) * camera.zoom + size.width / 2,
    y: (camera.position.y - yScene) * camera.zoom + size.height / 2,
  };
}

function projectWorldToDefaultR3fScreen(point: Point): Point {
  const xScene = point.x / 1_000_000;
  const yScene = point.y / 1_000_000;
  const DEFAULT_CANVAS_WIDTH = 800;
  const DEFAULT_CANVAS_HEIGHT = 600;
  const DEFAULT_CAMERA_ZOOM = 50;

  return {
    x: xScene * DEFAULT_CAMERA_ZOOM + DEFAULT_CANVAS_WIDTH / 2,
    y: -yScene * DEFAULT_CAMERA_ZOOM + DEFAULT_CANVAS_HEIGHT / 2,
  };
}

const BASE_FIXTURE: SchematicDocument = {
  id: "e2e-doc-1",
  projectId: "project-e2e",
  updatedAt: "2026-03-31T00:00:00Z",
  version: 1,
  formatVersion: "pcb.schematic-project-document/v1",
  name: "E2E schematic",
  revision: 1,
  symbols: [
    {
      id: "symbol-1",
      entityType: "symbol",
      symbolKind: "resistor",
      reference: "R1",
      value: "10k",
      position: { x: 0, y: 0 },
      rotation: 0,
      mirrored: false,
      pins: [
        { id: "pin-1", name: "1", position: { x: 0, y: 0 } },
        { id: "pin-2", name: "2", position: { x: 1_270_000, y: 0 } },
      ],
      properties: {
        Footprint: "R_0603",
        Tolerance: "1%",
      },
    },
    {
      id: "symbol-2",
      entityType: "symbol",
      symbolKind: "connector",
      reference: "J1",
      value: "HDR2",
      position: { x: 1_905_000, y: 635_000 },
      rotation: 0,
      mirrored: false,
      pins: [
        { id: "pin-3", name: "1", position: { x: 0, y: 635_000 } },
        { id: "pin-4", name: "2", position: { x: 0, y: -635_000 } },
      ],
      properties: {
        Footprint: "PinHeader_1x02",
      },
    },
  ],
  wires: [],
  labels: [],
};

const BASE_ALTERED_FIXTURE: SchematicDocument = {
  ...BASE_FIXTURE,
  labels: [
    {
      id: "label-alt-1",
      entityType: "label",
      text: "ALT_NET",
      position: { x: -5_080_000, y: -5_080_000 },
      rotation: 0,
      net: "ALT_NET",
    },
  ],
};

const DRAG_WIRING_FIXTURE: SchematicDocument = {
  ...BASE_FIXTURE,
  symbols: [
    BASE_FIXTURE.symbols[0]!,
    BASE_FIXTURE.symbols[1]!,
    {
      id: "symbol-3",
      entityType: "symbol",
      symbolKind: "connector",
      reference: "J2",
      value: "HDR2",
      position: { x: 3_810_000, y: 0 },
      rotation: 0,
      mirrored: false,
      pins: [
        { id: "pin-5", name: "1", position: { x: 0, y: 0 } },
        { id: "pin-6", name: "2", position: { x: 1_270_000, y: 0 } },
      ],
      properties: {
        Footprint: "PinHeader_1x02",
      },
    },
  ],
  wires: [
    {
      id: "wire-1",
      entityType: "wire",
      position: { x: 1_270_000, y: 0 },
      rotation: 0,
      sourcePinId: "pin-2",
      targetPinId: "pin-3",
      points: [
        { x: 1_270_000, y: 0 },
        { x: 1_905_000, y: 0 },
        { x: 1_905_000, y: 1_270_000 },
      ],
    },
    {
      id: "wire-2",
      entityType: "wire",
      position: { x: 1_905_000, y: 0 },
      rotation: 0,
      sourcePinId: "pin-4",
      targetPinId: "pin-5",
      points: [
        { x: 1_905_000, y: 0 },
        { x: 2_857_500, y: 0 },
        { x: 3_810_000, y: 0 },
      ],
    },
  ],
};

const MEDIUM_HARDENING_FIXTURE =
  mediumHardeningFixture as unknown as SchematicDocument;
const MEDIUM_HARDENING_MANIFEST = mediumHardeningManifest as FixtureManifest;
const MEDIUM_HARDENING_VIEWPORT =
  MEDIUM_HARDENING_MANIFEST.viewportSeed ?? DEFAULT_VIEWPORT;

const FIXTURES: Record<HarnessFixture, SchematicDocument> = {
  base: BASE_FIXTURE,
  "base-altered": BASE_ALTERED_FIXTURE,
  "drag-wiring": DRAG_WIRING_FIXTURE,
  "medium-hardening": MEDIUM_HARDENING_FIXTURE,
};

const FIXTURE_VIEWPORTS: Record<
  HarnessFixture,
  { offsetX: number; offsetY: number; zoom: number }
> = {
  base: DEFAULT_VIEWPORT,
  "base-altered": DEFAULT_VIEWPORT,
  "drag-wiring": DEFAULT_VIEWPORT,
  "medium-hardening": MEDIUM_HARDENING_VIEWPORT,
};

function getHarnessFixture(): HarnessFixture {
  if (typeof window === "undefined") {
    return "base";
  }

  const fixture = new URLSearchParams(window.location.search).get("fixture");
  if (fixture === "drag-wiring") {
    return "drag-wiring";
  }

  if (fixture === "medium-hardening") {
    return "medium-hardening";
  }

  if (fixture === "base-altered") {
    return "base-altered";
  }

  return "base";
}

function getHarnessSeed(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const seed = new URLSearchParams(window.location.search).get("seed")?.trim();
  return seed && seed.length > 0 ? seed : null;
}

function getHarnessScenarioId(defaultScenarioId: string): string {
  if (typeof window === "undefined") {
    return defaultScenarioId;
  }

  const scenario =
    new URLSearchParams(window.location.search).get("scenario")?.trim() ?? "";
  return scenario.length > 0 ? scenario : defaultScenarioId;
}

function getHarnessPerfDelayMs(): number {
  if (typeof window === "undefined") {
    return 0;
  }

  const raw = new URLSearchParams(window.location.search)
    .get("perfDelayMs")
    ?.trim();
  if (!raw) {
    return 0;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return parsed;
}

function toRoundedMs(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function appendSample(
  samples: number[],
  value: number,
  limit = PERF_SAMPLE_LIMIT,
) {
  if (samples.length >= limit) {
    return false;
  }

  samples.push(toRoundedMs(value));
  return true;
}

function percentile(samples: readonly number[], p: number): number | null {
  if (samples.length === 0) {
    return null;
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  const value = sorted[Math.min(rank, sorted.length - 1)];
  return value === undefined ? null : toRoundedMs(value);
}

function summarizeSeries(
  samples: readonly number[],
  dropped: number,
  includeRawSamples: boolean,
): PerfSeriesSnapshot {
  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  return {
    count: samples.length,
    dropped,
    p50,
    p95,
    median: p50,
    samples: includeRawSamples ? [...samples] : [],
  };
}

function readEnvironmentMetadata(): PerfEnvironmentMetadata {
  return {
    timestampIso: new Date().toISOString(),
    href: window.location.href,
    userAgent: window.navigator.userAgent,
    platform: window.navigator.platform,
    language: window.navigator.language,
    hardwareConcurrency:
      typeof window.navigator.hardwareConcurrency === "number"
        ? window.navigator.hardwareConcurrency
        : null,
    devicePixelRatio: window.devicePixelRatio,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    webdriver: window.navigator.webdriver,
  };
}

function createSeededGenerator(seed: string): () => number {
  let state = 0;
  for (let index = 0; index < seed.length; index += 1) {
    state = (Math.imul(31, state) + seed.charCodeAt(index)) >>> 0;
  }

  if (state === 0) {
    state = 0x9e3779b9;
  }

  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function createDeterministicRandomUuid(seed: string): () => string {
  const random = createSeededGenerator(seed);

  return () => {
    const bytes = new Uint8Array(16);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(random() * 256);
    }

    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;

    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  };
}

function installDeterministicUuidGenerator(seed: string): () => void {
  const randomUuid = createDeterministicRandomUuid(seed);
  const cryptoObject = globalThis.crypto as Crypto & {
    randomUUID: () => string;
  };
  const originalRandomUuid = cryptoObject.randomUUID.bind(cryptoObject);

  Object.defineProperty(cryptoObject, "randomUUID", {
    configurable: true,
    value: () => randomUuid(),
  });

  return () => {
    Object.defineProperty(cryptoObject, "randomUUID", {
      configurable: true,
      value: originalRandomUuid,
    });
  };
}

const HARNESS_SEED = getHarnessSeed();

function withHarnessDeterministicUuidSeed<T>(
  seedScope: string,
  action: () => T,
): T {
  if (!HARNESS_SEED) {
    return action();
  }

  const uninstall = installDeterministicUuidGenerator(
    `${HARNESS_SEED}:${seedScope}`,
  );
  try {
    return action();
  } finally {
    uninstall();
  }
}

function stableSerialize(value: SerializableValue): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableSerialize(entryValue)}`,
    )
    .join(",")}}`;
}

async function sha256Hex(payload: string): Promise<string> {
  const encoded = new TextEncoder().encode(payload);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function waitForStoreState(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for store state in canonical replay");
}

async function runCanonicalReplay(
  controller: SchematicInteractionController,
): Promise<void> {
  const initialStore = useSchematicStore.getState();
  if (!initialStore.persisted.document) {
    return;
  }

  controller.cancelSession();
  initialStore.clearSelection();

  controller.beginPlacement("gnd");
  await waitForStoreState(
    () => useSchematicStore.getState().session?.type === "placement",
  );
  withHarnessDeterministicUuidSeed("canonical:placement", () => {
    controller.commitPlacement({ x: 2_540_000, y: 1_270_000 });
  });
  await waitForStoreState(
    () =>
      (useSchematicStore.getState().persisted.document?.symbols.length ?? 0) >=
      3,
  );

  controller.activateTool("wire");
  controller.beginWire("pin-2");
  await waitForStoreState(() => {
    const session = useSchematicStore.getState().session;
    return session?.type === "wire" && session.sourcePinId === "pin-2";
  });
  withHarnessDeterministicUuidSeed("canonical:wire", () => {
    controller.commitWire("pin-3");
  });
  await waitForStoreState(
    () =>
      (useSchematicStore.getState().persisted.document?.wires.length ?? 0) >= 1,
  );
  controller.activateTool("select");

  const withPlacedSymbol = useSchematicStore.getState().persisted.document;
  const symbol1 = withPlacedSymbol?.symbols.find(
    (symbol) => symbol.id === "symbol-1",
  );
  if (!symbol1) {
    return;
  }

  controller.beginDragMove(["symbol-1"], "symbol-1", {
    x: symbol1.position.x,
    y: symbol1.position.y,
  });
  controller.updateDragMove({ x: 0, y: 1_270_000 });
  controller.commitDragMove();

  const store = useSchematicStore.getState();
  store.undo();
  store.redo();
}

function isTextEntryFocused(activeElement: Element | null): boolean {
  if (!(activeElement instanceof HTMLElement)) {
    return false;
  }

  if (
    activeElement.isContentEditable ||
    activeElement instanceof HTMLTextAreaElement
  ) {
    return true;
  }

  if (!(activeElement instanceof HTMLInputElement)) {
    return false;
  }

  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(activeElement.type);
}

function resetHarnessStore(fixture: HarnessFixture) {
  const document = FIXTURES[fixture];
  const viewport = FIXTURE_VIEWPORTS[fixture];

  useSchematicStore.setState((state) => ({
    ...state,
    persisted: {
      document,
      projectId: "project-e2e",
      designId: document.id,
    },
    derived: {
      connectivity: null,
      documentBounds: null,
      hitTestCache: createHitTestCache(document.symbols),
    },
    chrome: {
      viewport,
      selectedEntityIds: new Set(),
      activeTool: "select",
      popoverEntityId: null,
      gridSize: 1_270_000,
      showGrid: true,
      placementRotation: 0,
    },
    session: null,
    draggedSymbolKind: null,
  }));
}

function useSchematicPerformanceInstrumentation({
  fixture,
  scenarioId,
}: {
  fixture: HarnessFixture;
  scenarioId: string;
}): SchematicPerfApi {
  const pointerSamplesRef = useRef<number[]>([]);
  const frameSamplesRef = useRef<number[]>([]);
  const panFrameSamplesRef = useRef<number[]>([]);
  const zoomFrameSamplesRef = useRef<number[]>([]);
  const droppedPointerSamplesRef = useRef(0);
  const droppedFrameSamplesRef = useRef(0);
  const droppedPanFrameSamplesRef = useRef(0);
  const droppedZoomFrameSamplesRef = useRef(0);
  const syntheticDelayMsRef = useRef(getHarnessPerfDelayMs());
  const pointerSampleStartRef = useRef<number | null>(null);
  const pointerRafIdRef = useRef<number | null>(null);
  const wheelModeRef = useRef<"pan" | "zoom">("pan");
  const wheelCaptureUntilRef = useRef(0);
  const wheelLoopActiveRef = useRef(false);
  const wheelRafIdRef = useRef<number | null>(null);
  const wheelLastFrameTsRef = useRef<number | null>(null);

  const stopWheelLoop = useCallback(() => {
    if (wheelRafIdRef.current !== null) {
      window.cancelAnimationFrame(wheelRafIdRef.current);
      wheelRafIdRef.current = null;
    }

    wheelLoopActiveRef.current = false;
    wheelLastFrameTsRef.current = null;
  }, []);

  const recordPointerLatency = useCallback((event: MouseEvent) => {
    if (event.type === "mousemove") {
      const session = useSchematicStore.getState().session;
      const hasActiveInteraction =
        event.buttons !== 0 ||
        session?.type === "placement" ||
        session?.type === "wire" ||
        session?.type === "drag";
      if (!hasActiveInteraction) {
        return;
      }
    }

    pointerSampleStartRef.current = window.performance.now();

    if (pointerRafIdRef.current !== null) {
      return;
    }

    pointerRafIdRef.current = window.requestAnimationFrame((endTs) => {
      pointerRafIdRef.current = null;
      const startTs = pointerSampleStartRef.current ?? endTs;
      pointerSampleStartRef.current = null;
      const frameNow = window.performance.now();
      const latency =
        Math.max(0, frameNow - startTs) +
        Math.max(0, syntheticDelayMsRef.current);
      const stored = appendSample(pointerSamplesRef.current, latency);
      if (!stored) {
        droppedPointerSamplesRef.current += 1;
      }
    });
  }, []);

  const startWheelLoop = useCallback(() => {
    if (wheelLoopActiveRef.current) {
      return;
    }

    wheelLoopActiveRef.current = true;
    wheelLastFrameTsRef.current = null;

    const tick = (timestamp: number) => {
      const previous = wheelLastFrameTsRef.current;
      wheelLastFrameTsRef.current = timestamp;

      if (previous !== null) {
        const delta =
          timestamp - previous + Math.max(0, syntheticDelayMsRef.current);
        const storedAll = appendSample(frameSamplesRef.current, delta);
        if (!storedAll) {
          droppedFrameSamplesRef.current += 1;
        }

        if (wheelModeRef.current === "pan") {
          const storedPan = appendSample(panFrameSamplesRef.current, delta);
          if (!storedPan) {
            droppedPanFrameSamplesRef.current += 1;
          }
        } else {
          const storedZoom = appendSample(zoomFrameSamplesRef.current, delta);
          if (!storedZoom) {
            droppedZoomFrameSamplesRef.current += 1;
          }
        }
      }

      if (timestamp <= wheelCaptureUntilRef.current) {
        wheelRafIdRef.current = window.requestAnimationFrame(tick);
        return;
      }

      stopWheelLoop();
    };

    wheelRafIdRef.current = window.requestAnimationFrame(tick);
  }, [stopWheelLoop]);

  useEffect(() => {
    const host = document.querySelector<HTMLElement>(
      '[data-testid="schematic-canvas"]',
    );
    if (!host) {
      return;
    }

    const handleMouseEvent = (event: MouseEvent) => {
      recordPointerLatency(event);
    };

    const handleWheel = (event: WheelEvent) => {
      wheelModeRef.current = event.ctrlKey || event.metaKey ? "zoom" : "pan";
      const captureUntil = window.performance.now() + WHEEL_CAPTURE_WINDOW_MS;
      wheelCaptureUntilRef.current = Math.max(
        wheelCaptureUntilRef.current,
        captureUntil,
      );
      startWheelLoop();
    };

    host.addEventListener("mousedown", handleMouseEvent, { passive: true });
    host.addEventListener("mousemove", handleMouseEvent, { passive: true });
    host.addEventListener("mouseup", handleMouseEvent, { passive: true });
    host.addEventListener("wheel", handleWheel, { passive: true });

    return () => {
      host.removeEventListener("mousedown", handleMouseEvent);
      host.removeEventListener("mousemove", handleMouseEvent);
      host.removeEventListener("mouseup", handleMouseEvent);
      host.removeEventListener("wheel", handleWheel);
    };
  }, [recordPointerLatency, startWheelLoop]);

  const reset = useCallback(() => {
    pointerSamplesRef.current = [];
    frameSamplesRef.current = [];
    panFrameSamplesRef.current = [];
    zoomFrameSamplesRef.current = [];
    droppedPointerSamplesRef.current = 0;
    droppedFrameSamplesRef.current = 0;
    droppedPanFrameSamplesRef.current = 0;
    droppedZoomFrameSamplesRef.current = 0;
    wheelCaptureUntilRef.current = 0;
    pointerSampleStartRef.current = null;
    if (pointerRafIdRef.current !== null) {
      window.cancelAnimationFrame(pointerRafIdRef.current);
      pointerRafIdRef.current = null;
    }
    stopWheelLoop();
  }, [stopWheelLoop]);

  const snapshot = useCallback(
    (options?: PerfSnapshotOptions): SchematicPerfSnapshot => {
      const includeRawSamples = options?.includeRawSamples ?? true;

      const pointer = summarizeSeries(
        pointerSamplesRef.current,
        droppedPointerSamplesRef.current,
        includeRawSamples,
      );
      const panZoom = summarizeSeries(
        frameSamplesRef.current,
        droppedFrameSamplesRef.current,
        includeRawSamples,
      );
      const pan = summarizeSeries(
        panFrameSamplesRef.current,
        droppedPanFrameSamplesRef.current,
        includeRawSamples,
      );
      const zoom = summarizeSeries(
        zoomFrameSamplesRef.current,
        droppedZoomFrameSamplesRef.current,
        includeRawSamples,
      );

      return {
        schemaVersion: "schematic-e2e-perf/v1",
        fixture,
        scenarioId,
        syntheticDelayMs: Math.max(0, syntheticDelayMsRef.current),
        pointerToVisualLatencyMs: pointer,
        panZoomFrameTimeMs: {
          ...panZoom,
          pan,
          zoom,
        },
        environment: readEnvironmentMetadata(),
      };
    },
    [fixture, scenarioId],
  );

  const setSyntheticDelayMs = useCallback((delayMs: number) => {
    if (!Number.isFinite(delayMs)) {
      syntheticDelayMsRef.current = 0;
      return;
    }

    syntheticDelayMsRef.current = Math.max(0, delayMs);
  }, []);

  const getSyntheticDelayMs = useCallback(() => {
    return Math.max(0, syntheticDelayMsRef.current);
  }, []);

  const api = useMemo<SchematicPerfApi>(
    () => ({
      reset,
      snapshot,
      setSyntheticDelayMs,
      getSyntheticDelayMs,
    }),
    [getSyntheticDelayMs, reset, setSyntheticDelayMs, snapshot],
  );

  useEffect(() => {
    window.__SCHEMATIC_E2E_PERF__ = api;
    return () => {
      if (window.__SCHEMATIC_E2E_PERF__ === api) {
        delete window.__SCHEMATIC_E2E_PERF__;
      }
    };
  }, [api]);

  useEffect(() => {
    reset();
    syntheticDelayMsRef.current = getHarnessPerfDelayMs();
  }, [reset]);

  useEffect(() => {
    return () => {
      if (pointerRafIdRef.current !== null) {
        window.cancelAnimationFrame(pointerRafIdRef.current);
        pointerRafIdRef.current = null;
      }
      stopWheelLoop();
    };
  }, [stopWheelLoop]);

  return api;
}

function formatMetric(metric: number | null): string {
  if (metric === null) {
    return "na";
  }

  return metric.toFixed(2);
}

function DebugValue({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-slate-200">
      <span className="text-slate-400">{label}</span>
      <span data-testid={`e2e-${label}`} className="font-mono">
        {value}
      </span>
    </div>
  );
}

function E2EDebugPanel({
  fixture,
  controller,
  scenarioId,
  perf,
}: {
  fixture: HarnessFixture;
  controller: SchematicInteractionController;
  scenarioId: string;
  perf: SchematicPerfApi;
}) {
  const schematicDocument = useSchematicStore(
    (state) => state.persisted.document,
  );
  const session = useSchematicStore((state) => state.session);
  const selectedIds = useSchematicStore(
    (state) => state.chrome.selectedEntityIds,
  );
  const chrome = useSchematicStore((state) => state.chrome);
  const popoverEntityId = useSchematicStore(
    (state) => state.chrome.popoverEntityId,
  );
  const [stateHash, setStateHash] = useState("pending");
  const [stateHashArtifact, setStateHashArtifact] = useState("pending");

  const themeMode =
    globalThis.document.documentElement.dataset.colorMode ??
    globalThis.localStorage.getItem("theme") ??
    "system";

  const wirePoints = useMemo(() => {
    if (!schematicDocument) {
      return "";
    }

    return [...schematicDocument.wires]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(
        (wire) =>
          `${wire.id}:${wire.points.map((point) => `${point.x},${point.y}`).join("|")}`,
      )
      .join(";");
  }, [schematicDocument]);

  const connectedPins = useMemo(() => {
    if (!schematicDocument) {
      return "[]";
    }

    return JSON.stringify(
      collectDirectlyAttachedPinIds(schematicDocument.wires),
    );
  }, [schematicDocument]);

  const sessionSummary = useMemo(() => {
    if (!session) {
      return "none";
    }

    if (session.type === "placement") {
      return `placement:${session.symbolKind}`;
    }

    if (session.type === "netLabel") {
      return "netLabel:pending";
    }

    if ("sourcePinId" in session) {
      return `wire:${session.sourcePinId}:${session.targetPinId ?? "pending"}`;
    }

    return `drag:${session.anchorSymbolId}`;
  }, [session]);

  const perfSnapshot = useMemo(
    () => perf.snapshot({ includeRawSamples: false }),
    [perf],
  );

  const symbol1Screen = useMemo(() => {
    if (!schematicDocument) return "0,0";
    const sym = schematicDocument.symbols.find(
      (symbol) => symbol.id === "symbol-1",
    );
    if (!sym) return "0,0";
    const point =
      projectWorldToR3fScreen({
        x: sym.position.x + 635_000,
        y: sym.position.y,
      }) ??
      projectWorldToDefaultR3fScreen({
        x: sym.position.x + 635_000,
        y: sym.position.y,
      });
    return `${Math.round(point.x)},${Math.round(point.y)}`;
  }, [schematicDocument]);

  const symbol2Screen = useMemo(() => {
    if (!schematicDocument) return "0,0";
    const sym = schematicDocument.symbols.find(
      (symbol) => symbol.id === "symbol-2",
    );
    if (!sym) return "0,0";
    const point =
      projectWorldToR3fScreen({ x: sym.position.x, y: sym.position.y }) ??
      projectWorldToDefaultR3fScreen({ x: sym.position.x, y: sym.position.y });
    return `${Math.round(point.x)},${Math.round(point.y)}`;
  }, [schematicDocument]);

  const pin2Screen = useMemo(() => {
    const point =
      projectWorldToR3fScreen({ x: 1_270_000, y: 0 }) ??
      projectWorldToDefaultR3fScreen({ x: 1_270_000, y: 0 });
    return `${Math.round(point.x)},${Math.round(point.y)}`;
  }, []);

  const pin3Screen = useMemo(() => {
    const point =
      projectWorldToR3fScreen({ x: 1_905_000, y: 1_270_000 }) ??
      projectWorldToDefaultR3fScreen({ x: 1_905_000, y: 1_270_000 });
    return `${Math.round(point.x)},${Math.round(point.y)}`;
  }, []);

  const firstSymbolScreen = useMemo(() => {
    if (!schematicDocument) {
      return "0,0";
    }

    const firstSymbol = schematicDocument.symbols[0];
    if (!firstSymbol) {
      return "0,0";
    }

    const point =
      projectWorldToR3fScreen({
        x: firstSymbol.position.x,
        y: firstSymbol.position.y,
      }) ??
      projectWorldToDefaultR3fScreen({
        x: firstSymbol.position.x,
        y: firstSymbol.position.y,
      });
    return `${Math.round(point.x)},${Math.round(point.y)}`;
  }, [schematicDocument]);

  const deterministicState = useMemo<SerializableValue>(() => {
    const selectedEntityIds = [...chrome.selectedEntityIds].sort(
      (left, right) => left.localeCompare(right),
    );

    if (!schematicDocument) {
      return {
        schemaVersion: "schematic-e2e-state-hash/v1",
        fixture,
        scenarioId,
        symbols: { count: 0, entries: [] },
        wires: { count: 0, entries: [] },
        labels: { count: 0, entries: [] },
        session: { type: "none" },
        chrome: {
          activeTool: chrome.activeTool,
          selectedEntityIds,
          popoverEntityId: chrome.popoverEntityId,
          viewport: {
            offsetX: chrome.viewport.offsetX,
            offsetY: chrome.viewport.offsetY,
            zoom: chrome.viewport.zoom,
          },
          gridSize: chrome.gridSize,
          showGrid: chrome.showGrid,
          placementRotation: chrome.placementRotation,
        },
      };
    }

    const symbols = [...schematicDocument.symbols]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((symbol) => ({
        id: symbol.id,
        position: { x: symbol.position.x, y: symbol.position.y },
        rotation: symbol.rotation,
        mirrored: symbol.mirrored ?? false,
      }));

    const wires = [...schematicDocument.wires]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((wire) => ({
        id: wire.id,
        sourcePinId: wire.sourcePinId,
        targetPinId: wire.targetPinId,
        points: wire.points.map((point) => ({ x: point.x, y: point.y })),
      }));

    const labels = [...schematicDocument.labels]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((label) => ({
        id: label.id,
        text: label.text,
        position: { x: label.position.x, y: label.position.y },
        rotation: label.rotation,
      }));

    const sessionSnapshot: SerializableValue = !session
      ? { type: "none" }
      : session.type === "placement"
        ? {
            type: "placement",
            symbolKind: session.symbolKind,
            rotation: session.rotation,
            previewPosition: session.previewPosition
              ? { x: session.previewPosition.x, y: session.previewPosition.y }
              : null,
          }
        : session.type === "wire"
          ? {
              type: "wire",
              sourcePinId: session.sourcePinId,
              targetPinId: session.targetPinId,
              waypoints: session.waypoints.map((point) => ({
                x: point.x,
                y: point.y,
              })),
              previewPoints: session.previewPoints.map((point) => ({
                x: point.x,
                y: point.y,
              })),
            }
          : session.type === "netLabel"
            ? {
                type: "netLabel",
                rotation: session.rotation,
                previewPosition: session.previewPosition
                  ? {
                      x: session.previewPosition.x,
                      y: session.previewPosition.y,
                    }
                  : null,
              }
            : {
                type: "drag",
                anchorSymbolId: session.anchorSymbolId,
                symbolIds: [...session.symbolIds].sort((left, right) =>
                  left.localeCompare(right),
                ),
                movedPinIds: [...session.movedPinIds].sort((left, right) =>
                  left.localeCompare(right),
                ),
                affectedWireIds: [...session.affectedWireIds].sort(
                  (left, right) => left.localeCompare(right),
                ),
                lastSnappedDelta: {
                  x: session.lastSnappedDelta.x,
                  y: session.lastSnappedDelta.y,
                },
              };

    return {
      schemaVersion: "schematic-e2e-state-hash/v1",
      fixture,
      scenarioId,
      symbols: { count: symbols.length, entries: symbols },
      wires: { count: wires.length, entries: wires },
      labels: { count: labels.length, entries: labels },
      session: sessionSnapshot,
      chrome: {
        activeTool: chrome.activeTool,
        selectedEntityIds,
        popoverEntityId: chrome.popoverEntityId,
        viewport: {
          offsetX: chrome.viewport.offsetX,
          offsetY: chrome.viewport.offsetY,
          zoom: chrome.viewport.zoom,
        },
        gridSize: chrome.gridSize,
        showGrid: chrome.showGrid,
        placementRotation: chrome.placementRotation,
      },
    };
  }, [chrome, fixture, scenarioId, schematicDocument, session]);

  useEffect(() => {
    let cancelled = false;
    setStateHash("pending");
    setStateHashArtifact("pending");

    const serializedState = stableSerialize(deterministicState);

    void sha256Hex(serializedState)
      .then((hash) => {
        if (cancelled) {
          return;
        }

        setStateHash(hash);
        setStateHashArtifact(
          stableSerialize({
            scenarioId,
            fixture,
            algorithm: "sha256",
            hash,
          }),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setStateHash("error");
          setStateHashArtifact(
            stableSerialize({
              scenarioId,
              fixture,
              algorithm: "sha256",
              hash: "error",
            }),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [deterministicState, fixture, scenarioId]);

  return (
    <div className="absolute left-4 top-4 z-30 flex w-72 flex-col gap-3 rounded-lg border border-slate-700 bg-slate-950/90 p-3 shadow-xl pointer-events-none">
      <div className="flex items-center justify-between gap-2 pointer-events-auto">
        <p className="text-sm font-semibold text-slate-100">Schematic E2E</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
            onClick={() => {
              setStateHash("pending");
              setStateHashArtifact("pending");
              void runCanonicalReplay(controller);
            }}
            data-testid="e2e-replay-canonical"
          >
            Replay
          </button>
          <button
            type="button"
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
            onClick={() => resetHarnessStore(fixture)}
          >
            Reset
          </button>
        </div>
      </div>
      <DebugValue label="theme" value={themeMode} />
      <DebugValue label="scenario" value={scenarioId} />
      <DebugValue label="active-tool" value={chrome.activeTool} />
      <DebugValue label="state-hash" value={stateHash} />
      <span data-testid="e2e-state-hash-artifact" className="sr-only">
        {stateHashArtifact}
      </span>
      <span data-testid="e2e-perf-artifact" className="sr-only">
        {stableSerialize(perfSnapshot as SerializableValue)}
      </span>
      <DebugValue
        label="perf-pointer-count"
        value={perfSnapshot.pointerToVisualLatencyMs.count}
      />
      <DebugValue
        label="perf-pointer-p95"
        value={formatMetric(perfSnapshot.pointerToVisualLatencyMs.p95)}
      />
      <DebugValue
        label="perf-frame-count"
        value={perfSnapshot.panZoomFrameTimeMs.count}
      />
      <DebugValue
        label="perf-frame-median"
        value={formatMetric(perfSnapshot.panZoomFrameTimeMs.median)}
      />
      <DebugValue
        label="perf-delay-ms"
        value={formatMetric(perfSnapshot.syntheticDelayMs)}
      />
      <DebugValue label="wire-points" value={wirePoints} />
      <DebugValue label="connected-pins" value={connectedPins} />
      <DebugValue
        label="symbols"
        value={schematicDocument?.symbols.length ?? 0}
      />
      <DebugValue label="wires" value={schematicDocument?.wires.length ?? 0} />
      <DebugValue
        label="selected"
        value={[...selectedIds].join(",") || "none"}
      />
      <DebugValue label="session" value={sessionSummary} />
      <DebugValue label="popover" value={popoverEntityId ?? "none"} />
      <DebugValue label="symbol1" value={symbol1Screen} />
      <DebugValue label="symbol2" value={symbol2Screen} />
      <DebugValue label="first-symbol" value={firstSymbolScreen} />
      <DebugValue label="pin2" value={pin2Screen} />
      <DebugValue label="pin3" value={pin3Screen} />
    </div>
  );
}

export function SchematicEditorE2EHarness() {
  const controller = useSchematicInteractionController();
  const currentFixture = useMemo(getHarnessFixture, []);
  const scenarioId = useMemo(
    () => getHarnessScenarioId(currentFixture),
    [currentFixture],
  );
  const perf = useSchematicPerformanceInstrumentation({
    fixture: currentFixture,
    scenarioId,
  });
  const popoverEntityId = useSchematicStore(
    (state) => state.chrome.popoverEntityId,
  );
  const setPopoverTarget = useSchematicStore((state) => state.setPopoverTarget);

  useEffect(() => {
    resetHarnessStore(currentFixture);
  }, [currentFixture]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (popoverEntityId) {
        if (isTextEntryFocused(globalThis.document.activeElement)) {
          return;
        }

        setPopoverTarget(null);
        return;
      }

      controller.cancelSession();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [controller, popoverEntityId, setPopoverTarget]);

  return (
    <div className="grid h-screen grid-cols-[260px_1fr] bg-slate-950 text-slate-50">
      <aside className="border-r border-slate-800 bg-slate-900">
        <ComponentPalette controller={controller} />
      </aside>
      <main className="relative flex items-center justify-center p-6">
        <E2EDebugPanel
          fixture={currentFixture}
          controller={controller}
          scenarioId={scenarioId}
          perf={perf}
        />
        <div className="relative h-[600px] w-[800px] overflow-hidden rounded-xl border border-slate-800 shadow-2xl">
          <SchematicCanvas controller={controller} />
          <FloatingPropertiesPopover />
        </div>
      </main>
    </div>
  );
}
