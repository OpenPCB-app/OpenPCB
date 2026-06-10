import { useCallback, useEffect, useRef, useState } from "react";

/** Live orthographic camera state reported by the canvas `ViewportReporter`. */
export interface CanvasViewport {
  zoom: number;
  posX: number;
  posY: number;
}

export interface CanvasRect {
  width: number;
  height: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** True when the projected point lies within the canvas rect. */
  onScreen: boolean;
}

const NM_TO_MM = 1_000_000;
const EDGE_PADDING_PX = 22;

/**
 * Pure orthographic world→screen projection. `worldMm` is in scene millimetres;
 * the result is in CSS pixels relative to the canvas rect top-left. This is the
 * exact inverse of the EDA camera's screen→world math (`zoomToCursor` in
 * r3f-eda-canvas): the camera left/right/top/bottom are in scene mm and `zoom`
 * is CSS px per mm, so a point at `camPos` maps to the canvas centre.
 */
export function worldToScreen(
  worldMm: { x: number; y: number },
  viewport: CanvasViewport,
  rect: CanvasRect,
  mirrorX = false,
): { x: number; y: number } {
  const wx = mirrorX ? -worldMm.x : worldMm.x;
  return {
    x: rect.width / 2 + (wx - viewport.posX) * viewport.zoom,
    y: rect.height / 2 - (worldMm.y - viewport.posY) * viewport.zoom,
  };
}

/**
 * Tracks the live viewport + canvas size for a canvas wrapper element and
 * projects world-anchored (nm) points to wrapper-relative screen pixels. Used
 * by the floating comment overlay so pins/popups stay glued to their anchor
 * through pan/zoom.
 *
 * `setViewport` is meant to be fed from the canvas `ViewportReporter`
 * (`useFrame`); reports are coalesced to one React update per animation frame.
 */
export function useCanvasProjection(
  wrapperRef: React.RefObject<HTMLElement | null>,
  initialViewport?: { zoom: number; posX: number; posY: number } | null,
) {
  const [viewport, setViewportState] = useState<CanvasViewport>(() => ({
    zoom: initialViewport?.zoom ?? 50,
    posX: initialViewport?.posX ?? 0,
    posY: initialViewport?.posY ?? 0,
  }));
  const [rect, setRect] = useState<CanvasRect>({ width: 0, height: 0 });

  // Coalesce per-frame viewport reports into a single React update per frame.
  const pendingRef = useRef<CanvasViewport | null>(null);
  const rafRef = useRef<number | null>(null);
  const setViewport = useCallback(
    (zoom: number, posX: number, posY: number) => {
      pendingRef.current = { zoom, posX, posY };
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const next = pendingRef.current;
        pendingRef.current = null;
        if (next) setViewportState(next);
      });
    },
    [],
  );

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // The R3F <canvas> fills the wrapper, so the wrapper's content box size is
  // the canvas size in CSS px (which `zoom` is expressed against).
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () =>
      setRect({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wrapperRef]);

  const project = useCallback(
    (anchorNm: { x: number; y: number }, mirrorX = false): ScreenPoint => {
      const px = worldToScreen(
        { x: anchorNm.x / NM_TO_MM, y: anchorNm.y / NM_TO_MM },
        viewport,
        rect,
        mirrorX,
      );
      const onScreen =
        px.x >= 0 && px.x <= rect.width && px.y >= 0 && px.y <= rect.height;
      return { x: px.x, y: px.y, onScreen };
    },
    [viewport, rect],
  );

  /** Inverse of `project`: wrapper-relative screen px → world nanometres. */
  const screenToWorld = useCallback(
    (
      screen: { x: number; y: number },
      mirrorX = false,
    ): { x: number; y: number } => {
      const zoom = viewport.zoom || 1;
      const wxRaw = (screen.x - rect.width / 2) / zoom + viewport.posX;
      const worldMmX = mirrorX ? -wxRaw : wxRaw;
      const worldMmY = viewport.posY + (rect.height / 2 - screen.y) / zoom;
      return {
        x: Math.round(worldMmX * NM_TO_MM),
        y: Math.round(worldMmY * NM_TO_MM),
      };
    },
    [viewport, rect],
  );

  /** Clamp an (off-screen) point to the nearest canvas edge, keeping padding. */
  const clampToEdge = useCallback(
    (screen: { x: number; y: number }) => ({
      x: Math.min(
        Math.max(screen.x, EDGE_PADDING_PX),
        Math.max(EDGE_PADDING_PX, rect.width - EDGE_PADDING_PX),
      ),
      y: Math.min(
        Math.max(screen.y, EDGE_PADDING_PX),
        Math.max(EDGE_PADDING_PX, rect.height - EDGE_PADDING_PX),
      ),
    }),
    [rect],
  );

  return { viewport, rect, setViewport, project, screenToWorld, clampToEdge };
}
