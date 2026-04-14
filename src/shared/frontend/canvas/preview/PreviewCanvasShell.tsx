import type { ReactNode } from "react";
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
    ignoreTrackpadScroll: true,
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded border border-slate-700 bg-slate-950/40 text-xs text-slate-400">
      {message}
    </div>
  );
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
  if (!hasModel) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <EdaCanvas
      readOnly
      className={className}
      style={style}
      backgroundColor={backgroundColor}
      initialZoom={initialZoom}
      navigation={PREVIEW_NAVIGATION}
    >
      <PreviewFit
        bounds={sceneBounds}
        fitPaddingPx={fitPaddingPx}
        minSpanMm={minSpanMm}
        initialZoom={initialZoom}
      />
      <GridShader
        gridSize={gridSize}
        visible={showGrid}
        alpha={0.18}
      />
      {children}
    </EdaCanvas>
  );
}
