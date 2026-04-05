/**
 * EdaCanvas — Unified R3F canvas shell for all EDA editors.
 *
 * Single component handling:
 * - R3F <Canvas> with orthographic camera + demand rendering
 * - CameraControls (pan via middle-click/shift+left)
 * - Custom wheel handler (preserving existing normalization)
 * - Background hit plane (for empty-space clicks)
 * - DragDrop overlay (HTML bridge for native drag events)
 * - Context menu prevention
 * - Cursor styling
 *
 * Each editor (Schematic, PCB, Symbol, Footprint) renders its scene
 * as children of this component.
 */

import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type CSSProperties,
} from "react";
import { useEdaWheel } from "../camera/use-eda-camera";
import { DragDropOverlay } from "./DragDropOverlay";
import type { InteractionHandler } from "./types";
import { RENDER_ORDER } from "../layers";
import { sceneToNm } from "../coords";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EdaCanvasProps {
  /** Scene content (SchematicScene, PcbScene, etc.) */
  children: ReactNode;
  /** Interaction handler for pointer events */
  interactionHandler?: InteractionHandler | null;
  /** Grid size for drag-drop snapping (nm) */
  gridSize?: number;
  /** Enable drag-drop overlay */
  enableDragDrop?: boolean;
  /** Read-only mode (disables all interaction) */
  readOnly?: boolean;
  /** CSS class name for the container */
  className?: string;
  /** data-testid for E2E tests */
  testId?: string;
  /** Background color */
  backgroundColor?: string;
  /** Container style overrides */
  style?: CSSProperties;
  /** Initial camera zoom (pixels per scene-unit). Default 50 for schematic. PCB uses ~5. */
  initialZoom?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EdaCanvas({
  children,
  interactionHandler = null,
  gridSize = 0,
  enableDragDrop = false,
  readOnly = false,
  className,
  testId,
  backgroundColor = "#0f172a",
  style,
  initialZoom = 50,
}: EdaCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<THREE.OrthographicCamera>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Prevent context menu on the container
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const containerStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    cursor: "crosshair",
    overflow: "hidden",
    ...style,
  };

  return (
    <div
      ref={containerRef}
      className={className}
      data-testid={testId}
      style={containerStyle}
      onContextMenu={handleContextMenu}
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
        >
          {children}
        </EdaCanvasInternals>
      </Canvas>

      {/* HTML drag-drop overlay */}
      {enableDragDrop && !readOnly && (
        <DragDropOverlay
          cameraRef={cameraRef}
          canvasRef={canvasRef}
          handler={interactionHandler}
          gridSize={gridSize}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internals (inside R3F context)
// ---------------------------------------------------------------------------

function EdaCanvasInternals({
  readOnly,
  cameraRef,
  interactionHandler,
  children,
}: {
  readOnly: boolean;
  cameraRef: React.RefObject<THREE.OrthographicCamera | null>;
  interactionHandler: InteractionHandler | null;
  children: ReactNode;
}) {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const invalidate = useThree((s) => s.invalidate);

  // Keep camera ref in sync
  useEffect(() => {
    (
      cameraRef as React.MutableRefObject<THREE.OrthographicCamera | null>
    ).current = camera;
  }, [camera, cameraRef]);

  // Custom wheel handler (preserving existing normalization)
  useEdaWheel();

  // Pointer leave handler
  const handlePointerLeave = useCallback(() => {
    interactionHandler?.onPointerLeave?.();
  }, [interactionHandler]);

  return (
    <>
      {/* No CameraControls — zoom/pan handled entirely by useEdaWheel
          to avoid conflicts with manual camera.position/zoom changes */}

      {/* Background hit plane — catches clicks on empty space (must be inside event tree) */}
      {!readOnly && (
        <BackgroundHitPlane
          interactionHandler={interactionHandler}
          invalidate={invalidate}
        />
      )}

      {/* Scene content with accelerated hit testing */}
      <group onPointerLeave={handlePointerLeave}>{children}</group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Scene Background — sets WebGL clear color reactively
// ---------------------------------------------------------------------------

function SceneBackground({ color }: { color: string }) {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    scene.background = new THREE.Color(color);
    invalidate();
  }, [scene, color, invalidate]);

  return null;
}

// ---------------------------------------------------------------------------
// Background Hit Plane
// ---------------------------------------------------------------------------

function BackgroundHitPlane({
  interactionHandler,
  invalidate,
}: {
  interactionHandler: InteractionHandler | null;
  invalidate: () => void;
}) {
  return (
    <mesh
      renderOrder={RENDER_ORDER.HIT_PLANE}
      onPointerDown={(e) => {
        if (!interactionHandler?.onPointerDown) return;
        if (e.button !== 0) return;
        e.stopPropagation();
        const wx = sceneToNm(e.point.x);
        const wy = sceneToNm(e.point.y);
        interactionHandler.onPointerDown({
          worldPoint: { x: wx, y: wy },
          snappedPoint: { x: wx, y: wy },
          screenPoint: { x: e.clientX, y: e.clientY },
          modifiers: {
            shift: e.shiftKey ?? false,
            ctrl: e.ctrlKey ?? false,
            meta: e.metaKey ?? false,
            alt: e.altKey ?? false,
          },
          button: e.button,
          nativeEvent: e,
        });
        invalidate();
      }}
      onPointerMove={(e) => {
        if (!interactionHandler?.onPointerMove) return;
        const wx = sceneToNm(e.point.x);
        const wy = sceneToNm(e.point.y);
        interactionHandler.onPointerMove({
          worldPoint: { x: wx, y: wy },
          snappedPoint: { x: wx, y: wy },
          screenPoint: { x: e.clientX, y: e.clientY },
          modifiers: {
            shift: e.shiftKey ?? false,
            ctrl: e.ctrlKey ?? false,
            meta: e.metaKey ?? false,
            alt: e.altKey ?? false,
          },
          button: e.button,
          nativeEvent: e,
        });
      }}
      onPointerUp={(e) => {
        if (!interactionHandler?.onPointerUp) return;
        const wx = sceneToNm(e.point.x);
        const wy = sceneToNm(e.point.y);
        interactionHandler.onPointerUp({
          worldPoint: { x: wx, y: wy },
          snappedPoint: { x: wx, y: wy },
          screenPoint: { x: e.clientX, y: e.clientY },
          modifiers: {
            shift: e.shiftKey ?? false,
            ctrl: e.ctrlKey ?? false,
            meta: e.metaKey ?? false,
            alt: e.altKey ?? false,
          },
          button: e.button,
          nativeEvent: e,
        });
        invalidate();
      }}
    >
      {/* Large plane — sized in scene units (mm). 10000mm = 10m each side */}
      <planeGeometry args={[10_000, 10_000]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
