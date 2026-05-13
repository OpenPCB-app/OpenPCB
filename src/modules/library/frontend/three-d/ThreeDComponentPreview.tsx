import { Bounds, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { ComponentGLB } from "./ComponentGLB";
import { convertStoredFootprintStepModel } from "./model-conversion";

interface FootprintModelMetadata {
  status: string;
  hasModel: boolean;
  glbSha256: string | null;
  sourceStepSha256: string | null;
  sourceFilename: string | null;
  modelRef: unknown | null;
  byteSize: number | null;
  errorMessage: string | null;
}

const PENDING_CLIENT_CONVERSION = "pending_client_conversion";
const FAILED = "failed";

type PreviewState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "pending_client_conversion" }
  | { kind: "ready"; modelUrl: string }
  | { kind: "failed"; message: string }
  | { kind: "unsupported_format" };

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function normalizeMetadataPayload(payload: unknown): FootprintModelMetadata {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid 3D model metadata response");
  }
  const record = payload as { ok?: unknown; data?: unknown };
  if (record.ok !== true || !record.data || typeof record.data !== "object") {
    throw new Error("Invalid 3D model metadata response");
  }
  return record.data as FootprintModelMetadata;
}

export function resolveThreeDPreviewState(
  metadata: FootprintModelMetadata | null,
  modelUrl: string,
  loadError: string | null,
): PreviewState {
  if (loadError) {
    return { kind: "failed", message: loadError };
  }
  if (!metadata) {
    return { kind: "loading" };
  }
  if (metadata.status === "pending" || metadata.status === PENDING_CLIENT_CONVERSION) {
    return { kind: "pending_client_conversion" };
  }
  if (metadata.status === "unsupported_format" || metadata.sourceFilename?.toLowerCase().endsWith(".wrl")) {
    return { kind: "unsupported_format" };
  }
  if (metadata.status === FAILED || metadata.status === "error") {
    return {
      kind: "failed",
      message: metadata.errorMessage ?? "3D model conversion failed",
    };
  }
  if (metadata.status === "ready" && metadata.hasModel && metadata.glbSha256) {
    return { kind: "ready", modelUrl };
  }
  return { kind: "missing" };
}

function LoadingMessage({ children }: { children: string }): ReactElement {
  return (
    <div className="flex h-full items-center justify-center bg-slate-950 text-sm text-slate-300">
      <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/85 px-3 py-2">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-violet-400" />
        {children}
      </div>
    </div>
  );
}

export function ThreeDPreviewStatePanel({
  state,
  isBuiltin,
  onRetry,
}: {
  state: Exclude<PreviewState, { kind: "ready" }>;
  isBuiltin: boolean;
  onRetry?: (() => void) | null;
}): ReactElement {
  if (state.kind === "loading") {
    return <LoadingMessage>Loading 3D model metadata...</LoadingMessage>;
  }
  if (state.kind === "pending_client_conversion") {
    return <LoadingMessage>Converting 3D model…</LoadingMessage>;
  }
  if (state.kind === "unsupported_format") {
    return (
      <div className="flex h-full items-center justify-center bg-slate-950 px-4 text-center text-sm text-amber-200">
        WRL format not supported
      </div>
    );
  }
  if (state.kind === "failed") {
    return (
      <div
        className="flex h-full items-center justify-center bg-red-950/70 px-4 text-center text-sm text-red-200"
        data-testid="library-3d-error"
      >
        <div className="space-y-2">
          <div>{state.message}</div>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mx-auto inline-flex h-9 items-center rounded-lg border border-red-400 bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700"
              data-testid="library-3d-retry-conversion"
            >
              Retry conversion
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center bg-slate-950 px-4 text-center text-sm text-slate-300">
      {isBuiltin ? (
        <span>No 3D model is available for this built-in component.</span>
      ) : (
        <button
          type="button"
          className="inline-flex h-9 items-center rounded-lg border border-violet-500 bg-violet-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-violet-700"
          data-testid="library-3d-upload-step"
        >
          Upload STEP
        </button>
      )}
    </div>
  );
}

function InvalidateOnControlsChange(): ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  return <OrbitControls makeDefault onChange={() => invalidate()} />;
}

function ThreeDCanvas({
  modelUrl,
  category,
  mountType,
}: {
  modelUrl: string;
  category: string;
  mountType: string | null;
}): ReactElement {
  return (
    <Canvas
      frameloop="demand"
      camera={{ position: [3, 3, 3], fov: 45, near: 0.1, far: 1000 }}
      className="h-full w-full bg-slate-950"
      data-testid="library-3d-canvas"
    >
      <ambientLight intensity={2.1} />
      <hemisphereLight args={["#f8fafc", "#64748b", 1.8]} />
      <directionalLight position={[4, 7, 8]} intensity={3.2} />
      <directionalLight position={[-5, -3, 6]} intensity={1.2} />
      <Suspense fallback={null}>
        <Bounds fit clip observe margin={1.25}>
          <ComponentGLB modelUrl={modelUrl} category={category} mountType={mountType} />
        </Bounds>
      </Suspense>
      <InvalidateOnControlsChange />
    </Canvas>
  );
}

