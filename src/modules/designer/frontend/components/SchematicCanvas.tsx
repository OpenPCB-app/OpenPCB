import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { OrthographicCamera } from "three";
import {
  EdaCanvas,
  type InteractionEvent,
  type InteractionHandler,
} from "../../../../shared/frontend/canvas/interaction";
import { EDAText, GridShader } from "../../../../shared/frontend/canvas/primitives";
import { SymbolRenderLayer } from "../../../../shared/frontend/canvas/scene";
import { SelectionRectOverlay } from "../../../../shared/frontend/canvas/selection";
import { RENDER_ORDER } from "../../../../shared/frontend/canvas/layers";
import { Units } from "../../../../shared/frontend/canvas/coords";
import {
  isDeleteShortcut,
  isEditableShortcutTarget,
  isSelectAllShortcut,
  matchesKey,
} from "../../../../shared/frontend/canvas/utils/keyboard-shortcuts";
import type {
  DesignerCommand,
  DesignerPlacedPart,
  DesignerPin,
  DesignerSchematicProjection,
  DesignerWire,
  LibraryComponentPlacementDetail,
} from "../../../../sdks";
import type { DesignerWorkspaceActions } from "../hooks/useDesignerWorkspace";
import { SCHEMATIC_GRID_NM, SCHEMATIC_GRID_MM } from "../types";
import { COMPONENT_DND_MIME } from "./DesignerSidebar";
const PIN_HIT_MM = 0.35;
const WIRE_HIT_MM = 0.3;
const LABEL_HIT_MM = 1.2;
const PART_CENTER_FALLBACK_MM = 2.6;

interface PointNm {
  x: number;
  y: number;
}

interface PointMm {
  x: number;
  y: number;
}

interface SelectionState {
  partIds: Set<string>;
  wireIds: Set<string>;
  labelIds: Set<string>;
}

interface DragPartsSession {
  initialPartPositionsNm: Map<string, PointNm>;
  startPointerNm: PointNm;
  deltaNm: PointNm;
}

interface MarqueeSession {
  startMm: PointMm;
  currentMm: PointMm;
  additive: boolean;
  baseSelection: SelectionState;
}

interface WireSession {
  sourcePinId: string;
  waypointsNm: PointNm[];
}

export interface SchematicCanvasHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
}

interface SchematicCanvasProps {
  projection: DesignerSchematicProjection | null;
  selectedPartId: string | null;
  selectedPinId: string | null;
  selectedLabelId: string | null;
  wireSourcePinId: string | null;
  labelDraftText: string;
  gridVisible: boolean;
  draggingComponentId: string | null;
  dragPlacementLoading: boolean;
  dragPlacementDetail: LibraryComponentPlacementDetail | null;
  dragGhostNm: { x: number; y: number } | null;
  actions: DesignerWorkspaceActions;
  onZoomChange?: (zoomPercent: number) => void;
}

function distanceMm(a: PointMm, b: PointMm): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function toMm(pointNm: PointNm): PointMm {
  return {
    x: Units.nmToMm(pointNm.x),
    y: Units.nmToMm(pointNm.y),
  };
}

function toNm(pointMm: PointMm): PointNm {
  return {
    x: Math.round(Units.mmToNm(pointMm.x)),
    y: Math.round(Units.mmToNm(pointMm.y)),
  };
}

function snapNm(pointNm: PointNm): PointNm {
  return {
    x: Math.round(pointNm.x / SCHEMATIC_GRID_NM) * SCHEMATIC_GRID_NM,
    y: Math.round(pointNm.y / SCHEMATIC_GRID_NM) * SCHEMATIC_GRID_NM,
  };
}

function pointKey(point: PointNm): string {
  return `${point.x}:${point.y}`;
}

function dedupeConsecutive(pointsNm: PointNm[]): PointNm[] {
  const out: PointNm[] = [];
  for (const point of pointsNm) {
    const last = out[out.length - 1];
    if (last && pointKey(last) === pointKey(point)) {
      continue;
    }
    out.push(point);
  }
  return out;
}

function buildManhattanPathThroughAnchors(anchorsNm: PointNm[]): PointNm[] {
  if (anchorsNm.length <= 1) {
    return anchorsNm;
  }

  const path: PointNm[] = [{ ...anchorsNm[0]! }];
  for (let index = 1; index < anchorsNm.length; index += 1) {
    const next = anchorsNm[index];
    const prev = path[path.length - 1];
    if (!prev || !next) {
      continue;
    }

    if (prev.x === next.x || prev.y === next.y) {
      path.push({ ...next });
      continue;
    }

    path.push({ x: next.x, y: prev.y });
    path.push({ ...next });
  }

  return dedupeConsecutive(path);
}

function emptySelection(): SelectionState {
  return {
    partIds: new Set<string>(),
    wireIds: new Set<string>(),
    labelIds: new Set<string>(),
  };
}

function cloneSelection(selection: SelectionState): SelectionState {
  return {
    partIds: new Set(selection.partIds),
    wireIds: new Set(selection.wireIds),
    labelIds: new Set(selection.labelIds),
  };
}

