import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InteractionCoordinateTransform,
  InteractionHandler,
} from "./types";

const r3fState = vi.hoisted(() => ({
  camera: {
    position: { x: 0, y: 0, z: 100 },
    zoom: 50,
    updateProjectionMatrix: vi.fn(),
  },
  gl: {
    domElement: null as HTMLCanvasElement | null,
  },
  scene: {
    background: null as unknown,
  },
  invalidate: vi.fn(),
  dragDropOverlayMock: vi.fn(({ gridSize }: { gridSize?: number }) => (
    <div
      data-grid-size={String(gridSize ?? 0)}
      data-testid="drag-drop-overlay"
    />
  )),
}));

vi.mock("./DragDropOverlay", () => ({
  DragDropOverlay: r3fState.dragDropOverlayMock,
}));

vi.mock("@react-three/fiber", async () => {
  const React = await import("react");

  const Canvas = React.forwardRef<
    HTMLCanvasElement,
    React.PropsWithChildren<{
      onCreated?: (state: { camera: unknown }) => void;
      style?: React.CSSProperties;
    }>
  >(({ children, onCreated, style }, forwardedRef) => {
    const localRef = React.useRef<HTMLCanvasElement>(null);

    React.useLayoutEffect(() => {
      const canvas = localRef.current;
      if (!canvas) return;

      Object.defineProperty(canvas, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          left: 0,
          top: 0,
          width: 200,
          height: 100,
          right: 200,
          bottom: 100,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
      });

      Object.defineProperty(canvas, "setPointerCapture", {
        configurable: true,
        value: vi.fn(),
      });
      Object.defineProperty(canvas, "releasePointerCapture", {
        configurable: true,
        value: vi.fn(),
      });

      r3fState.gl.domElement = canvas;

      if (typeof forwardedRef === "function") {
        forwardedRef(canvas);
      } else if (forwardedRef) {
        forwardedRef.current = canvas;
      }

      onCreated?.({ camera: r3fState.camera });
    }, [forwardedRef, onCreated]);

    return (
      <div data-testid="mock-canvas-root">
        <canvas data-testid="r3f-dom-canvas" ref={localRef} style={style} />
        <div data-testid="r3f-scene">{children}</div>
      </div>
    );
  });

  return {
    Canvas,
    useThree: (selector: (state: typeof r3fState) => unknown) =>
      selector(r3fState),
  };
});

import { EdaCanvas } from "./EdaCanvas";

function resetR3fState() {
  r3fState.camera.position.x = 0;
  r3fState.camera.position.y = 0;
  r3fState.camera.position.z = 100;
  r3fState.camera.zoom = 50;
  r3fState.camera.updateProjectionMatrix.mockReset();
  r3fState.gl.domElement = null;
  r3fState.scene.background = null;
  r3fState.invalidate.mockReset();
  r3fState.dragDropOverlayMock.mockClear();
}

function getReactProps<T extends object>(element: Element): T {
  const key = Object.keys(element).find((candidate) =>
    candidate.startsWith("__reactProps"),
  );

  if (!key) {
    throw new Error("Missing React props on test element");
  }

  return (element as unknown as Record<string, T | undefined>)[key]!;
}

function createThreePointerEvent(overrides: Record<string, unknown> = {}) {
  return {
    point: { x: 1.25, y: -2.5 },
    clientX: 123,
    clientY: 456,
    button: 0,
    buttons: 1,
    shiftKey: true,
    ctrlKey: false,
    metaKey: true,
    altKey: false,
    stopPropagation: vi.fn(),
    ...overrides,
  };
}

function dispatchPointerEvent(
  element: HTMLCanvasElement,
  type: string,
  init: Record<string, number>,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: init.button,
    clientX: init.clientX,
    clientY: init.clientY,
  }) as PointerEvent;

  Object.defineProperty(event, "pointerId", {
    configurable: true,
    value: init.pointerId,
  });

  element.dispatchEvent(event);
}

