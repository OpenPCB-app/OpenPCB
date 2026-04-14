import type { CSSProperties } from "react";
import type {
  FootprintPreviewModel,
  SymbolPreviewModel,
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
  model: SymbolPreviewModel | null;
}

export interface FootprintPreviewCanvasProps extends PreviewCanvasBaseProps {
  model: FootprintPreviewModel | null;
}

export interface SceneBoundsMm {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