function selectionIsEmpty(selection: SelectionState): boolean {
  return (
    selection.partIds.size === 0 &&
    selection.wireIds.size === 0 &&
    selection.labelIds.size === 0
  );
}

function partLocalToWorldMm(part: DesignerPlacedPart, pointMm: PointMm, positionNm: PointNm): PointMm {
  const scaleX = part.mirrored ? -1 : 1;
  const scaledX = pointMm.x * scaleX;
  const scaledY = pointMm.y;
  const radians = (part.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const worldX = scaledX * cos - scaledY * sin + Units.nmToMm(positionNm.x);
  const worldY = scaledX * sin + scaledY * cos + Units.nmToMm(positionNm.y);
  return { x: worldX, y: worldY };
}

function worldToPartLocalMm(part: DesignerPlacedPart, worldMm: PointMm, positionNm: PointNm): PointMm {
  const tx = worldMm.x - Units.nmToMm(positionNm.x);
  const ty = worldMm.y - Units.nmToMm(positionNm.y);
  const radians = (part.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const rotatedX = tx * cos + ty * sin;
  const rotatedY = -tx * sin + ty * cos;
  return {
    x: part.mirrored ? -rotatedX : rotatedX,
    y: rotatedY,
  };
}

function worldBoundsForPart(part: DesignerPlacedPart, positionNm: PointNm): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  const bounds = part.symbol.preview.bounds;
  if (!bounds) {
    return null;
  }

  const p1 = partLocalToWorldMm(part, { x: bounds.minX, y: bounds.minY }, positionNm);
  const p2 = partLocalToWorldMm(part, { x: bounds.maxX, y: bounds.minY }, positionNm);
  const p3 = partLocalToWorldMm(part, { x: bounds.maxX, y: bounds.maxY }, positionNm);
  const p4 = partLocalToWorldMm(part, { x: bounds.minX, y: bounds.maxY }, positionNm);
  const xs = [p1.x, p2.x, p3.x, p4.x];
  const ys = [p1.y, p2.y, p3.y, p4.y];

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function computeProjectionBoundsMm(
  projection: DesignerSchematicProjection,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const part of projection.parts) {
    const bounds = worldBoundsForPart(part, part.positionNm);
    if (bounds) {
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
    }
  }

  for (const wire of projection.wires) {
    for (const point of wire.pointsNm) {
      const mm = Units.nmToMm(point.x);
      const y = Units.nmToMm(point.y);
      minX = Math.min(minX, mm);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, mm);
      maxY = Math.max(maxY, y);
    }
  }

  for (const label of projection.labels) {
    const mm = Units.nmToMm(label.positionNm.x);
    const y = Units.nmToMm(label.positionNm.y);
    minX = Math.min(minX, mm);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, mm);
    maxY = Math.max(maxY, y);
  }

  if (!Number.isFinite(minX)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function pointInRect(pointMm: PointMm, rect: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  return (
    pointMm.x >= rect.minX &&
    pointMm.x <= rect.maxX &&
    pointMm.y >= rect.minY &&
    pointMm.y <= rect.maxY
  );
}

function intersectsRect(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

function distancePointToSegmentMm(point: PointMm, a: PointMm, b: PointMm): { distance: number; projected: PointMm } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return {
      distance: distanceMm(point, a),
      projected: { ...a },
    };
  }
  const tRaw = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq;
  const t = Math.max(0, Math.min(1, tRaw));
  const projected = {
    x: a.x + dx * t,
    y: a.y + dy * t,
  };
  return {
    distance: distanceMm(point, projected),
    projected,
  };
}

function firstSelectedId(set: Set<string>): string | null {
  for (const id of set) {
    return id;
  }
  return null;
}

function WireLayer({ wires, color }: { wires: DesignerWire[]; color: string }) {
  const positions = useMemo(() => {
    const values: number[] = [];
    for (const wire of wires) {
      for (let index = 1; index < wire.pointsNm.length; index += 1) {
        const prev = wire.pointsNm[index - 1];
        const next = wire.pointsNm[index];
        if (!prev || !next) {
          continue;
        }
        values.push(
          Units.nmToMm(prev.x),
          Units.nmToMm(prev.y),
          0,
          Units.nmToMm(next.x),
          Units.nmToMm(next.y),
          0,
        );
      }
    }
    return new Float32Array(values);
  }, [wires]);

  if (positions.length === 0) {
    return null;
  }

  return (
    <lineSegments renderOrder={RENDER_ORDER.WIRES}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={color} depthWrite={false} depthTest={false} />
    </lineSegments>
  );
}

function PartSelectionOutline({ part }: { part: DesignerPlacedPart }) {
  const bounds = part.symbol.preview.bounds;
  const positions = useMemo(() => {
    if (!bounds) {
      return null;
    }
    return new Float32Array([
      bounds.minX,
      bounds.minY,
      0,
      bounds.maxX,
      bounds.minY,
      0,
      bounds.maxX,
      bounds.minY,
      0,
      bounds.maxX,
      bounds.maxY,
      0,
      bounds.maxX,
      bounds.maxY,
      0,
      bounds.minX,
      bounds.maxY,
      0,
      bounds.minX,
      bounds.maxY,
      0,
      bounds.minX,
      bounds.minY,
      0,
    ]);
  }, [bounds]);

  if (!positions) {
    return null;
  }

  return (
    <lineSegments renderOrder={RENDER_ORDER.SELECTION}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#22d3ee" depthTest={false} depthWrite={false} />
    </lineSegments>
  );
}

