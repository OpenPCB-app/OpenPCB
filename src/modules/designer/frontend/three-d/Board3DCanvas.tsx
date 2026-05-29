import {
  ContactShadows,
  Environment,
  Lightformer,
  OrbitControls,
} from "@react-three/drei";
import {
  EffectComposer,
  N8AO,
  SMAA,
  ToneMapping,
} from "@react-three/postprocessing";
import { Canvas, useThree } from "@react-three/fiber";
import { ToneMappingMode } from "postprocessing";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  NoToneMapping,
  Spherical,
  SRGBColorSpace,
  Vector3,
  type PerspectiveCamera,
  type WebGLRenderer,
} from "three";
import type { DesignerPcbProjection } from "../../../../sdks";
import {
  isLikelyTrackpadWheelEvent,
  normalizePanDelta,
  normalizeZoomDelta,
} from "../../../../shared/frontend/canvas/camera/use-eda-camera";
import { CanvasThemeProvider } from "../../../../shared/frontend/canvas/theme";
import { createDesignerApi } from "../api";
import { BoardGeometry } from "./BoardGeometry";
import { DEFAULT_BOARD_THICKNESS_MM } from "./primitives/geometry-utils";
import { SOLDERMASK_GREEN } from "./primitives/materials";
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

// Perspective dolly distance clamp (scene units = mm; board ~100mm, presets ~70–95).
const DOLLY_MIN_DISTANCE = 8;
const DOLLY_MAX_DISTANCE = 400;
const DOLLY_FACTOR_BASE = 0.95; // <1 ⇒ zoom-in when exponent > 0
const DOLLY_GAIN = 8; // exponent multiplier; tune on hardware

/**
 * Dolly the perspective camera toward the cursor ray, keeping the pointed-at
 * world point fixed under the pointer. Mutates `camera.position` + `target`.
 * Returns true if anything changed.
 */
export function applyDollyToCursor(
  camera: PerspectiveCamera,
  target: Vector3,
  zoomDelta: number,
  ndcX: number,
  ndcY: number,
): boolean {
  if (zoomDelta === 0) return false;
  const oldDist = camera.position.distanceTo(target);
  if (oldDist === 0) return false;
  const factor = Math.pow(DOLLY_FACTOR_BASE, zoomDelta * DOLLY_GAIN);
  const newDist = Math.min(
    DOLLY_MAX_DISTANCE,
    Math.max(DOLLY_MIN_DISTANCE, oldDist * factor),
  );
  const eff = newDist / oldDist;
  if (eff === 1) return false;

  // Cursor ray (world) and the focal plane through `target` (normal = view dir).
  const ray = new Vector3(ndcX, ndcY, 0.5)
    .unproject(camera)
    .sub(camera.position)
    .normalize();
  const forward = target.clone().sub(camera.position).normalize();
  const denom = ray.dot(forward);
  // pivot = cursor point at the target's depth (fallback to target if grazing).
  const pivot =
    Math.abs(denom) < 1e-6
      ? target.clone()
      : camera.position
          .clone()
          .addScaledVector(
            ray,
            target.clone().sub(camera.position).dot(forward) / denom,
          );

  const s = 1 - eff; // s>0 ⇒ move toward pivot (zoom in); s<0 ⇒ away (zoom out)
  camera.position.lerp(pivot, s);
  target.lerp(pivot, s);
  return true;
}

/**
 * Screen-space pan (truck/pedestal): shift camera + target together so content
 * tracks the fingers, scaled by view distance so the feel is constant at any
 * zoom. Mutates `camera.position` + `target`. Returns true if anything changed.
 */
