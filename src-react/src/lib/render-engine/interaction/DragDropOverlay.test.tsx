import { cleanup, render } from "@testing-library/react";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DragDropOverlay } from "./DragDropOverlay";
import type {
  InteractionCoordinateTransform,
  InteractionHandler,
} from "./types";

function createCameraRef(
  overrides?: Partial<{ x: number; y: number; zoom: number }>,
) {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  camera.position.x = overrides?.x ?? 2;
  camera.position.y = overrides?.y ?? -3;
  camera.zoom = overrides?.zoom ?? 2;

  return {
    current: camera,
  };
}

function createCanvasRef(rect?: Partial<DOMRect>) {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: rect?.left ?? 10,
      top: rect?.top ?? 20,
      width: rect?.width ?? 100,
      height: rect?.height ?? 200,
      right: (rect?.left ?? 10) + (rect?.width ?? 100),
      bottom: (rect?.top ?? 20) + (rect?.height ?? 200),
      x: rect?.left ?? 10,
      y: rect?.top ?? 20,
      toJSON: () => ({}),
    }),
  });

  return { current: canvas };
}

function createDragEvent(
  type: string,
  init: {
    clientX: number;
    clientY: number;
    dataTransfer?: {
      types: string[];
      dropEffect: DataTransfer["dropEffect"];
      getData: (mime: string) => string;
    };
    relatedTarget?: Node | null;
  },
) {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  }) as DragEvent;

  Object.defineProperty(event, "clientX", {
    configurable: true,
    value: init.clientX,
  });
  Object.defineProperty(event, "clientY", {
    configurable: true,
    value: init.clientY,
  });
  Object.defineProperty(event, "dataTransfer", {
    configurable: true,
    value: init.dataTransfer,
  });
  Object.defineProperty(event, "relatedTarget", {
    configurable: true,
    value: init.relatedTarget ?? null,
  });

  return event;
}

