import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type { WebGLRenderer } from "three";
import type { DesignerPcbProjection } from "../../../../sdks";
import { CanvasThemeProvider } from "../../../../shared/frontend/canvas/theme";
import { createDesignerApi } from "../api";
import { BoardGeometry } from "./BoardGeometry";
import { DEFAULT_BOARD_THICKNESS_MM } from "./primitives/geometry-utils";
import { ModelCacheProvider } from "./ModelCacheProvider";
import { createPortal } from "react-dom";
import {
  Board3DControls,
  Board3DSceneOverlay,
  type CameraPreset,
  type DisplayToggles,
} from "./Board3DOverlay";

const PRESET_POSITIONS: Record<CameraPreset, [number, number, number]> = {
  persp: [0, 30, 70],
  iso: [55, 55, 55],
  top: [0, 95, 0.001],
  front: [0, 12, 95],
  side: [95, 12, 0],
  back: [0, 12, -95],
};

/** Applies a camera preset (position + recenters target) on demand. */
function CameraController({
  preset,
  nonce,
}: {
  preset: CameraPreset;
  nonce: number;
}): null {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as {
    target: { set(x: number, y: number, z: number): void };
    update(): void;
  } | null;
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const [x, y, z] = PRESET_POSITIONS[preset];
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
    if (controls?.target) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
    invalidate();
    // `nonce` lets the same preset be re-applied (re-center) on click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, nonce]);

  return null;
}

interface Board3DCanvasProps {
  backendURL?: string | null;
  moduleId: string;
  selectedDesignId: string | null;
  projection?: DesignerPcbProjection | null;
  loadingProjection?: boolean;
  error: string | null;
  /** Designer left-sidebar slot to portal the 3D controls into. */
  controlsTarget?: HTMLElement | null;
}

const THREE_D_THEME = {
  canvasBackground: "bg-slate-950",
  shellBorder: "border-slate-800",
  panelBackground: "bg-slate-900/85",
  mutedText: "text-slate-400",
  bodyText: "text-slate-200",
  accentBorder: "border-violet-500/60",
  errorBackground: "bg-red-950/70",
  errorText: "text-red-200",
} as const;

const THREE_D_SCENE_COLORS = {
  background: "#131313",
  gridMajor: "rgb(71, 85, 105)",
  gridMinor: "rgb(30, 41, 59)",
} as const;

function sceneKey(projection: DesignerPcbProjection): string {
  return [
    projection.designId,
    projection.revision,
    projection.placements.length,
    projection.traces.length,
    projection.vias.length,
  ].join(":");
}

function hasRenderableBoardContent(projection: DesignerPcbProjection): boolean {
  return (
    projection.placements.length > 0 ||
    projection.traces.length > 0 ||
    projection.vias.length > 0
  );
}

function Board3DStatePanel({
  title,
  message,
  variant = "default",
}: {
  title: string;
  message: string;
  variant?: "default" | "loading" | "error";
}): ReactElement {
  const isError = variant === "error";
  return (
    <div
      className={`flex h-full items-center justify-center px-4 text-center ${
        isError ? THREE_D_THEME.errorBackground : THREE_D_THEME.canvasBackground
      }`}
    >
      <div
        className={`max-w-sm rounded-lg border px-4 py-3 ${
          isError
            ? "border-red-800/80 bg-red-950/60"
            : `${THREE_D_THEME.shellBorder} ${THREE_D_THEME.panelBackground}`
        }`}
      >
        <div className="flex items-center justify-center gap-2">
          {variant === "loading" ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-violet-400" />
          ) : null}
          <h3
            className={`text-sm font-semibold ${
              isError ? THREE_D_THEME.errorText : THREE_D_THEME.bodyText
            }`}
          >
            {title}
          </h3>
        </div>
        <p
          className={`mt-2 text-xs ${
            isError ? THREE_D_THEME.errorText : THREE_D_THEME.mutedText
          }`}
        >
          {message}
        </p>
      </div>
    </div>
  );
}