export function applyPan(
  camera: PerspectiveCamera,
  target: Vector3,
  e: WheelEvent,
  canvasHeightPx: number,
): boolean {
  const { dx, dy } = normalizePanDelta(e);
  if (dx === 0 && dy === 0) return false;
  if (canvasHeightPx <= 0) return false;
  const dist = camera.position.distanceTo(target);
  const panScale =
    (2 * dist * Math.tan((camera.fov * Math.PI) / 180 / 2)) / canvasHeightPx;
  const right = new Vector3().setFromMatrixColumn(camera.matrix, 0);
  const up = new Vector3().setFromMatrixColumn(camera.matrix, 1);
  const move = right
    .multiplyScalar(dx * panScale)
    .add(up.multiplyScalar(-dy * panScale));
  camera.position.add(move);
  target.add(move);
  return true;
}

// Radians of orbit per canvas-height of swipe (matches OrbitControls' drag feel).
const ROTATE_SPEED = 1;

/**
 * Orbit the camera around the target — same motion as a left-drag — driven by
 * wheel deltas (used for Shift + two-finger swipe). Mutates `camera.position`.
 * Returns true if anything changed.
 */
export function applyRotate(
  camera: PerspectiveCamera,
  target: Vector3,
  e: WheelEvent,
  canvasHeightPx: number,
): boolean {
  const { dx, dy } = normalizePanDelta(e);
  if (dx === 0 && dy === 0) return false;
  if (canvasHeightPx <= 0) return false;
  const offset = camera.position.clone().sub(target);
  const spherical = new Spherical().setFromVector3(offset);
  const factor = (2 * Math.PI * ROTATE_SPEED) / canvasHeightPx;
  // Inverted vs OrbitControls pointer drag so Shift + swipe orbits the other way.
  spherical.theta += dx * factor;
  spherical.phi += dy * factor;
  spherical.makeSafe(); // clamp polar angle off the poles to avoid flips
  offset.setFromSpherical(spherical);
  camera.position.copy(target).add(offset);
  return true;
}

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

// Soldermask tint per board-color preset (see Board3DOverlay BOARD_COLORS).
const SOLDERMASK_COLOR_BY_ID: Record<string, string> = {
  green: "#1e6e4e",
  black: "#15171a",
  blue: "#10367e",
  red: "#7e1416",
  white: "#d8dade",
  yellow: "#b9962a",
};

// Background per scene preset.
const SCENE_BACKGROUND_BY_ID: Record<string, string> = {
  "studio-dark": "#131313",
  "studio-light": "#e9eaec",
  outdoor: "#243447",
  transparent: "#0b0b0d",
};

/** Map the 0–100 transparency slider to soldermask opacity (0 → opaque mask). */
function transparencyToMaskOpacity(transparency: number): number {
  return Math.max(0.06, 0.88 - (transparency / 100) * 0.82);
}

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
      // Wheel zoom is owned by <Board3DTrackpadControls> (pinch → dolly-to-cursor,
      // mouse wheel → dolly); disabling here stops OrbitControls double-handling
      // the wheel. Pan (right-drag) and rotate (left-drag) stay enabled.
      enableZoom={false}
      onChange={() => invalidate()}
      minPolarAngle={0}
      maxPolarAngle={Math.PI}
    />
  );
}

/**
 * Trackpad/mouse-wheel navigation for the perspective scene: pinch → dolly toward
 * the cursor, two-finger swipe → screen-space pan, mouse wheel → dolly. Rotate
 * stays with <OrbitControls> (left-drag). Reuses the 2D canvas's WheelEvent
 * parsers but applies perspective dolly/truck instead of orthographic camera.zoom.
 */
