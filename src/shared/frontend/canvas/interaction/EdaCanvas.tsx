import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  DEFAULT_EDA_WHEEL_OPTIONS,
  useEdaWheel,
  type EdaWheelOptions,
} from "../camera/use-eda-camera";
import { RENDER_ORDER } from "../layers";
import { DragDropOverlay } from "./DragDropOverlay";
import {
  DEFAULT_INTERACTION_COORDINATE_TRANSFORM,
  type InteractionCoordinateTransform,
  type InteractionHandler,
} from "./types";

export interface EdaCanvasProps {
  children: ReactNode;
  interactionHandler?: InteractionHandler | null;
  gridSize?: number;
  interactionCoordinateTransform?: InteractionCoordinateTransform;
  enableDragDrop?: boolean;
  readOnly?: boolean;
  className?: string;
  testId?: string;
  backgroundColor?: string;
  style?: CSSProperties;
  initialZoom?: number;
  navigation?: {
    readonly wheel?: EdaWheelOptions;
    readonly middleButtonPan?: boolean;
  };
}

export function EdaCanvas({
  children,
  interactionHandler = null,
  gridSize = 0,
  interactionCoordinateTransform = DEFAULT_INTERACTION_COORDINATE_TRANSFORM,
  enableDragDrop = false,
  readOnly = false,
  className,
  testId,
  backgroundColor = "#0f172a",
  style,
  initialZoom = 50,
  navigation,
}: EdaCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<THREE.OrthographicCamera>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("contextmenu", handleContextMenu);
    return () => container.removeEventListener("contextmenu", handleContextMenu);
  }, [handleContextMenu]);

  const containerStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    cursor: "crosshair",
    overflow: "hidden",
    ...style,
  };

  const resolvedWheelOptions = {
    ...DEFAULT_EDA_WHEEL_OPTIONS,
    ...(navigation?.wheel ?? {}),
  };
  const middleButtonPanEnabled = navigation?.middleButtonPan ?? true;

  return (
    <div
      ref={containerRef}
      className={className}
      data-testid={testId}
      style={containerStyle}
    >
      <Canvas
        orthographic
        camera={{
          zoom: initialZoom,
          position: [0, 0, 100],
          near: -10000,
          far: 10000,
        }}
        frameloop="demand"
        dpr={[1, 3]}
        gl={{
          antialias: true,
          alpha: false,
          preserveDrawingBuffer: false,
          powerPreference: "high-performance",
        }}
        style={{ background: backgroundColor }}
        ref={canvasRef as React.RefObject<HTMLCanvasElement>}
        onCreated={({ camera }) => {
          const cam = camera as THREE.OrthographicCamera;
          cam.zoom = initialZoom;
          cam.updateProjectionMatrix();
        }}
      >
        <SceneBackground color={backgroundColor} />
        <EdaCanvasInternals
          readOnly={readOnly}
          cameraRef={cameraRef}
          interactionHandler={interactionHandler}
          interactionCoordinateTransform={interactionCoordinateTransform}
          wheelOptions={resolvedWheelOptions}
          middleButtonPanEnabled={middleButtonPanEnabled}
        >
          {children}
        </EdaCanvasInternals>
      </Canvas>

      {enableDragDrop && !readOnly && (
        <DragDropOverlay
          cameraRef={cameraRef}
          canvasRef={canvasRef}
          handler={interactionHandler}
          gridSize={gridSize}
          interactionCoordinateTransform={interactionCoordinateTransform}
        />
      )}
    </div>
  );
}

