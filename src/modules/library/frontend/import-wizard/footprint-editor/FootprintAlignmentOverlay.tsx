import { type ReactElement } from "react";
import { AlignmentGuideLayer } from "../../../../../shared/frontend/canvas/guides";
import { useFootprintEditorStore } from "./useFootprintEditorStore";

/** Renders the live Figma-style alignment + equal-spacing guides during a drag. */
export function FootprintAlignmentOverlay(): ReactElement | null {
  const visible = useFootprintEditorStore((s) => s.alignmentGuidesVisible);
  const guides = useFootprintEditorStore((s) => s.alignmentGuides);
  const spacing = useFootprintEditorStore((s) => s.alignmentSpacing);
  if (!visible || (guides.length === 0 && spacing.length === 0)) return null;
  return <AlignmentGuideLayer guides={guides} spacing={spacing} />;
}