function Board3DTrackpadControls(): null {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  const controls = useThree((s) => s.controls) as {
    target: Vector3;
    update(): void;
  } | null;

  // Mirror latest values into refs so the listener identity stays stable.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      // Non-passive listener: prevents browser page-zoom / scroll on every wheel.
      e.preventDefault();
      const cam = cameraRef.current;
      const ctrls = controlsRef.current;
      if (!ctrls?.target) return;

      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      // Pinch first: isLikelyTrackpadWheelEvent already excludes ctrl/meta.
      const isPinch = e.ctrlKey || e.metaKey;
      let changed: boolean;
      if (isPinch) {
        changed = applyDollyToCursor(
          cam,
          ctrls.target,
          normalizeZoomDelta(e),
          ndcX,
          ndcY,
        );
      } else if (isLikelyTrackpadWheelEvent(e)) {
        // Shift + two-finger swipe orbits like a left-drag; otherwise it pans.
        changed = e.shiftKey
          ? applyRotate(cam, ctrls.target, e, rect.height)
          : applyPan(cam, ctrls.target, e, rect.height);
      } else {
        changed = applyDollyToCursor(
          cam,
          ctrls.target,
          normalizeZoomDelta(e),
          ndcX,
          ndcY,
        );
      }

      if (changed) {
        ctrls.update();
        invalidate();
      }
    },
    [gl, invalidate],
  );

  useEffect(() => {
    const el = gl.domElement;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [gl, handleWheel]);

  return null;
}

/** Requests a render when display/material UI controls change (demand loop). */
function Board3DInvalidateOnChange({ watch }: { watch: string }): null {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
  }, [invalidate, watch]);
  return null;
}

/**
 * Procedural studio IBL — a softbox rig built from Lightformers so metals and
 * the soldermask clearcoat pick up reflections without shipping an .hdr file
 * (keeps the Electron build offline). Rendered once (`frames={1}`) → demand-safe.
 */
function StudioEnvironment(): ReactElement {
  return (
    <Environment resolution={512} frames={1} environmentIntensity={0.85}>
      {/* Big overhead key softbox — broad, even, soft fill for the matte board
          (no specular streak; the surface is matte by design). */}
      <Lightformer
        form="rect"
        intensity={1.5}
        position={[0, 9, 1]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[20, 14, 1]}
      />
      {/* Cool rim from the left */}
      <Lightformer
        intensity={0.8}
        color="#cdd9ff"
        position={[-8, 3, 2]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[8, 8, 1]}
      />
      {/* Warm rim from the right */}
      <Lightformer
        intensity={0.8}
        color="#ffe7c2"
        position={[8, 3, 2]}
        rotation={[0, -Math.PI / 2, 0]}
        scale={[8, 8, 1]}
      />
      {/* Back fill for edge separation */}
      <Lightformer
        intensity={0.9}
        position={[0, 4, -8]}
        rotation={[0, Math.PI, 0]}
        scale={[14, 8, 1]}
      />
      {/* Bottom softbox — mirrors the overhead key so the board underside is
          lit about as evenly as the top (the IBL was top-only before). */}
      <Lightformer
        form="rect"
        intensity={1.3}
        position={[0, -9, 1]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[20, 14, 1]}
      />
    </Environment>
  );
}

/**
 * Screen-space AO (N8AO) + SMAA + filmic tone mapping. AO grounds parts, darkens
 * cavities and plated holes; SMAA replaces the (now-disabled) hardware MSAA,
 * which can't coexist with AO. Renders inside the demand loop — no continuous
 * frames. ToneMapping runs in the composer, so the renderer's own ACES pass is
 * bypassed here (no double tone-mapping).
 */
function Board3DPostFX(): ReactElement {
  return (
    <EffectComposer multisampling={0} enableNormalPass>
      <N8AO
        aoRadius={1.6}
        distanceFalloff={1}
        intensity={1.3}
        quality="high"
        color="#000000"
      />
      <SMAA />
      {/* Khronos PBR-Neutral preserves saturated greens/copper far better than
          ACES (which desaturated the soldermask). This is the only tone-map. */}
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  );
}