export function ThreeDComponentPreview({
  backendURL,
  moduleId,
  footprintId,
  category,
  mountType,
  isBuiltin,
}: {
  backendURL: string | null | undefined;
  moduleId: string;
  footprintId: string;
  category: string;
  mountType: string | null;
  isBuiltin: boolean;
}): ReactElement {
  const [metadata, setMetadata] = useState<FootprintModelMetadata | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const baseUrl = useMemo(() => {
    if (!backendURL) {
      return null;
    }
    return `${backendURL}/api/modules/${encodePathSegment(moduleId)}/footprints/${encodePathSegment(footprintId)}/model`;
  }, [backendURL, footprintId, moduleId]);

  useEffect(() => {
    if (!baseUrl) {
      setMetadata(null);
      setLoadError("Backend URL unavailable");
      return;
    }

    const controller = new AbortController();
    setMetadata(null);
    setLoadError(null);

    const run = async () => {
      try {
        const response = await fetch(`${baseUrl}/meta`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(`3D model metadata fetch failed (HTTP ${response.status})`);
        }
        setMetadata(normalizeMetadataPayload(payload));
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setLoadError(error instanceof Error ? error.message : "Failed to load 3D model metadata");
      }
    };

    void run();
    return () => controller.abort();
  }, [baseUrl]);

  const refreshMetadata = useCallback((): void => {
    if (!baseUrl) return;
    const controller = new AbortController();
    setLoadError(null);
    void (async () => {
      try {
        const response = await fetch(`${baseUrl}/meta`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(`3D model metadata fetch failed (HTTP ${response.status})`);
        }
        setMetadata(normalizeMetadataPayload(payload));
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setLoadError(error instanceof Error ? error.message : "Failed to load 3D model metadata");
      }
    })();
  }, [baseUrl]);

  const canRetryConversion =
    Boolean(baseUrl) &&
    !isBuiltin &&
    metadata?.status === FAILED &&
    typeof metadata.sourceStepSha256 === "string" &&
    typeof metadata.sourceFilename === "string";

  const handleRetry = useCallback(() => {
    if (!backendURL || !baseUrl || !canRetryConversion) {
      return;
    }
    setRetrying(true);
    setLoadError(null);
    setMetadata((prev) =>
      prev ? { ...prev, status: PENDING_CLIENT_CONVERSION } : prev,
    );
    void convertStoredFootprintStepModel({
      backendURL,
      moduleId,
      footprintId,
      sourceStepUrl: `/footprints/${footprintId}/model/source`,
      sourceFilename: metadata!.sourceFilename!,
      sourceStepSha256: metadata!.sourceStepSha256!,
      modelRef: metadata!.modelRef,
      onProgress: (status, message) => {
        if (status === "failed") {
          const failureMessage = message ?? "3D model conversion failed";
          setMetadata((prev) =>
            prev
              ? { ...prev, status: FAILED, errorMessage: failureMessage }
              : prev,
          );
          setLoadError(failureMessage);
        }
      },
    })
      .then(() => {
        refreshMetadata();
      })
      .catch((error) => {
        const failureMessage =
          error instanceof Error ? error.message : "3D model conversion failed";
        setMetadata((prev) =>
          prev ? { ...prev, status: FAILED, errorMessage: failureMessage } : prev,
        );
        setLoadError(failureMessage);
      })
      .finally(() => {
        setRetrying(false);
      });
  }, [backendURL, baseUrl, canRetryConversion, footprintId, metadata, moduleId, refreshMetadata]);

  const modelUrl = metadata?.glbSha256 ? `${baseUrl}?sha=${metadata.glbSha256}` : (baseUrl ?? "");
  const state = resolveThreeDPreviewState(metadata, modelUrl, loadError);

  return (
    <div className="h-64 overflow-hidden rounded-xl border border-slate-200 bg-slate-950 dark:border-slate-800">
      {state.kind === "ready" ? (
        <ThreeDCanvas modelUrl={state.modelUrl} category={category} mountType={mountType} />
      ) : (
        <ThreeDPreviewStatePanel
          state={state}
          isBuiltin={isBuiltin}
          onRetry={
            canRetryConversion && !retrying
              ? handleRetry
              : null
          }
        />
      )}
    </div>
  );
}
