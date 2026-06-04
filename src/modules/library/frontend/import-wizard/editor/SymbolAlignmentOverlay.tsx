import { type ReactElement } from "react";
import { AlignmentGuideLayer } from "../../../../../shared/frontend/canvas/guides";
import { useSymbolEditorStore } from "./useSymbolEditorStore";

/** Renders the live Figma-style alignment + equal-spacing guides during a drag. */
export function SymbolAlignmentOverlay(): ReactElement | null {
  const visible = useSymbolEditorStore((s) => s.alignmentGuidesVisible);
  const guides = useSymbolEditorStore((s) => s.alignmentGuides);
  const spacing = useSymbolEditorStore((s) => s.alignmentSpacing);
  if (!visible || (guides.length === 0 && spacing.length === 0)) return null;
  return <AlignmentGuideLayer guides={guides} spacing={spacing} />;
}