function EdaCanvasInternals({
  readOnly,
  cameraRef,
  interactionHandler,
  interactionCoordinateTransform,
  wheelOptions,
  middleButtonPanEnabled,
  children,
}: {
  readOnly: boolean;
  cameraRef: React.RefObject<THREE.OrthographicCamera | null>;
  interactionHandler: InteractionHandler | null;
  interactionCoordinateTransform: InteractionCoordinateTransform;
  wheelOptions: Required<EdaWheelOptions>;
  middleButtonPanEnabled: boolean;
  children: ReactNode;
}) {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    (cameraRef as React.MutableRefObject<THREE.OrthographicCamera | null>).current = camera;
  }, [camera, cameraRef]);

  useEdaWheel(wheelOptions);

  const isPanningRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!middleButtonPanEnabled) {
      return;
    }

    const canvas = gl.domElement;
    const stopPanning = (pointerId?: number) => {
      if (!isPanningRef.current) {
        return;
      }
      isPanningRef.current = false;
      if (typeof pointerId === "number") {
        try {
          canvas.releasePointerCapture(pointerId);
        } catch {
          // ignore: pointer capture can already be released
        }
      }
      canvas.style.cursor = "crosshair";
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 1) {
        return;
      }
      e.preventDefault();
      isPanningRef.current = true;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isPanningRef.current) return;
      const dx = e.clientX - lastPointerRef.current.x;
      const dy = e.clientY - lastPointerRef.current.y;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };

      camera.position.x -= dx / camera.zoom;
      camera.position.y += dy / camera.zoom;
      camera.updateProjectionMatrix();
      invalidate();
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.button === 1) {
        stopPanning(e.pointerId);
      }
    };

    const handlePointerCancel = (e: PointerEvent) => {
      if (e.button === 1 || isPanningRef.current) {
        stopPanning(e.pointerId);
      }
    };

    const handleWindowBlur = () => {
      stopPanning();
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("blur", handleWindowBlur);
      stopPanning();
    };
  }, [camera, gl, invalidate, middleButtonPanEnabled]);

  const handlePointerLeave = useCallback(() => {
    interactionHandler?.onPointerLeave?.();
  }, [interactionHandler]);

  return (
    <>
      {!readOnly && (
        <BackgroundHitPlane
          interactionHandler={interactionHandler}
          interactionCoordinateTransform={interactionCoordinateTransform}
          invalidate={invalidate}
        />
      )}
      <group onPointerLeave={handlePointerLeave}>{children}</group>
    </>
  );
}

function SceneBackground({ color }: { color: string }) {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    scene.background = new THREE.Color(color);
    invalidate();
  }, [scene, color, invalidate]);

  return null;
}

function BackgroundHitPlane({
  interactionHandler,
  interactionCoordinateTransform,
  invalidate,
}: {
  interactionHandler: InteractionHandler | null;
  interactionCoordinateTransform: InteractionCoordinateTransform;
  invalidate: () => void;
}) {
  const buildInteractionEvent = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const worldPoint = interactionCoordinateTransform.scenePointToWorldPoint({
        x: e.point.x,
        y: e.point.y,
      });

      return {
        worldPoint,
        snappedPoint: worldPoint,
        screenPoint: { x: e.clientX, y: e.clientY },
        modifiers: {
          shift: e.shiftKey ?? false,
          ctrl: e.ctrlKey ?? false,
          meta: e.metaKey ?? false,
          alt: e.altKey ?? false,
        },
        button: e.button,
        nativeEvent: e,
      };
    },
    [interactionCoordinateTransform],
  );

  return (
    <mesh
      renderOrder={RENDER_ORDER.HIT_PLANE}
      onPointerDown={(e) => {
        if (!interactionHandler?.onPointerDown || e.button > 0) return;
        e.stopPropagation();
        interactionHandler.onPointerDown(buildInteractionEvent(e));
        invalidate();
      }}
      onPointerMove={(e) => {
        if (!interactionHandler?.onPointerMove) return;
        interactionHandler.onPointerMove(buildInteractionEvent(e));
      }}
      onPointerUp={(e) => {
        if (!interactionHandler?.onPointerUp) return;
        interactionHandler.onPointerUp(buildInteractionEvent(e));
        invalidate();
      }}
    >
      <planeGeometry args={[10_000, 10_000]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