describe("DragDropOverlay", () => {
  afterEach(() => {
    cleanup();
  });

  it("builds drag-drop events from native dragenter and dragover", () => {
    const handler: InteractionHandler = {
      onDragEnter: vi.fn(),
      onDragOver: vi.fn(),
      onDrop: vi.fn(),
    };
    const cameraRef = createCameraRef();
    const canvasRef = createCanvasRef();

    const { getByTestId } = render(
      <div data-testid="host">
        <DragDropOverlay
          cameraRef={cameraRef}
          canvasRef={canvasRef}
          handler={handler}
        />
      </div>,
    );

    const host = getByTestId("host");
    const dataTransfer = {
      types: ["application/x-openpcb", "text/plain"],
      dropEffect: "move" as const,
      getData: vi.fn((mime: string) => `${mime}-payload`),
    };

    host.dispatchEvent(
      createDragEvent("dragenter", {
        clientX: 60,
        clientY: 120,
        dataTransfer,
      }),
    );
    host.dispatchEvent(
      createDragEvent("dragover", {
        clientX: 60,
        clientY: 120,
        dataTransfer,
      }),
    );

    expect(handler.onDragEnter).toHaveBeenCalledWith(
      expect.objectContaining({
        worldPoint: { x: 2_000_000, y: -3_000_000 },
        snappedPoint: { x: 2_000_000, y: -3_000_000 },
        types: ["application/x-openpcb", "text/plain"],
        dropEffect: "move",
      }),
    );
    expect(handler.onDragOver).toHaveBeenCalledWith(
      expect.objectContaining({
        worldPoint: { x: 2_000_000, y: -3_000_000 },
        snappedPoint: { x: 2_000_000, y: -3_000_000 },
        dropEffect: "copy",
      }),
    );

    const onDragEnter = handler.onDragEnter as NonNullable<
      InteractionHandler["onDragEnter"]
    >;
    const enterCall = vi.mocked(onDragEnter).mock.calls[0];
    expect(enterCall).toBeDefined();
    const enterEvent = enterCall![0];
    expect(enterEvent.getData("application/x-openpcb")).toBe(
      "application/x-openpcb-payload",
    );
  });

  it("converts drag coordinates through adapter transform into core world points", () => {
    const handler: InteractionHandler = {
      onDrop: vi.fn(),
    };
    const interactionCoordinateTransform: InteractionCoordinateTransform = {
      sceneUnit: "mm",
      worldUnit: "nm",
      yAxis: "up",
      scenePointToWorldPoint(scenePointMm) {
        return {
          x: (scenePointMm.x + 5) * 1_000_000,
          y: (scenePointMm.y - 4) * 1_000_000,
        };
      },
    };
    const cameraRef = createCameraRef({ x: 0, y: 0, zoom: 10 });
    const canvasRef = createCanvasRef({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });

    const { getByTestId } = render(
      <div data-testid="host">
        <DragDropOverlay
          cameraRef={cameraRef}
          canvasRef={canvasRef}
          handler={handler}
          interactionCoordinateTransform={interactionCoordinateTransform}
        />
      </div>,
    );

    const host = getByTestId("host");
    const dataTransfer = {
      types: ["text/plain"],
      dropEffect: "copy" as const,
      getData: () => "payload",
    };

    host.dispatchEvent(
      createDragEvent("dragenter", {
        clientX: 60,
        clientY: 70,
        dataTransfer,
      }),
    );
    host.dispatchEvent(
      createDragEvent("drop", {
        clientX: 60,
        clientY: 70,
        dataTransfer,
      }),
    );

    const onDrop = handler.onDrop as NonNullable<InteractionHandler["onDrop"]>;
    const dropCall = vi.mocked(onDrop).mock.calls[0];
    expect(dropCall).toBeDefined();
    const dropEvent = dropCall![0];

    expect(dropEvent.worldPoint.x).toBeCloseTo(6_000_000);
    expect(dropEvent.worldPoint.y).toBeCloseTo(-6_000_000);
    expect(dropEvent.snappedPoint.x).toBeCloseTo(6_000_000);
    expect(dropEvent.snappedPoint.y).toBeCloseTo(-6_000_000);
  });

  it("applies grid snapping to drag events", () => {
    const handler: InteractionHandler = {
      onDrop: vi.fn(),
    };
    const cameraRef = createCameraRef({ x: 0, y: 0, zoom: 10 });
    const canvasRef = createCanvasRef({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });

    const { getByTestId } = render(
      <div data-testid="host">
        <DragDropOverlay
          cameraRef={cameraRef}
          canvasRef={canvasRef}
          gridSize={2_000_000}
          handler={handler}
        />
      </div>,
    );

    const host = getByTestId("host");
    const dataTransfer = {
      types: ["text/plain"],
      dropEffect: "copy" as const,
      getData: () => "payload",
    };

    host.dispatchEvent(
      createDragEvent("dragenter", {
        clientX: 62,
        clientY: 70,
        dataTransfer,
      }),
    );
    host.dispatchEvent(
      createDragEvent("drop", {
        clientX: 62,
        clientY: 70,
        dataTransfer,
      }),
    );

    const onDrop = handler.onDrop as NonNullable<InteractionHandler["onDrop"]>;
    const dropCall = vi.mocked(onDrop).mock.calls[0];
    expect(dropCall).toBeDefined();
    const dropEvent = dropCall![0];

    expect(dropEvent.worldPoint.x).toBeCloseTo(1_200_000);
    expect(dropEvent.worldPoint.y).toBeCloseTo(-2_000_000);
    expect(dropEvent.snappedPoint.x).toBe(2_000_000);
    expect(dropEvent.snappedPoint.y).toBe(-2_000_000);
  });

  it("ignores drag events without dataTransfer", () => {
    const handler: InteractionHandler = {
      onDragEnter: vi.fn(),
      onDrop: vi.fn(),
    };
    const cameraRef = createCameraRef();
    const canvasRef = createCanvasRef();

    const { getByTestId } = render(
      <div data-testid="host">
        <DragDropOverlay
          cameraRef={cameraRef}
          canvasRef={canvasRef}
          handler={handler}
        />
      </div>,
    );

    const host = getByTestId("host");

    host.dispatchEvent(
      createDragEvent("dragenter", {
        clientX: 60,
        clientY: 120,
      }),
    );
    host.dispatchEvent(
      createDragEvent("drop", {
        clientX: 60,
        clientY: 120,
      }),
    );

    expect(handler.onDragEnter).not.toHaveBeenCalled();
    expect(handler.onDrop).not.toHaveBeenCalled();
  });
});