function InvalidateOnCanvasChange({
  projection,
  cursorNm,
  selection,
  dragSession,
  marqueeSession,
  wireSession,
}: {
  projection: DesignerSchematicProjection | null;
  cursorNm: PointNm | null;
  selection: SelectionState;
  dragSession: DragPartsSession | null;
  marqueeSession: MarqueeSession | null;
  wireSession: WireSession | null;
}) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
  }, [invalidate, projection, cursorNm, selection, dragSession, marqueeSession, wireSession]);
  return null;
}

function ZoomReporter({ onZoomChange }: { onZoomChange?: (zoomPercent: number) => void }) {
  const camera = useThree((state) => state.camera) as OrthographicCamera;
  const lastRef = useRef<number>(camera.zoom);

  useFrame(() => {
    if (!onZoomChange) {
      return;
    }
    if (Math.abs(lastRef.current - camera.zoom) < 0.001) {
      return;
    }
    lastRef.current = camera.zoom;
    onZoomChange(camera.zoom * 2);
  });

  return null;
}

export const SchematicCanvas = forwardRef<SchematicCanvasHandle, SchematicCanvasProps>(
  function SchematicCanvas(props, ref): ReactElement {
    const {
      projection,
      labelDraftText,
      gridVisible,
      draggingComponentId,
      dragPlacementLoading,
      dragPlacementDetail,
      dragGhostNm,
      actions,
      onZoomChange,
    } = props;

    const [cursorNm, setCursorNm] = useState<PointNm | null>(null);
    const [selection, setSelection] = useState<SelectionState>(emptySelection);
    const [dragSession, setDragSession] = useState<DragPartsSession | null>(null);
    const [marqueeSession, setMarqueeSession] = useState<MarqueeSession | null>(null);
    const [wireSession, setWireSession] = useState<WireSession | null>(null);
    const [armedLabelText, setArmedLabelText] = useState<string | null>(null);
    const cameraRef = useRef<OrthographicCamera | null>(null);

    useEffect(() => {
      actions.setSelectedPartId(firstSelectedId(selection.partIds));
      actions.setSelectedLabelId(firstSelectedId(selection.labelIds));
      const pinId = wireSession?.sourcePinId ?? null;
      actions.setSelectedPinId(pinId);
      actions.setWireSourcePinId(pinId);
    }, [actions, selection, wireSession]);

    useEffect(() => {
      if (!projection) {
        setSelection(emptySelection());
        setWireSession(null);
        setDragSession(null);
        setMarqueeSession(null);
        return;
      }

      setSelection((current) => {
        const partIds = new Set(
          [...current.partIds].filter((id) => projection.parts.some((part) => part.id === id)),
        );
        const wireIds = new Set(
          [...current.wireIds].filter((id) => projection.wires.some((wire) => wire.id === id)),
        );
        const labelIds = new Set(
          [...current.labelIds].filter((id) => projection.labels.some((label) => label.id === id)),
        );
        return { partIds, wireIds, labelIds };
      });

      if (
        wireSession &&
        !projection.parts.some((part) =>
          part.pins.some((pin) => pin.id === wireSession.sourcePinId),
        )
      ) {
        setWireSession(null);
      }
    }, [projection, wireSession]);

    useImperativeHandle(ref, () => ({
      zoomIn() {
        const camera = cameraRef.current;
        if (!camera) return;
        camera.zoom = Math.min(camera.zoom * 1.15, 500);
        camera.updateProjectionMatrix();
        onZoomChange?.(camera.zoom * 2);
      },
      zoomOut() {
        const camera = cameraRef.current;
        if (!camera) return;
        camera.zoom = Math.max(camera.zoom / 1.15, 5);
        camera.updateProjectionMatrix();
        onZoomChange?.(camera.zoom * 2);
      },
      fit() {
        const camera = cameraRef.current;
        if (!camera || !projection) return;

        const bounds = computeProjectionBoundsMm(projection);
        if (!bounds) {
          camera.position.set(0, 0, camera.position.z);
          camera.zoom = 35;
          camera.updateProjectionMatrix();
          onZoomChange?.(camera.zoom * 2);
          return;
        }

        const canvas = cameraRef.current?.userData?.canvas as HTMLCanvasElement | undefined;
        const width = canvas?.clientWidth ?? 800;
        const height = canvas?.clientHeight ?? 600;

        const contentWidth = bounds.maxX - bounds.minX;
        const contentHeight = bounds.maxY - bounds.minY;
        const padding = Math.max(contentWidth, contentHeight) * 0.1;

        const paddedWidth = contentWidth + padding * 2;
        const paddedHeight = contentHeight + padding * 2;

        const zoomX = width / paddedWidth;
        const zoomY = height / paddedHeight;
        const zoom = Math.min(zoomX, zoomY);

        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;

        camera.position.set(centerX, centerY, camera.position.z);
        camera.zoom = Math.max(5, Math.min(zoom, 500));
        camera.updateProjectionMatrix();
        onZoomChange?.(camera.zoom * 2);
      },
    }));

    const renderedPartPositionNm = useCallback(
      (part: DesignerPlacedPart): PointNm => {
        const initial = dragSession?.initialPartPositionsNm.get(part.id);
        if (!initial || !dragSession) {
          return { x: part.positionNm.x, y: part.positionNm.y };
        }
        return {
          x: initial.x + dragSession.deltaNm.x,
          y: initial.y + dragSession.deltaNm.y,
        };
      },
      [dragSession],
    );

    const pinById = useMemo(() => {
      const map = new Map<string, DesignerPin>();
      if (!projection) {
        return map;
      }
      for (const part of projection.parts) {
        for (const pin of part.pins) {
          map.set(pin.id, pin);
        }
      }
      return map;
    }, [projection]);

    const hitPin = useCallback(
      (worldNm: PointNm): DesignerPin | null => {
        if (!projection) {
          return null;
        }
        const cursor = toMm(worldNm);
        let best: DesignerPin | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const part of projection.parts) {
          for (const pin of part.pins) {
            const d = distanceMm(cursor, toMm(pin.worldPositionNm));
            if (d < bestDistance) {
              bestDistance = d;
              best = pin;
            }
          }
        }
        return bestDistance <= PIN_HIT_MM ? best : null;
      },
      [projection],
    );

    const hitWire = useCallback(
      (worldNm: PointNm): { wire: DesignerWire; projectedNm: PointNm } | null => {
        if (!projection) {
          return null;
        }
        const cursor = toMm(worldNm);
        let bestWire: DesignerWire | null = null;
        let bestProjected: PointNm | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (const wire of projection.wires) {
          for (let index = 1; index < wire.pointsNm.length; index += 1) {
            const prev = wire.pointsNm[index - 1];
            const next = wire.pointsNm[index];
            if (!prev || !next) {
              continue;
            }
            const metric = distancePointToSegmentMm(cursor, toMm(prev), toMm(next));
            if (metric.distance < bestDistance) {
              bestDistance = metric.distance;
              bestWire = wire;
              bestProjected = toNm(metric.projected);
            }
          }
        }

        if (!bestWire || !bestProjected || bestDistance > WIRE_HIT_MM) {
          return null;
        }
        return {
          wire: bestWire,
          projectedNm: bestProjected,
        };
      },
      [projection],
    );

    const hitLabelId = useCallback(
      (worldNm: PointNm): string | null => {
        if (!projection) {
          return null;
        }
        const cursor = toMm(worldNm);
        let bestId: string | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const label of projection.labels) {
          const d = distanceMm(cursor, toMm(label.positionNm));
          if (d < bestDistance) {
            bestDistance = d;
            bestId = label.id;
          }
        }
        return bestDistance <= LABEL_HIT_MM ? bestId : null;
      },
      [projection],
    );

    const hitPartId = useCallback(
      (worldNm: PointNm): string | null => {
        if (!projection) {
          return null;
        }
        const cursorMm = toMm(worldNm);

        for (const part of projection.parts) {
          const positionNm = renderedPartPositionNm(part);
          const bounds = part.symbol.preview.bounds;
          if (!bounds) {
            continue;
          }
          const local = worldToPartLocalMm(part, cursorMm, positionNm);
          if (
            local.x >= bounds.minX &&
            local.x <= bounds.maxX &&
            local.y >= bounds.minY &&
            local.y <= bounds.maxY
          ) {
            return part.id;
          }
        }

        let bestPartId: string | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const part of projection.parts) {
          const position = toMm(renderedPartPositionNm(part));
          const d = distanceMm(cursorMm, position);
          if (d < bestDistance) {
            bestDistance = d;
            bestPartId = part.id;
          }
        }
        return bestDistance <= PART_CENTER_FALLBACK_MM ? bestPartId : null;
      },
      [projection, renderedPartPositionNm],
    );

    const dispatchCommandsSequentially = useCallback(
      async (commands: DesignerCommand[]) => {
        for (const command of commands) {
          await actions.dispatchCommand(command);
        }
      },
      [actions],
    );

    const commitWireToPin = useCallback(
      async (sourcePin: DesignerPin, targetPin: DesignerPin, waypointsNm: PointNm[]) => {
        const anchors = [sourcePin.worldPositionNm, ...waypointsNm, targetPin.worldPositionNm];
        const pointsNm = buildManhattanPathThroughAnchors(anchors);
        await actions.dispatchCommand({
          type: "create_wire",
          sourcePinId: sourcePin.id,
          targetPinId: targetPin.id,
          pointsNm,
        });
      },
      [actions],
    );

    const commitWireToWireJunction = useCallback(
      async (
        sourcePin: DesignerPin,
        wire: DesignerWire,
        junctionNm: PointNm,
        waypointsNm: PointNm[],
      ) => {
        const anchors = [sourcePin.worldPositionNm, ...waypointsNm, junctionNm];
        const pointsNm = buildManhattanPathThroughAnchors(anchors);
        await actions.dispatchCommand({
          type: "create_wire_junction",
          sourcePinId: sourcePin.id,
          wireId: wire.id,
          targetPointNm: junctionNm,
          pointsNm,
        });
      },
      [actions],
    );

    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (isEditableShortcutTarget(event.target)) {
          return;
        }

        if (matchesKey(event, "Escape")) {
          if (wireSession || marqueeSession || dragSession || armedLabelText) {
            event.preventDefault();
            setWireSession(null);
            setMarqueeSession(null);
            setDragSession(null);
            setArmedLabelText(null);
            actions.setWireSourcePinId(null);
          }
          return;
        }

        if (isSelectAllShortcut(event)) {
          if (!projection) {
            return;
          }
          event.preventDefault();
          setSelection({
            partIds: new Set(projection.parts.map((part) => part.id)),
            wireIds: new Set(projection.wires.map((wire) => wire.id)),
            labelIds: new Set(projection.labels.map((label) => label.id)),
          });
          return;
        }

        if (isDeleteShortcut(event)) {
          if (!projection || selectionIsEmpty(selection)) {
            return;
          }
          event.preventDefault();

          // Wires connected to deleted parts are cascade-deleted by the backend.
          // Exclude those wires from explicit deletion to avoid "not found" errors.
          const partIdsToDelete = new Set(selection.partIds);
          const wireIdsToDelete = new Set(selection.wireIds);
          for (const wire of projection.wires) {
            if (!wireIdsToDelete.has(wire.id)) {
              continue;
            }
            const sourcePartId = wire.sourcePinId.split(":")[0];
            const targetPartId = wire.targetPinId.split(":")[0];
            if (
              (sourcePartId && partIdsToDelete.has(sourcePartId)) ||
              (targetPartId && partIdsToDelete.has(targetPartId))
            ) {
              wireIdsToDelete.delete(wire.id);
            }
          }

          const commands: DesignerCommand[] = [];
          for (const partId of partIdsToDelete) {
            commands.push({ type: "delete_entity", entityId: partId, entityKind: "part" });
          }
          for (const wireId of wireIdsToDelete) {
            commands.push({ type: "delete_entity", entityId: wireId, entityKind: "wire" });
          }
          for (const labelId of selection.labelIds) {
            commands.push({ type: "delete_entity", entityId: labelId, entityKind: "label" });
          }
          void dispatchCommandsSequentially(commands)
            .then(() => setSelection(emptySelection()))
            .catch((error) =>
              actions.setError(error instanceof Error ? error.message : "Delete failed"),
            );
          return;
        }

        if (
          matchesKey(event, "r") &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          selection.partIds.size > 0 &&
          projection
        ) {
          event.preventDefault();
          const delta = event.shiftKey ? -90 : 90;
          const commands: DesignerCommand[] = [];
          for (const partId of selection.partIds) {
            const part = projection.parts.find((candidate) => candidate.id === partId);
            if (!part) {
              continue;
            }
            const next = (((part.rotationDeg + delta) % 360) + 360) % 360;
            if (next !== 0 && next !== 90 && next !== 180 && next !== 270) {
              continue;
            }
            commands.push({
              type: "rotate_part",
              partId,
              rotationDeg: next,
            });
          }
          if (commands.length === 0) {
            return;
          }
          void dispatchCommandsSequentially(commands).catch((error) =>
            actions.setError(error instanceof Error ? error.message : "Rotate failed"),
          );
          return;
        }

        if (!event.ctrlKey && !event.metaKey && !event.altKey && matchesKey(event, "l")) {
          event.preventDefault();
          setArmedLabelText(labelDraftText.trim() || "NET");
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [
      actions,
      armedLabelText,
      dispatchCommandsSequentially,
      dragSession,
      labelDraftText,
      marqueeSession,
      projection,
      selection,
      wireSession,
    ]);

    const interactionHandler: InteractionHandler = useMemo(
      () => ({
        onPointerMove(event) {
          const worldNm = {
            x: Math.round(event.worldPoint.x),
            y: Math.round(event.worldPoint.y),
          };
          setCursorNm(worldNm);

          if (dragSession) {
            const rawDelta = {
              x: worldNm.x - dragSession.startPointerNm.x,
              y: worldNm.y - dragSession.startPointerNm.y,
            };
            const snappedDelta = snapNm(rawDelta);
            if (
              snappedDelta.x !== dragSession.deltaNm.x ||
              snappedDelta.y !== dragSession.deltaNm.y
            ) {
              setDragSession({
                ...dragSession,
                deltaNm: snappedDelta,
              });
            }
          }

          if (marqueeSession) {
            setMarqueeSession({
              ...marqueeSession,
              currentMm: toMm(worldNm),
            });
          }
        },
        onPointerLeave() {
          setCursorNm(null);
        },
        onPointerDown(event) {
          if (!projection) {
            return;
          }

          const worldNm = {
            x: Math.round(event.worldPoint.x),
            y: Math.round(event.worldPoint.y),
          };
          const snappedWorldNm = snapNm(worldNm);
          const pin = hitPin(worldNm);
          const wireHit = hitWire(worldNm);
          const partId = hitPartId(worldNm);
          const labelId = hitLabelId(worldNm);

          if (armedLabelText) {
            const text = armedLabelText.trim();
            if (!text) {
              setArmedLabelText(null);
              return;
            }
            void actions
              .dispatchCommand({
                type: "upsert_label",
                text,
                labelId: labelId ?? undefined,
                positionNm: snappedWorldNm,
              })
              .then(() => {
                setArmedLabelText(null);
              })
              .catch((err) =>
                actions.setError(err instanceof Error ? err.message : "Failed to label"),
              );
            return;
          }

          if (wireSession) {
            const activeSession = wireSession;
            const sourcePin = pinById.get(activeSession.sourcePinId);
            if (!sourcePin) {
              setWireSession(null);
              actions.setWireSourcePinId(null);
              return;
            }

            if (pin && pin.id !== activeSession.sourcePinId) {
              void commitWireToPin(sourcePin, pin, activeSession.waypointsNm)
                .then(() => {
                  setWireSession(null);
                  actions.setWireSourcePinId(null);
                })
                .catch((err) =>
                  actions.setError(err instanceof Error ? err.message : "Failed to wire"),
                );
              return;
            }

            if (wireHit) {
              void commitWireToWireJunction(
                sourcePin,
                wireHit.wire,
                wireHit.projectedNm,
                activeSession.waypointsNm,
              )
                .then(() => {
                  setWireSession(null);
                  actions.setWireSourcePinId(null);
                })
                .catch((err) =>
                  actions.setError(
                    err instanceof Error ? err.message : "Failed to create wire junction",
                  ),
                );
              return;
            }

            setWireSession({
              ...activeSession,
              waypointsNm: [...activeSession.waypointsNm, snappedWorldNm],
            });
            return;
          }

          if (pin) {
            setWireSession({
              sourcePinId: pin.id,
              waypointsNm: [],
            });
            actions.setWireSourcePinId(pin.id);
            return;
          }

            if (partId) {
              setMarqueeSession(null);
              setWireSession(null);

              const nextSelection = cloneSelection(selection);
              if (event.modifiers.shift) {
                if (nextSelection.partIds.has(partId)) {
                  nextSelection.partIds.delete(partId);
                } else {
                  nextSelection.partIds.add(partId);
                }
                setSelection(nextSelection);
                return;
              }

              if (!nextSelection.partIds.has(partId) || selection.partIds.size > 1) {
                setSelection({
                  partIds: new Set([partId]),
                  wireIds: new Set(),
                  labelIds: new Set(),
                });
              }

              const selectedPartIds =
                selection.partIds.has(partId) && selection.partIds.size > 0
                  ? [...selection.partIds]
                  : [partId];
              const initialPartPositionsNm = new Map<string, PointNm>();
              for (const selectedPartId of selectedPartIds) {
                const selectedPart = projection.parts.find((part) => part.id === selectedPartId);
                if (!selectedPart) {
                  continue;
                }
                initialPartPositionsNm.set(selectedPartId, {
                  x: selectedPart.positionNm.x,
                  y: selectedPart.positionNm.y,
                });
              }

              setDragSession({
                initialPartPositionsNm,
                startPointerNm: worldNm,
                deltaNm: { x: 0, y: 0 },
              });
              return;
            }

            if (wireHit) {
              const nextSelection = cloneSelection(selection);
              if (event.modifiers.shift) {
                if (nextSelection.wireIds.has(wireHit.wire.id)) {
                  nextSelection.wireIds.delete(wireHit.wire.id);
                } else {
                  nextSelection.wireIds.add(wireHit.wire.id);
                }
                setSelection(nextSelection);
              } else {
                setSelection({
                  partIds: new Set(),
                  wireIds: new Set([wireHit.wire.id]),
                  labelIds: new Set(),
                });
              }
              setDragSession(null);
              return;
            }

            if (labelId) {
              const nextSelection = cloneSelection(selection);
              if (event.modifiers.shift) {
                if (nextSelection.labelIds.has(labelId)) {
                  nextSelection.labelIds.delete(labelId);
                } else {
                  nextSelection.labelIds.add(labelId);
                }
                setSelection(nextSelection);
              } else {
                setSelection({
                  partIds: new Set(),
                  wireIds: new Set(),
                  labelIds: new Set([labelId]),
                });
              }
              setDragSession(null);
              return;
            }

            const startMm = toMm(worldNm);
            setDragSession(null);
            setMarqueeSession({
              startMm,
              currentMm: startMm,
              additive: event.modifiers.shift,
              baseSelection: cloneSelection(selection),
            });
            if (!event.modifiers.shift) {
              setSelection(emptySelection());
            }
        },
        onPointerUp() {
          if (!projection) {
            return;
          }

          if (dragSession) {
            const hasMovement = dragSession.deltaNm.x !== 0 || dragSession.deltaNm.y !== 0;
            if (hasMovement) {
              const commands: DesignerCommand[] = [];
              for (const [partId, initial] of dragSession.initialPartPositionsNm.entries()) {
                commands.push({
                  type: "move_part",
                  partId,
                  positionNm: {
                    x: initial.x + dragSession.deltaNm.x,
                    y: initial.y + dragSession.deltaNm.y,
                  },
                });
              }
              void dispatchCommandsSequentially(commands).catch((err) =>
                actions.setError(err instanceof Error ? err.message : "Failed to move"),
              );
            }
            setDragSession(null);
            return;
          }

          if (marqueeSession) {
            const minX = Math.min(marqueeSession.startMm.x, marqueeSession.currentMm.x);
            const maxX = Math.max(marqueeSession.startMm.x, marqueeSession.currentMm.x);
            const minY = Math.min(marqueeSession.startMm.y, marqueeSession.currentMm.y);
            const maxY = Math.max(marqueeSession.startMm.y, marqueeSession.currentMm.y);
            const rect = { minX, minY, maxX, maxY };

            const next = marqueeSession.additive
              ? cloneSelection(marqueeSession.baseSelection)
              : emptySelection();

            for (const part of projection.parts) {
              const bounds = worldBoundsForPart(part, renderedPartPositionNm(part));
              if (bounds && intersectsRect(bounds, rect)) {
                next.partIds.add(part.id);
              }
            }

            for (const wire of projection.wires) {
              if (wire.pointsNm.length === 0) {
                continue;
              }
              let minWireX = Number.POSITIVE_INFINITY;
              let minWireY = Number.POSITIVE_INFINITY;
              let maxWireX = Number.NEGATIVE_INFINITY;
              let maxWireY = Number.NEGATIVE_INFINITY;
              for (const point of wire.pointsNm) {
                const mm = toMm(point);
                minWireX = Math.min(minWireX, mm.x);
                minWireY = Math.min(minWireY, mm.y);
                maxWireX = Math.max(maxWireX, mm.x);
                maxWireY = Math.max(maxWireY, mm.y);
              }
              if (
                Number.isFinite(minWireX) &&
                intersectsRect(
                  { minX: minWireX, minY: minWireY, maxX: maxWireX, maxY: maxWireY },
                  rect,
                )
              ) {
                next.wireIds.add(wire.id);
              }
            }

            for (const label of projection.labels) {
              if (pointInRect(toMm(label.positionNm), rect)) {
                next.labelIds.add(label.id);
              }
            }

            setSelection(next);
            setMarqueeSession(null);
          }
        },
        onDragEnter(event) {
          const componentId = event.getData(COMPONENT_DND_MIME);
          if (componentId && componentId !== draggingComponentId) {
            void actions.beginDragComponent(componentId).catch(() => {});
          }
          actions.setDragGhostNm({
            x: Math.round(event.snappedPoint.x),
            y: Math.round(event.snappedPoint.y),
          });
        },
        onDragOver(event) {
          const componentId = event.getData(COMPONENT_DND_MIME);
          if (componentId && !dragPlacementDetail && !dragPlacementLoading) {
            void actions.beginDragComponent(componentId).catch(() => {});
          }
          actions.setDragGhostNm({
            x: Math.round(event.snappedPoint.x),
            y: Math.round(event.snappedPoint.y),
          });
        },
        onDragLeave() {
          actions.setDragGhostNm(null);
        },
        onDrop(event) {
          const componentId = event.getData(COMPONENT_DND_MIME);
          if (!componentId) {
            actions.clearDragState();
            return;
          }

          const placementReady =
            !dragPlacementLoading &&
            !!dragPlacementDetail &&
            dragPlacementDetail.component.id === componentId &&
            !!dragGhostNm;
          if (!placementReady) {
            actions.setError("Drop not ready yet. Wait for ghost preview.");
            actions.clearDragState();
            return;
          }

          const snapped = snapNm({
            x: Math.round(event.snappedPoint.x),
            y: Math.round(event.snappedPoint.y),
          });

          void actions
            .dispatchCommand({
              type: "place_part",
              componentId,
              positionNm: snapped,
            })
            .catch((err) =>
              actions.setError(err instanceof Error ? err.message : "Failed to drop place"),
            );
          actions.clearDragState();
        },
      }),
      [
        actions,
        armedLabelText,
        commitWireToPin,
        commitWireToWireJunction,
        dispatchCommandsSequentially,
        dragPlacementDetail,
        dragPlacementLoading,
        dragGhostNm,
        dragSession,
        draggingComponentId,
        hitLabelId,
        hitPartId,
        hitPin,
        hitWire,
        labelDraftText,
        marqueeSession,
        pinById,
        projection,
        renderedPartPositionNm,
        selection,
        wireSession,
      ],
    );

    const selectedWires = useMemo(() => {
      if (!projection || selection.wireIds.size === 0) {
        return [];
      }
      return projection.wires.filter((wire) => selection.wireIds.has(wire.id));
    }, [projection, selection.wireIds]);

    const unselectedWires = useMemo(() => {
      if (!projection) {
        return [];
      }
      if (selection.wireIds.size === 0) {
        return projection.wires;
      }
      return projection.wires.filter((wire) => !selection.wireIds.has(wire.id));
    }, [projection, selection.wireIds]);

    const wirePreview = useMemo(() => {
      if (!projection || !wireSession || !cursorNm) {
        return null;
      }
      const sourcePin = pinById.get(wireSession.sourcePinId);
      if (!sourcePin) {
        return null;
      }
      const anchors = [sourcePin.worldPositionNm, ...wireSession.waypointsNm, snapNm(cursorNm)];
      const pointsNm = buildManhattanPathThroughAnchors(anchors);
      return {
        id: "preview",
        sourcePinId: sourcePin.id,
        targetPinId: "cursor",
        pointsNm,
      } satisfies DesignerWire;
    }, [cursorNm, pinById, projection, wireSession]);

    const dragGhostModel = dragPlacementDetail?.symbol.preview ?? null;
    const selectionRect = marqueeSession
      ? { a: marqueeSession.startMm, b: marqueeSession.currentMm }
      : null;

    return (
      <section className="relative h-full w-full min-h-0 rounded-none bg-slate-950">
        <EdaCanvas
          readOnly={false}
          interactionHandler={interactionHandler}
          className="h-full w-full"
          backgroundColor="#0b1120"
          initialZoom={35}
          enableDragDrop
          gridSize={SCHEMATIC_GRID_NM}
        >
          <CameraRefBridge cameraRef={cameraRef} onZoomChange={onZoomChange} />
          <ZoomReporter onZoomChange={onZoomChange} />
          <InvalidateOnCanvasChange
            projection={projection}
            cursorNm={cursorNm}
            selection={selection}
            dragSession={dragSession}
            marqueeSession={marqueeSession}
            wireSession={wireSession}
          />

          <GridShader gridSize={SCHEMATIC_GRID_MM} visible={gridVisible} alpha={0.16} />

          {projection ? (
            <>
              <WireLayer wires={unselectedWires} color="#67e8f9" />
              {selectedWires.length > 0 ? <WireLayer wires={selectedWires} color="#22d3ee" /> : null}
              {wirePreview ? <WireLayer wires={[wirePreview]} color="#f59e0b" /> : null}

              {projection.parts.map((part) => {
                const model = part.symbol.preview;
                const positionNm = renderedPartPositionNm(part);
                const x = Units.nmToMm(positionNm.x);
                const y = Units.nmToMm(positionNm.y);
                const rotationRad = (part.rotationDeg * Math.PI) / 180;
                const scaleX = part.mirrored ? -1 : 1;
                const selected = selection.partIds.has(part.id);

                return (
                  <group
                    key={part.id}
                    position={[x, y, 0]}
                    rotation={[0, 0, rotationRad]}
                    scale={[scaleX, 1, 1]}
                  >
                    <SymbolRenderLayer model={model} />
                    {selected ? <PartSelectionOutline part={part} /> : null}
                  </group>
                );
              })}

              {projection.labels.map((label) => {
                const selected = selection.labelIds.has(label.id);
                return (
                  <EDAText
                    key={label.id}
                    position={[Units.nmToMm(label.positionNm.x), Units.nmToMm(label.positionNm.y), 0]}
                    color={selected ? "#22d3ee" : "#a5b4fc"}
                    fontSize={0.9}
                    anchorX="left"
                    anchorY="middle"
                  >
                    {label.text}
                  </EDAText>
                );
              })}

              {projection.junctions.map((junction) => (
                <mesh
                  key={`${junction.xNm}:${junction.yNm}`}
                  position={[Units.nmToMm(junction.xNm), Units.nmToMm(junction.yNm), 0]}
                  renderOrder={RENDER_ORDER.JUNCTIONS}
                >
                  <circleGeometry args={[0.08, 14]} />
                  <meshBasicMaterial color="#e2e8f0" depthTest={false} depthWrite={false} />
                </mesh>
              ))}

              {selectionRect ? (
                <SelectionRectOverlay a={selectionRect.a} b={selectionRect.b} color="#22d3ee" />
              ) : null}

              {dragGhostNm && dragGhostModel ? (
                <group
                  position={[Units.nmToMm(dragGhostNm.x), Units.nmToMm(dragGhostNm.y), 0]}
                  renderOrder={RENDER_ORDER.PREVIEW}
                >
                  <SymbolRenderLayer model={dragGhostModel} />
                  <mesh>
                    <circleGeometry args={[0.9, 24]} />
                    <meshBasicMaterial
                      color="#22d3ee"
                      transparent
                      opacity={0.2}
                      depthTest={false}
                      depthWrite={false}
                    />
                  </mesh>
                </group>
              ) : null}
            </>
          ) : null}
        </EdaCanvas>
      </section>
    );
  },
);

function CameraRefBridge({
  cameraRef,
  onZoomChange,
}: {
  cameraRef: React.MutableRefObject<OrthographicCamera | null>;
  onZoomChange?: (zoomPercent: number) => void;
}) {
  const camera = useThree((state) => state.camera) as OrthographicCamera;

  useEffect(() => {
    cameraRef.current = camera;
    onZoomChange?.(camera.zoom * 2);
  }, [camera, cameraRef, onZoomChange]);

  return null;
}