function Board3DInvalidator({
  sceneKeyValue,
}: {
  sceneKeyValue: string;
}): ReactElement {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    invalidate();
  }, [invalidate, sceneKeyValue]);

  return (
    <OrbitControls
      makeDefault
      onChange={() => invalidate()}
      minPolarAngle={0}
      maxPolarAngle={Math.PI}
    />
  );
}

function Board3DScene({
  backendURL,
  projection,
  cameraPreset,
  presetNonce,
  showGrid,
}: {
  backendURL?: string | null;
  projection: DesignerPcbProjection;
  cameraPreset: CameraPreset;
  presetNonce: number;
  showGrid: boolean;
}): ReactElement {
  const key = sceneKey(projection);
  return (
    <>
      <ambientLight intensity={0.72} />
      <directionalLight position={[28, 38, 46]} intensity={1.45} />
      <directionalLight position={[-18, -24, 24]} intensity={0.35} />
      <ModelCacheProvider>
        <CanvasThemeProvider mode="dark">
          {/* Rotate PCB geometry (XY-plane) to lie flat in the XZ-plane, front face up */}
          <group rotation={[-Math.PI / 2, 0, 0]}>
            <BoardGeometry backendURL={backendURL} projection={projection} />
          </group>
        </CanvasThemeProvider>
      </ModelCacheProvider>
      {showGrid ? (
        <gridHelper
          args={[
            120,
            24,
            THREE_D_SCENE_COLORS.gridMajor,
            THREE_D_SCENE_COLORS.gridMinor,
          ]}
          position={[0, -DEFAULT_BOARD_THICKNESS_MM / 2, 0]}
        />
      ) : null}
      <CameraController preset={cameraPreset} nonce={presetNonce} />
      <Board3DInvalidator sceneKeyValue={key} />
    </>
  );
}

