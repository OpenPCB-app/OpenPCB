import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import type { ReactElement } from "react";
import type { PcbViewSide } from "../../../../sdks";

/**
 * Side-mode toolbar toggle: `Top↓` / `Bottom↑`. Mirrors Flux's bottom-bar
 * affordance (spec §10). Clicking flips both the X-mirror (handled by
 * PcbScene) and the physical-layer z-order (via `effectiveRenderOrder`).
 */
export function PcbSideModeButton({
  viewSide,
  onToggle,
}: {
  viewSide: PcbViewSide;
  onToggle: () => void;
}): ReactElement {
  const isTop = viewSide === "top";
  const Icon = isTop ? ArrowDownToLine : ArrowUpFromLine;
  const label = isTop ? "Viewing Top" : "Viewing Bot";
  const aria = isTop ? "Switch to bottom view" : "Switch to top view";
  return (
    <button
      type="button"
      onClick={onToggle}
      title={aria}
      aria-label={aria}
      aria-pressed={!isTop}
      data-testid="pcb-flip-view-button"
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/80 px-2 text-xs font-medium text-zinc-100 transition-colors hover:bg-zinc-800"
    >
      <Icon className="size-3.5" strokeWidth={2.25} />
      {label}
    </button>
  );
}