function dispatchWheelEvent(
  element: HTMLCanvasElement,
  init: { clientX: number; clientY: number; deltaY: number; deltaMode: number },
) {
  const event = new Event("wheel", {
    bubbles: true,
    cancelable: true,
  }) as WheelEvent;

  Object.defineProperty(event, "clientX", {
    configurable: true,
    value: init.clientX,
  });
  Object.defineProperty(event, "clientY", {
    configurable: true,
    value: init.clientY,
  });
  Object.defineProperty(event, "deltaY", {
    configurable: true,
    value: init.deltaY,
  });
  Object.defineProperty(event, "deltaMode", {
    configurable: true,
    value: init.deltaMode,
  });

  element.dispatchEvent(event);
}

describe("EdaCanvas", () => {
  beforeEach(() => {
    resetR3fState();
  });

  afterEach(() => {
    cleanup();
  });

  it("emits core nm events through adapter transform", () => {
    const handler: InteractionHandler = {
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
    };
    const interactionCoordinateTransform: InteractionCoordinateTransform = {
      sceneUnit: "mm",
      worldUnit: "nm",
      yAxis: "up",
      scenePointToWorldPoint(scenePointMm) {
        return {
          x: (scenePointMm.x + 1) * 1_000_000,
          y: (scenePointMm.y - 2) * 1_000_000,
        };
      },
    };

    const { container } = render(
      <EdaCanvas
        interactionCoordinateTransform={interactionCoordinateTransform}
        interactionHandler={handler}
        testId="eda-canvas"
      >
        <div>child</div>
      </EdaCanvas>,
    );

    const mesh = container.querySelector("mesh");
    expect(mesh).not.toBeNull();

    const meshProps = getReactProps<{
      onPointerDown?: (
        event: ReturnType<typeof createThreePointerEvent>,
      ) => void;
      onPointerMove?: (
        event: ReturnType<typeof createThreePointerEvent>,
      ) => void;
      onPointerUp?: (event: ReturnType<typeof createThreePointerEvent>) => void;
    }>(mesh!);

    const pointerDownEvent = createThreePointerEvent();
    const pointerMoveEvent = createThreePointerEvent({
      point: { x: -0.5, y: 3 },
      clientX: 130,
      clientY: 470,
      button: 0,
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
      altKey: true,
    });
    const pointerUpEvent = createThreePointerEvent({
      point: { x: 0, y: 0.125 },
      clientX: 140,
      clientY: 480,
      button: 0,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
    });

    meshProps.onPointerDown?.(pointerDownEvent);
    meshProps.onPointerMove?.(pointerMoveEvent);
    meshProps.onPointerUp?.(pointerUpEvent);

    expect(handler.onPointerDown).toHaveBeenCalledWith({
      worldPoint: { x: 2_250_000, y: -4_500_000 },
      snappedPoint: { x: 2_250_000, y: -4_500_000 },
      screenPoint: { x: 123, y: 456 },
      modifiers: {
        shift: true,
        ctrl: false,
        meta: true,
        alt: false,
      },
      button: 0,
      nativeEvent: pointerDownEvent,
    });
    expect(handler.onPointerMove).toHaveBeenCalledWith({
      worldPoint: { x: 500_000, y: 1_000_000 },
      snappedPoint: { x: 500_000, y: 1_000_000 },
      screenPoint: { x: 130, y: 470 },
      modifiers: {
        shift: false,
        ctrl: true,
        meta: false,
        alt: true,
      },
      button: 0,
      nativeEvent: pointerMoveEvent,
    });
    expect(handler.onPointerUp).toHaveBeenCalledWith({
      worldPoint: { x: 1_000_000, y: -1_875_000 },
      snappedPoint: { x: 1_000_000, y: -1_875_000 },
      screenPoint: { x: 140, y: 480 },
      modifiers: {
        shift: false,
        ctrl: false,
        meta: false,
        alt: false,
      },
      button: 0,
      nativeEvent: pointerUpEvent,
    });
    expect(pointerDownEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(r3fState.invalidate).toHaveBeenCalledTimes(3);
  });

  it("blocks mutation handlers in read-only mode", () => {
    const handler: InteractionHandler = {
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
    };

    const { container, queryByTestId } = render(
      <EdaCanvas
        enableDragDrop
        interactionHandler={handler}
        readOnly
        testId="eda-canvas"
      >
        <div>child</div>
      </EdaCanvas>,
    );

    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas).toBeInTheDocument();
    expect(container.querySelector("mesh")).toBeNull();
    expect(queryByTestId("drag-drop-overlay")).toBeNull();

    r3fState.invalidate.mockClear();
    r3fState.camera.updateProjectionMatrix.mockClear();

    dispatchPointerEvent(canvas, "pointerdown", {
      button: 1,
      clientX: 100,
      clientY: 50,
      pointerId: 7,
    });
    dispatchPointerEvent(canvas, "pointermove", {
      button: 1,
      clientX: 150,
      clientY: 90,
      pointerId: 7,
    });
    dispatchPointerEvent(canvas, "pointerup", {
      button: 1,
      clientX: 150,
      clientY: 90,
      pointerId: 7,
    });

    expect(r3fState.camera.position.x).toBe(0);
    expect(r3fState.camera.position.y).toBe(0);
    expect(r3fState.invalidate).not.toHaveBeenCalled();
    expect(r3fState.camera.updateProjectionMatrix).not.toHaveBeenCalled();
    expect(handler.onPointerDown).not.toHaveBeenCalled();
  });

  it("integrates wheel zoom and middle-click panning", () => {
    const { container } = render(
      <EdaCanvas testId="eda-canvas">
        <div>child</div>
      </EdaCanvas>,
    );

    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas).toBeInTheDocument();

    r3fState.invalidate.mockClear();
    r3fState.camera.updateProjectionMatrix.mockClear();

    dispatchWheelEvent(canvas, {
      clientX: 100,
      clientY: 50,
      deltaY: -100,
      deltaMode: 0,
    });

    expect(r3fState.camera.zoom).toBeGreaterThan(50);
    expect(Number.isFinite(r3fState.camera.position.x)).toBe(true);
    expect(Number.isFinite(r3fState.camera.position.y)).toBe(true);
    expect(r3fState.invalidate).toHaveBeenCalledOnce();
    expect(r3fState.camera.updateProjectionMatrix).toHaveBeenCalledOnce();

    r3fState.invalidate.mockClear();
    r3fState.camera.updateProjectionMatrix.mockClear();

    dispatchPointerEvent(canvas, "pointerdown", {
      button: 1,
      clientX: 100,
      clientY: 50,
      pointerId: 11,
    });
    dispatchPointerEvent(canvas, "pointermove", {
      button: 1,
      clientX: 150,
      clientY: 20,
      pointerId: 11,
    });
    dispatchPointerEvent(canvas, "pointerup", {
      button: 1,
      clientX: 150,
      clientY: 20,
      pointerId: 11,
    });

    expect(Number.isFinite(r3fState.camera.position.x)).toBe(true);
    expect(Number.isFinite(r3fState.camera.position.y)).toBe(true);
    expect(r3fState.camera.position.x).not.toBe(0);
    expect(r3fState.camera.position.y).not.toBe(0);
    expect(r3fState.invalidate).toHaveBeenCalledOnce();
    expect(r3fState.camera.updateProjectionMatrix).toHaveBeenCalledOnce();
  });

  it("ignores pointer-plane events when handlers are missing", () => {
    const { container } = render(
      <EdaCanvas testId="eda-canvas">
        <div>child</div>
      </EdaCanvas>,
    );

    const mesh = container.querySelector("mesh");
    expect(mesh).not.toBeNull();

    const meshProps = getReactProps<{
      onPointerDown?: (
        event: ReturnType<typeof createThreePointerEvent>,
      ) => void;
      onPointerMove?: (
        event: ReturnType<typeof createThreePointerEvent>,
      ) => void;
      onPointerUp?: (event: ReturnType<typeof createThreePointerEvent>) => void;
    }>(mesh!);

    expect(() =>
      meshProps.onPointerDown?.(createThreePointerEvent()),
    ).not.toThrow();
    expect(() =>
      meshProps.onPointerMove?.(createThreePointerEvent()),
    ).not.toThrow();
    expect(() =>
      meshProps.onPointerUp?.(createThreePointerEvent()),
    ).not.toThrow();
  });
});