export function Board3DCanvas({
  backendURL,
  moduleId,
  selectedDesignId,
  projection,
  loadingProjection = false,
  error,
  controlsTarget,
}: Board3DCanvasProps): ReactElement {
  const api = useMemo(
    () => createDesignerApi({ backendURL, moduleId }),
    [backendURL, moduleId],
  );
  const [fetchedProjection, setFetchedProjection] =
    useState<DesignerPcbProjection | null>(null);
  const [fetchingProjection, setFetchingProjection] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("iso");
  const [presetNonce, setPresetNonce] = useState(0);
  const [display, setDisplay] = useState<DisplayToggles>({
    components: true,
    silkscreen: true,
    labels: true,
    heatmap: false,
    grid: true,
  });
  const [boardColor, setBoardColor] = useState("green");
  const [scene, setScene] = useState("studio-dark");
  const [transparency, setTransparency] = useState(0);
  const glRef = useRef<WebGLRenderer | null>(null);
  const invalidateRef = useRef<(() => void) | null>(null);

  const applyPreset = useCallback((preset: CameraPreset) => {
    setCameraPreset(preset);
    setPresetNonce((n) => n + 1);
  }, []);
  const toggleDisplay = useCallback((key: keyof DisplayToggles) => {
    setDisplay((d) => ({ ...d, [key]: !d[key] }));
  }, []);
  const handleSnapshot = useCallback(() => {
    const gl = glRef.current;
    if (!gl) return;
    invalidateRef.current?.();
    requestAnimationFrame(() => {
      try {
        const url = gl.domElement.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = url;
        a.download = `${selectedDesignId ?? "board"}-3d.png`;
        a.click();
      } catch {
        // toDataURL can throw on tainted/lost contexts — ignore.
      }
    });
  }, [selectedDesignId]);

  useEffect(() => {
    if (projection !== undefined) {
      setFetchedProjection(null);
      setFetchError(null);
      setFetchingProjection(false);
      return;
    }
    if (!selectedDesignId) {
      setFetchedProjection(null);
      setFetchError(null);
      setFetchingProjection(false);
      return;
    }

    let cancelled = false;
    setFetchingProjection(true);
    setFetchError(null);
    void api
      .getPcbProjection(selectedDesignId)
      .then((next) => {
        if (!cancelled) setFetchedProjection(next);
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(
            err instanceof Error
              ? err.message
              : "Failed to load PCB projection",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setFetchingProjection(false);
      });

    return () => {
      cancelled = true;
    };
  }, [api, projection, selectedDesignId]);

  const activeProjection = projection ?? fetchedProjection;
  const activeError = error ?? fetchError;
  const isLoading = loadingProjection || fetchingProjection;

  if (activeError) {
    return (
      <div data-testid="designer-3d-canvas" className="h-full w-full">
        <Board3DStatePanel
          title="3D view unavailable"
          message={activeError}
          variant="error"
        />
      </div>
    );
  }

  if (!selectedDesignId) {
    return (
      <div data-testid="designer-3d-canvas" className="h-full w-full">
        <Board3DStatePanel
          title="No design selected"
          message="Select or create a design to open the 3D board view."
        />
      </div>
    );
  }

  if (isLoading || !activeProjection) {
    return (
      <div data-testid="designer-3d-canvas" className="h-full w-full">
        <Board3DStatePanel
          title="Loading 3D view"
          message="Preparing the current PCB projection."
          variant="loading"
        />
      </div>
    );
  }

  return (
    <div
      data-testid="designer-3d-canvas"
      className={`relative h-full w-full overflow-hidden ${THREE_D_THEME.canvasBackground}`}
    >
      <Canvas
        frameloop="demand"
        camera={{ position: [0, 30, 70], fov: 45, near: 0.1, far: 1000 }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          // Required so Snapshot can read the buffer under demand rendering.
          preserveDrawingBuffer: true,
        }}
        className="h-full w-full"
        onCreated={({ invalidate, gl }) => {
          glRef.current = gl;
          invalidateRef.current = invalidate;
          invalidate();
        }}
      >
        <color attach="background" args={[THREE_D_SCENE_COLORS.background]} />
        <Board3DScene
          backendURL={backendURL}
          projection={activeProjection}
          cameraPreset={cameraPreset}
          presetNonce={presetNonce}
          showGrid={display.grid}
        />
      </Canvas>

      {controlsTarget
        ? createPortal(
            <Board3DControls
              cameraPreset={cameraPreset}
              onPreset={applyPreset}
              display={display}
              onToggleDisplay={toggleDisplay}
              boardColor={boardColor}
              onBoardColor={setBoardColor}
              scene={scene}
              onScene={setScene}
              transparency={transparency}
              onTransparency={setTransparency}
            />,
            controlsTarget,
          )
        : null}

      <Board3DSceneOverlay
        cameraPreset={cameraPreset}
        scene={scene}
        display={display}
        onSnapshot={handleSnapshot}
        board={{
          widthMm: activeProjection.board.outline.widthMm,
          heightMm: activeProjection.board.outline.heightMm,
          layerCount: activeProjection.board.layerCount,
          thicknessMm: DEFAULT_BOARD_THICKNESS_MM,
          parts: activeProjection.placements.length,
          traces: activeProjection.traces.length,
          vias: activeProjection.vias.length,
        }}
      />

      {hasRenderableBoardContent(activeProjection) ? (
        <div
          aria-hidden="true"
          data-testid="designer-3d-board-geometry"
          className="pointer-events-none absolute bottom-2 left-2 h-px w-px opacity-0"
        />
      ) : null}

      {!hasRenderableBoardContent(activeProjection) ? (
        <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-4">
          <div
            className={`rounded-lg border px-3 py-2 text-xs ${THREE_D_THEME.accentBorder} ${THREE_D_THEME.panelBackground} ${THREE_D_THEME.mutedText}`}
          >
            Add PCB placements, traces, or vias to populate the 3D board.
          </div>
        </div>
      ) : null}
    </div>
  );
}
