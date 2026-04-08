/**
 * DragDropOverlay — HTML overlay that bridges native drag-drop events to R3F.
 *
 * All drag event listeners are attached to the parent container element
 * (not the overlay div) to avoid timing issues with pointerEvents toggling.
 * The overlay div is kept purely as a drop zone indicator if needed.
 */

import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import type * as THREE from "three";
import {
  DEFAULT_INTERACTION_COORDINATE_TRANSFORM,
  type DragDropEvent,
  type InteractionCoordinateTransform,
  type InteractionHandler,
} from "./types";
import { snapPointToGridNm, type Vec2 } from "../coords";

interface DragDropOverlayProps {
  cameraRef: React.RefObject<THREE.OrthographicCamera | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  handler: InteractionHandler | null;
  gridSize?: number;
  interactionCoordinateTransform?: InteractionCoordinateTransform;
  enabled?: boolean;
}

const overlayStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  pointerEvents: "none",
  zIndex: 10,
};

export function DragDropOverlay({
  cameraRef,
  canvasRef,
  handler,
  gridSize = 0,
  interactionCoordinateTransform = DEFAULT_INTERACTION_COORDINATE_TRANSFORM,
  enabled = true,
}: DragDropOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): Vec2 => {
      const canvas = canvasRef.current;
      const camera = cameraRef.current;
      if (!canvas || !camera) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

      const sceneX =
        camera.position.x + (ndcX * rect.width) / (2 * camera.zoom);
      const sceneY =
        camera.position.y + (ndcY * rect.height) / (2 * camera.zoom);

      return interactionCoordinateTransform.scenePointToWorldPoint({
        x: sceneX,
        y: sceneY,
      });
    },
    [canvasRef, cameraRef, interactionCoordinateTransform],
  );

  const buildEvent = useCallback(
    (e: DragEvent): DragDropEvent | null => {
      if (!e.dataTransfer) return null;
      const worldPoint = screenToWorld(e.clientX, e.clientY);
      const snappedPoint =
        gridSize > 0 ? snapPointToGridNm(worldPoint, gridSize) : worldPoint;

      return {
        worldPoint,
        snappedPoint,
        types: Array.from(e.dataTransfer.types),
        getData: (mime: string) => e.dataTransfer!.getData(mime),
        dropEffect: e.dataTransfer.dropEffect,
      };
    },
    [screenToWorld, gridSize],
  );

  // Attach ALL drag event listeners to the parent container to avoid
  // pointerEvents timing issues between parent and overlay elements
  useEffect(() => {
    const el = overlayRef.current;
    if (!el || !enabled) return;

    const parent = el.parentElement;
    if (!parent) return;

    let dragActive = false;

    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragActive = true;
      const evt = buildEvent(e);
      if (evt) handler?.onDragEnter?.(evt);
    };

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      if (!dragActive) return;
      const evt = buildEvent(e);
      if (evt) handler?.onDragOver?.(evt);
    };

    const onDragLeave = (e: DragEvent) => {
      const related = e.relatedTarget as Node | null;
      if (related && parent.contains(related)) return;
      dragActive = false;
      handler?.onDragLeave?.();
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragActive = false;
      const evt = buildEvent(e);
      if (evt) handler?.onDrop?.(evt);
    };

    parent.addEventListener("dragenter", onDragEnter);
    parent.addEventListener("dragover", onDragOver);
    parent.addEventListener("dragleave", onDragLeave);
    parent.addEventListener("drop", onDrop);

    return () => {
      parent.removeEventListener("dragenter", onDragEnter);
      parent.removeEventListener("dragover", onDragOver);
      parent.removeEventListener("dragleave", onDragLeave);
      parent.removeEventListener("drop", onDrop);
    };
  }, [enabled, handler, buildEvent]);

  if (!enabled) return null;

  return <div ref={overlayRef} style={overlayStyle} />;
}
