import { Component, Suspense, type ReactNode, type ErrorInfo } from "react";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import type { BoundsMm } from "../../../rendering";
import { EdaCanvas } from "../interaction";
import { GridShader } from "../primitives";
import { toSceneBounds } from "./bounds";
import { usePreviewFit } from "./use-preview-fit";
import type { PreviewCanvasBaseProps } from "./types";

const PREVIEW_NAVIGATION = {
  wheel: {
    enabled: true,
    pinchZoom: true,
    trackpadScroll: "pan" as const,
    zoomAnchor: "cursor" as const,
  },
  middleButtonPan: true,
};

function PreviewFit({
  bounds,
  fitPaddingPx,
  minSpanMm,
  initialZoom,
}: {
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  fitPaddingPx: number;
  minSpanMm: number;
  initialZoom: number;
}) {
  usePreviewFit(bounds, fitPaddingPx, minSpanMm, initialZoom);
  return null;
}

// Kicks one render frame on mount — critical for frameloop="demand"
// after StrictMode remount where the WebGL context is fresh but no deps changed.
function InvalidateOnMount() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidate();
  }, [invalidate]);
  return null;
}

function CanvasLoadingOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-700 border-t-slate-400" />
        Loading preview...
      </div>
    </div>
  );
}

function EmptyStateOverlay({ message }: { message: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="rounded-md border border-slate-700/60 bg-slate-900/55 px-3 py-1.5 text-xs text-slate-300">
        {message}
      </div>
    </div>
  );
}

interface CanvasErrorBoundaryState {
  hasError: boolean;
}

class CanvasErrorBoundary extends Component<
  { children: ReactNode; fallbackMessage: string },
  CanvasErrorBoundaryState
> {
  state: CanvasErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): CanvasErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[PreviewCanvas] Render error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-slate-900">
          <div className="rounded-md border border-red-800/60 bg-red-950/40 px-4 py-2 text-xs text-red-300">
            Canvas render failed.{" "}
            <button
              type="button"
              className="underline hover:text-red-200"
              onClick={() => this.setState({ hasError: false })}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export interface PreviewCanvasShellProps extends PreviewCanvasBaseProps {
  hasModel: boolean;
  bounds: BoundsMm | null;
  emptyMessage: string;
  gridSize: number;
  children: ReactNode;
}

export function PreviewCanvasShell({
  hasModel,
  bounds,
  emptyMessage,
  gridSize,
  className,
  style,
  backgroundColor = "#0f172a",
  showGrid = true,
  fitPaddingPx = 24,
  minSpanMm = 2,
  initialZoom = 40,
  children,
}: PreviewCanvasShellProps) {
  const sceneBounds = toSceneBounds(bounds);

  return (
    <div className={`relative h-full w-full ${className ?? ""}`} style={style}>
      <Suspense fallback={<CanvasLoadingOverlay />}>
        <CanvasErrorBoundary fallbackMessage="Canvas render failed">
          <EdaCanvas
            readOnly
            className="h-full w-full"
            backgroundColor={backgroundColor}
            initialZoom={initialZoom}
            navigation={PREVIEW_NAVIGATION}
          >
            <InvalidateOnMount />
            <PreviewFit
              bounds={sceneBounds}
              fitPaddingPx={fitPaddingPx}
              minSpanMm={minSpanMm}
              initialZoom={initialZoom}
            />
            <GridShader gridSize={gridSize} visible={showGrid} alpha={0.18} />
            {children}
          </EdaCanvas>
        </CanvasErrorBoundary>
      </Suspense>

      {!hasModel ? <EmptyStateOverlay message={emptyMessage} /> : null}
    </div>
  );
}
