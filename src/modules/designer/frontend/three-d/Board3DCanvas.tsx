import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { DesignerPcbProjection } from "../../../../sdks";
import { CanvasThemeProvider } from "../../../../shared/frontend/canvas/theme";
import { createDesignerApi } from "../api";
import { BoardGeometry } from "./BoardGeometry";
import { DEFAULT_BOARD_THICKNESS_MM } from "./primitives/geometry-utils";
import { ModelCacheProvider } from "./ModelCacheProvider";

interface Board3DCanvasProps {
  backendURL?: string | null;
  moduleId: string;
  selectedDesignId: string | null;
  projection?: DesignerPcbProjection | null;
  loadingProjection?: boolean;
  error: string | null;
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
}: {
  backendURL?: string | null;
  projection: DesignerPcbProjection;
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
      <gridHelper
        args={[
          120,
          24,
          THREE_D_SCENE_COLORS.gridMajor,
          THREE_D_SCENE_COLORS.gridMinor,
        ]}
        position={[0, -DEFAULT_BOARD_THICKNESS_MM / 2, 0]}
      />
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
}: Board3DCanvasProps): ReactElement {
  const api = useMemo(
    () => createDesignerApi({ backendURL, moduleId }),
    [backendURL, moduleId],
  );
  const [fetchedProjection, setFetchedProjection] =
    useState<DesignerPcbProjection | null>(null);
  const [fetchingProjection, setFetchingProjection] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

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
        }}
        className="h-full w-full"
        onCreated={({ invalidate }) => invalidate()}
      >
        <color attach="background" args={[THREE_D_SCENE_COLORS.background]} />
        <Board3DScene backendURL={backendURL} projection={activeProjection} />
      </Canvas>

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
