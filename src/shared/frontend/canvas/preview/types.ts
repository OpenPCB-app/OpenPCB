import type { CSSProperties } from "react";
import type {
  FootprintRenderModel,
  SymbolRenderModel,
} from "../../../rendering";

export interface PreviewCanvasBaseProps {
  className?: string;
  style?: CSSProperties;
  backgroundColor?: string;
  showGrid?: boolean;
  fitPaddingPx?: number;
  minSpanMm?: number;
  initialZoom?: number;
}

export interface SymbolPreviewCanvasProps extends PreviewCanvasBaseProps {
  model: SymbolRenderModel | null;
  emptyMessage?: string;
}

export interface FootprintPreviewCanvasProps extends PreviewCanvasBaseProps {
  model: FootprintRenderModel | null;
  emptyMessage?: string;
  fitToGeometryOnly?: boolean;
}

export interface SceneBoundsMm {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