function Board3DScene({
  backendURL,
  projection,
  cameraPreset,
  presetNonce,
  showGrid,
  showComponents,
  showSilkscreen,
  maskColor,
  maskOpacity,
}: {
  backendURL?: string | null;
  projection: DesignerPcbProjection;
  cameraPreset: CameraPreset;
  presetNonce: number;
  showGrid: boolean;
  showComponents: boolean;
  showSilkscreen: boolean;
  maskColor: string;
  maskOpacity: number;
}): ReactElement {
  const key = sceneKey(projection);
  return (
    <>
      {/* Even, uniform base fill (lights top + bottom equally). */}
      <ambientLight intensity={0.45} />
      {/* Sky ≈ ground so neither face is favoured. */}
      <hemisphereLight intensity={0.55} color="#ffffff" groundColor="#dfe3e6" />
      {/* Low fill from below so the board underside matches the top. */}
      <directionalLight position={[-20, -40, -15]} intensity={0.7} />
      <directionalLight
        castShadow
        position={[40, 60, 30]}
        intensity={0.85}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={260}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <StudioEnvironment />
      <ContactShadows
        position={[0, -DEFAULT_BOARD_THICKNESS_MM - 0.05, 0]}
        scale={180}
        resolution={1024}
        blur={2.6}
        opacity={0.55}
        far={24}
        frames={1}
        color="#000000"
      />
      <ModelCacheProvider>
        <CanvasThemeProvider mode="dark">
          {/* Rotate PCB geometry (XY-plane) to lie flat in the XZ-plane, front face up */}
          <group rotation={[-Math.PI / 2, 0, 0]}>
            <BoardGeometry
              backendURL={backendURL}
              projection={projection}
              showComponents={showComponents}
              showSilkscreen={showSilkscreen}
              maskColor={maskColor}
              maskOpacity={maskOpacity}
            />
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
      <Board3DTrackpadControls />
      <Board3DPostFX />
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

  const maskColor = SOLDERMASK_COLOR_BY_ID[boardColor] ?? SOLDERMASK_GREEN;
  const maskOpacity = transparencyToMaskOpacity(transparency);
  const background =
    SCENE_BACKGROUND_BY_ID[scene] ?? THREE_D_SCENE_COLORS.background;

  return (
    <div
      data-testid="designer-3d-canvas"
      className={`relative h-full w-full overflow-hidden ${THREE_D_THEME.canvasBackground}`}
    >
      <Canvas
        frameloop="demand"
        shadows="soft"
        camera={{ position: [0, 30, 70], fov: 45, near: 0.1, far: 1000 }}
        dpr={[1, 2]}
        gl={{
          // SMAA (in the post chain) replaces hardware MSAA, which can't
          // coexist with the N8AO depth pass.
          antialias: false,
          alpha: false,
          powerPreference: "high-performance",
          // Required so Snapshot can read the buffer under demand rendering.
          preserveDrawingBuffer: true,
        }}
        className="h-full w-full"
        // Block the browser's own pinch-page-zoom / scroll rubber-banding so the
        // custom wheel handler fully owns trackpad gestures over the canvas.
        style={{ touchAction: "none" }}
        onCreated={({ invalidate, gl }) => {
          glRef.current = gl;
          invalidateRef.current = invalidate;
          // Tone mapping is owned by the post chain's <ToneMapping> (Khronos
          // PBR-Neutral) so the renderer must NOT also tone-map (double-mapping
          // washes the image). Scene renders linear HDR; the composer maps once.
          gl.toneMapping = NoToneMapping;
          gl.toneMappingExposure = 1.0;
          gl.outputColorSpace = SRGBColorSpace;
          invalidate();
        }}
      >
        <color attach="background" args={[background]} />
        <Board3DScene
          backendURL={backendURL}
          projection={activeProjection}
          cameraPreset={cameraPreset}
          presetNonce={presetNonce}
          showGrid={display.grid}
          showComponents={display.components}
          showSilkscreen={display.silkscreen}
          maskColor={maskColor}
          maskOpacity={maskOpacity}
        />
        <Board3DInvalidateOnChange
          watch={`${boardColor}:${scene}:${transparency}:${display.components}:${display.silkscreen}`}
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
