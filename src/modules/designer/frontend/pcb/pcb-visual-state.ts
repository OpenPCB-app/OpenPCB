import type { PcbCopperLayerId, PcbDisplayMode } from "../../../../sdks";

export type PcbVisualMode = "normal" | "dim" | "solo" | "route-focus";

export interface PcbVisualState {
  mode: PcbVisualMode;
  activeLayer: PcbCopperLayerId | null;
  activeNetId: string | null;
  routeFocusActive: boolean;
  inactiveLayerOpacity: number;
  inactiveNetOpacity: number;
  soloContextOpacity: number;
  boardTintOpacity: number;
  ratsnestOpacity: number;
  ratsnestDimOpacity: number;
}

export function createPcbVisualState({
  displayMode,
  activeLayer,
  routeNetId,
  routeFocusActive = false,
}: {
  displayMode: PcbDisplayMode;
  activeLayer: PcbCopperLayerId | null;
  routeNetId?: string | null;
  routeFocusActive?: boolean;
}): PcbVisualState {
  const hasLayerFocus = activeLayer !== null;
  const mode: PcbVisualMode = routeFocusActive
    ? "route-focus"
    : hasLayerFocus
      ? displayMode === "solo"
        ? "solo"
        : "dim"
      : "normal";
  return {
    mode,
    activeLayer,
    activeNetId: routeNetId ?? null,
    routeFocusActive,
    inactiveLayerOpacity: routeFocusActive
      ? 0.22
      : hasLayerFocus
        ? displayMode === "dim"
          ? 0.16
          : 0.22
        : 1,
    inactiveNetOpacity: routeFocusActive ? 0.18 : 0.18,
    soloContextOpacity: 0.22,
    boardTintOpacity: routeFocusActive ? 0.018 : mode === "solo" ? 0.018 : 0,
    ratsnestOpacity: routeFocusActive ? 0.55 : 0.42,
    ratsnestDimOpacity: routeFocusActive ? 0.12 : 0.16,
  };
}

export function shouldRenderCopperLayer(
  visualState: PcbVisualState,
  layer: PcbCopperLayerId,
): boolean {
  if (visualState.mode !== "solo") return true;
  if (visualState.activeLayer === null) return true;
  return layer === visualState.activeLayer;
}

export function layerOpacity(
  visualState: PcbVisualState,
  layer: PcbCopperLayerId,
): number {
  if (visualState.activeLayer === null) return 1;
  if (layer === visualState.activeLayer) return 1;
  if (visualState.mode === "normal") return 1;
  if (visualState.mode === "solo") return visualState.soloContextOpacity;
  return visualState.inactiveLayerOpacity;
}

export function dimFactorToHexOpacity(opacity: number): number {
  return Math.max(0.08, Math.min(1, opacity));
}
