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
import * as THREE from "three";
import type { OrthographicCamera } from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import {
  EdaCanvas,
  type InteractionEvent,
  type InteractionHandler,
} from "../../../../shared/frontend/canvas/interaction";
import {
  EDAText,
  GridShader,
} from "../../../../shared/frontend/canvas/primitives";
import { SymbolRenderLayer } from "../../../../shared/frontend/canvas/scene";
import { SelectionRectOverlay } from "../../../../shared/frontend/canvas/selection";
import { RENDER_ORDER } from "../../../../shared/frontend/canvas/layers";
import { useCanvasTheme } from "../../../../shared/frontend/canvas/theme";
import { Units } from "../../../../shared/frontend/canvas/coords";
import {
  DEFAULT_SCHEMATIC_ZOOM,
  NET_LABEL_FONT_MM,
} from "../../../../shared/frontend/canvas/defaults";
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
  DesignerPrimitive,
  DesignerPrimitiveKind,
  DesignerSchematicProjection,
  DesignerWire,
  LibraryComponentPlacementDetail,
} from "../../../../sdks";
import type { SymbolRenderModel } from "../../../../shared/rendering";
import type { DesignerWorkspaceActions } from "../hooks/useDesignerWorkspace";
import { SCHEMATIC_GRID_NM, SCHEMATIC_GRID_MM } from "../types";
import { COMPONENT_DND_MIME } from "./DesignerSidebar";
import { useDesignerHighlight } from "../useDesignerHighlight";
import {
  PrimitiveGhost,
  SchematicPrimitivesLayer,
} from "./SchematicPrimitivesLayer";
import { NetPortalPicker, PwrRailPicker } from "./LabelPicker";
const PIN_HIT_MM = 0.35;
// Primitive connection dots are rendered larger (≈0.36 mm radius), so the
// hit zone must be wider than for part pins to match the visible target.
const PRIMITIVE_PIN_HIT_MM = 0.7;
const WIRE_HIT_MM = 0.3;
const LABEL_HIT_MM = 1.2;
const PART_CENTER_FALLBACK_MM = 2.6;

// Local-space (mm) AABB per primitive kind, matching the geometry drawn in
// SchematicPrimitivesLayer. Connection point is at (0, 0); the rest of the
// glyph hangs above or below. Padded slightly so the visible body is the
// click target, not just the connection dot.
const PRIMITIVE_HIT_PADDING_MM = 0.4;
const PRIMITIVE_LOCAL_BOUNDS_MM: Record<
  "gnd" | "pwr" | "net_portal",
  { minX: number; minY: number; maxX: number; maxY: number }
> = {
  gnd: { minX: -2.032, minY: -3.556, maxX: 2.032, maxY: 0 },
  pwr: { minX: -1.27, minY: 0, maxX: 1.27, maxY: 2.794 },
  net_portal: { minX: -4.47, minY: -1.016, maxX: 0, maxY: 1.016 },
};

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
  primitiveIds: Set<string>;
}

type ArmedPrimitive =
  | { kind: "gnd" }
  | { kind: "pwr"; railText: string }
  | { kind: "net_portal"; portalText: string }
  | null;

interface DragPartsSession {
  initialPartPositionsNm: Map<string, PointNm>;
  initialPrimitivePositionsNm: Map<string, PointNm>;
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
  /**
   * Arm the next click for a primitive placement. PWR/portal need text;
   * supplying an empty string lets the canvas open its inline picker.
   */
  armPrimitive(kind: DesignerPrimitiveKind, text?: string): void;
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
    primitiveIds: new Set<string>(),
  };
}

function cloneSelection(selection: SelectionState): SelectionState {
  return {
    partIds: new Set(selection.partIds),
    wireIds: new Set(selection.wireIds),
    labelIds: new Set(selection.labelIds),
    primitiveIds: new Set(selection.primitiveIds),
  };
}

function selectionIsEmpty(selection: SelectionState): boolean {
  return (
    selection.partIds.size === 0 &&
    selection.wireIds.size === 0 &&
    selection.labelIds.size === 0 &&
    selection.primitiveIds.size === 0
  );
}

function partLocalToWorldMm(
  part: DesignerPlacedPart,
  pointMm: PointMm,
  positionNm: PointNm,
): PointMm {
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

function worldToPartLocalMm(
  part: DesignerPlacedPart,
  worldMm: PointMm,
  positionNm: PointNm,
): PointMm {
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

function worldBoundsForPart(
  part: DesignerPlacedPart,
  positionNm: PointNm,
): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  const bounds = part.symbol.preview.bounds;
  if (!bounds) {
    return null;
  }

  const p1 = partLocalToWorldMm(
    part,
    { x: bounds.minX, y: bounds.minY },
    positionNm,
  );
  const p2 = partLocalToWorldMm(
    part,
    { x: bounds.maxX, y: bounds.minY },
    positionNm,
  );
  const p3 = partLocalToWorldMm(
    part,
    { x: bounds.maxX, y: bounds.maxY },
    positionNm,
  );
  const p4 = partLocalToWorldMm(
    part,
    { x: bounds.minX, y: bounds.maxY },
    positionNm,
  );
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

  for (const primitive of projection.primitives) {
    const localBounds = PRIMITIVE_LOCAL_BOUNDS_MM[primitive.kind];
    if (!localBounds) continue;
    const cx = Units.nmToMm(primitive.positionNm.x);
    const cy = Units.nmToMm(primitive.positionNm.y);
    const rad = (primitive.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const corners: PointMm[] = [
      { x: localBounds.minX, y: localBounds.minY },
      { x: localBounds.maxX, y: localBounds.minY },
      { x: localBounds.maxX, y: localBounds.maxY },
      { x: localBounds.minX, y: localBounds.maxY },
    ];
    for (const corner of corners) {
      const wx = cx + corner.x * cos - corner.y * sin;
      const wy = cy + corner.x * sin + corner.y * cos;
      minX = Math.min(minX, wx);
      minY = Math.min(minY, wy);
      maxX = Math.max(maxX, wx);
      maxY = Math.max(maxY, wy);
    }
  }

  if (!Number.isFinite(minX)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function pointInRect(
  pointMm: PointMm,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
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
  return !(
    a.maxX < b.minX ||
    a.minX > b.maxX ||
    a.maxY < b.minY ||
    a.minY > b.maxY
  );
}

function distancePointToSegmentMm(
  point: PointMm,
  a: PointMm,
  b: PointMm,
): { distance: number; projected: PointMm } {
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

/**
 * Schematic wire stroke width in mm. Rendered with LineSegments2 +
 * LineMaterial in world-units mode so it stays a true 0.05 mm at every zoom
 * level instead of a fixed 1-pixel hairline. ~2× the previous 1-px line
 * without overpowering symbol-body strokes.
 */
const SCHEMATIC_WIRE_WIDTH_MM = 0.18;

// KiCad-style net classification by name. Matches the same regexes used
// server-side in `pcb/net-class-resolver.ts` plus common +Vn / -Vn rails
// (e.g. "+5V", "+3V3", "-12V").
const GND_NET_NAMES = /^(GND|GROUND|AGND|DGND|EARTH|VSS|VEE)$/i;
const POWER_NET_NAMES = /^(VCC|VDD|VBAT|VBUS|VIN|VOUT|[+-]\d+V\d*|[+-]V\w*)$/i;

type WireNetClass = "default" | "gnd" | "power";

function classifyNetByName(name: string | undefined | null): WireNetClass {
  if (!name) return "default";
  const trimmed = name.trim();
  if (trimmed.length === 0) return "default";
  if (GND_NET_NAMES.test(trimmed)) return "gnd";
  if (POWER_NET_NAMES.test(trimmed)) return "power";
  return "default";
}

function WireLayer({
  wires,
  color,
  opacity = 1,
}: {
  wires: DesignerWire[];
  color: string;
  opacity?: number;
}) {
  const size = useThree((s) => s.size);

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

  const geometry = useMemo(() => {
    if (positions.length === 0) return null;
    const geom = new LineSegmentsGeometry();
    geom.setPositions(positions);
    return geom;
  }, [positions]);

  const material = useMemo(() => {
    return new LineMaterial({
      color: new THREE.Color(color).getHex(),
      linewidth: SCHEMATIC_WIRE_WIDTH_MM,
      worldUnits: true,
      transparent: opacity < 1,
      opacity,
      depthTest: false,
      depthWrite: false,
    });
  }, [color, opacity]);

  useEffect(() => {
    material.resolution.set(size.width, size.height);
  }, [material, size.width, size.height]);

  // Create the line with renderOrder + computed distances baked in so the
  // first paint is correct. A separate cleanup effect disposes the
  // geometry/material on unmount or when deps change — without this, swapping
  // wires causes Three.js to retain the old GL buffers/uniforms.
  const line = useMemo(() => {
    if (!geometry) return null;
    const built = new LineSegments2(geometry, material);
    built.computeLineDistances();
    built.renderOrder = RENDER_ORDER.WIRES;
    return built;
  }, [geometry, material]);

  useEffect(
    () => () => {
      geometry?.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  if (!line) return null;
  return <primitive object={line} />;
}

function PartSelectionOutline({
  part,
  color,
}: {
  part: DesignerPlacedPart;
  color: string;
}) {
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
      <lineBasicMaterial color={color} depthTest={false} depthWrite={false} />
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
  }, [
    invalidate,
    projection,
    cursorNm,
    selection,
    dragSession,
    marqueeSession,
    wireSession,
  ]);
  return null;
}

function ZoomReporter({
  onZoomChange,
}: {
  onZoomChange?: (zoomPercent: number) => void;
}) {
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

export const SchematicCanvas = forwardRef<
  SchematicCanvasHandle,
  SchematicCanvasProps
>(function SchematicCanvas(props, ref): ReactElement {
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
  const [marqueeSession, setMarqueeSession] = useState<MarqueeSession | null>(
    null,
  );
  const [wireSession, setWireSession] = useState<WireSession | null>(null);
  const [armedLabelText, setArmedLabelText] = useState<string | null>(null);
  const [armedPrimitive, setArmedPrimitive] = useState<ArmedPrimitive>(null);
  const [pwrPickerOpen, setPwrPickerOpen] = useState(false);
  const [netPortalPickerOpen, setNetPortalPickerOpen] = useState(false);
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
        [...current.partIds].filter((id) =>
          projection.parts.some((part) => part.id === id),
        ),
      );
      const wireIds = new Set(
        [...current.wireIds].filter((id) =>
          projection.wires.some((wire) => wire.id === id),
        ),
      );
      const labelIds = new Set(
        [...current.labelIds].filter((id) =>
          projection.labels.some((label) => label.id === id),
        ),
      );
      const primitiveIds = new Set(
        [...current.primitiveIds].filter((id) =>
          projection.primitives.some((primitive) => primitive.id === id),
        ),
      );
      return { partIds, wireIds, labelIds, primitiveIds };
    });

    if (wireSession) {
      const sourceId = wireSession.sourcePinId;
      const stillExists = sourceId.startsWith("primitive:")
        ? projection.primitives.some(
            (p) => p.id === sourceId.slice("primitive:".length),
          )
        : projection.parts.some((part) =>
            part.pins.some((pin) => pin.id === sourceId),
          );
      if (!stillExists) {
        setWireSession(null);
      }
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
    armPrimitive(kind, text) {
      if (kind === "gnd") {
        setArmedPrimitive({ kind: "gnd" });
        return;
      }
      if (kind === "pwr") {
        const railText = text?.trim();
        if (railText && railText.length > 0) {
          setArmedPrimitive({ kind: "pwr", railText });
        } else {
          setPwrPickerOpen(true);
        }
        return;
      }
      // net_portal
      const portalText =
        text?.trim() ??
        window.prompt("Net portal name (matches across the schematic):") ??
        "";
      const trimmed = portalText.trim();
      if (trimmed.length === 0) {
        setArmedPrimitive(null);
        return;
      }
      setArmedPrimitive({ kind: "net_portal", portalText: trimmed });
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

      const canvas = cameraRef.current?.userData?.canvas as
        | HTMLCanvasElement
        | undefined;
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

  const renderedPrimitivePositionNm = useCallback(
    (primitive: DesignerPrimitive): PointNm => {
      const initial = dragSession?.initialPrimitivePositionsNm.get(
        primitive.id,
      );
      if (!initial || !dragSession) {
        return { x: primitive.positionNm.x, y: primitive.positionNm.y };
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
    // Synthetic single-pin entries for each primitive's connection point.
    // Connection point is local (0, 0); rotation pivots around it so the
    // world position equals the primitive's position.
    for (const primitive of projection.primitives) {
      const id = `primitive:${primitive.id}`;
      map.set(id, {
        id,
        originPinKey: id,
        number: null,
        name: primitive.kind,
        electricalType: "passive",
        unit: 1,
        localPositionNm: { x: 0, y: 0 },
        worldPositionNm: { ...primitive.positionNm },
      });
    }
    return map;
  }, [projection]);

  const hitPin = useCallback(
    (worldNm: PointNm): DesignerPin | null => {
      if (!projection) {
        return null;
      }
      const cursor = toMm(worldNm);
      // Per-pin hit-test: each candidate brings its own threshold (part pins
      // use PIN_HIT_MM, primitive synth pins use the wider PRIMITIVE_PIN_HIT_MM
      // to match their bigger visible dot). Pick the nearest pin whose
      // distance is within its own threshold.
      //
      // Synthetic primitive pins are sourced from `pinById`, which is built
      // from the same `projection` we iterate here — they are guaranteed to
      // refer to a live primitive. Stale-source protection for in-flight wire
      // drags lives in the projection-change effect that nulls `wireSession`
      // when its source pin disappears.
      let best: DesignerPin | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const part of projection.parts) {
        for (const pin of part.pins) {
          const d = distanceMm(cursor, toMm(pin.worldPositionNm));
          if (d <= PIN_HIT_MM && d < bestDistance) {
            bestDistance = d;
            best = pin;
          }
        }
      }
      for (const primitive of projection.primitives) {
        const synthPin = pinById.get(`primitive:${primitive.id}`);
        if (!synthPin) continue;
        const d = distanceMm(cursor, toMm(synthPin.worldPositionNm));
        if (d <= PRIMITIVE_PIN_HIT_MM && d < bestDistance) {
          bestDistance = d;
          best = synthPin;
        }
      }
      return best;
    },
    [pinById, projection],
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
          const metric = distancePointToSegmentMm(
            cursor,
            toMm(prev),
            toMm(next),
          );
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

  const hitPrimitiveId = useCallback(
    (worldNm: PointNm): string | null => {
      if (!projection) return null;
      const cursorMm = toMm(worldNm);
      // Glyph-bounds hit-test: transform cursor into the primitive's local
      // frame (inverse of position + rotation) and check the kind's AABB
      // padded by PRIMITIVE_HIT_PADDING_MM.
      for (const primitive of projection.primitives) {
        const positionNm = renderedPrimitivePositionNm(primitive);
        const tx = cursorMm.x - Units.nmToMm(positionNm.x);
        const ty = cursorMm.y - Units.nmToMm(positionNm.y);
        const rad = (primitive.rotationDeg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        // inverse rotation: [cos sin; -sin cos]
        const localX = tx * cos + ty * sin;
        const localY = -tx * sin + ty * cos;
        const bounds = PRIMITIVE_LOCAL_BOUNDS_MM[primitive.kind];
        const pad = PRIMITIVE_HIT_PADDING_MM;
        if (
          localX >= bounds.minX - pad &&
          localX <= bounds.maxX + pad &&
          localY >= bounds.minY - pad &&
          localY <= bounds.maxY + pad
        ) {
          return primitive.id;
        }
      }
      // Fallback: nearest connection-point within a small radius (catches
      // misclicks just above the GND pin stub etc.).
      let bestId: string | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const primitive of projection.primitives) {
        const d = distanceMm(
          cursorMm,
          toMm(renderedPrimitivePositionNm(primitive)),
        );
        if (d < bestDistance) {
          bestDistance = d;
          bestId = primitive.id;
        }
      }
      return bestDistance <= 0.6 ? bestId : null;
    },
    [projection, renderedPrimitivePositionNm],
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
    async (
      sourcePin: DesignerPin,
      targetPin: DesignerPin,
      waypointsNm: PointNm[],
    ) => {
      const anchors = [
        sourcePin.worldPositionNm,
        ...waypointsNm,
        targetPin.worldPositionNm,
      ];
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
        if (
          wireSession ||
          marqueeSession ||
          dragSession ||
          armedLabelText ||
          armedPrimitive ||
          pwrPickerOpen ||
          netPortalPickerOpen
        ) {
          event.preventDefault();
          setWireSession(null);
          setMarqueeSession(null);
          setDragSession(null);
          setArmedLabelText(null);
          setArmedPrimitive(null);
          setPwrPickerOpen(false);
          setNetPortalPickerOpen(false);
          actions.setWireSourcePinId(null);
        }
        return;
      }

      if (isSelectAllShortcut(event)) {
        if (!projection) {
          return;
        }
        // Ctrl/Cmd+A selects every drawable in the schematic — parts, wires,
        // labels, AND primitives (GND/PWR/NET_PORTAL ports). A subsequent
        // Delete therefore removes primitives along with parts; this is
        // intentional and matches the marquee-select behavior.
        event.preventDefault();
        setSelection({
          partIds: new Set(projection.parts.map((part) => part.id)),
          wireIds: new Set(projection.wires.map((wire) => wire.id)),
          labelIds: new Set(projection.labels.map((label) => label.id)),
          primitiveIds: new Set(
            projection.primitives.map((primitive) => primitive.id),
          ),
        });
        return;
      }

      if (isDeleteShortcut(event)) {
        if (!projection || selectionIsEmpty(selection)) {
          return;
        }
        event.preventDefault();

        // Wires connected to deleted parts/primitives are cascade-deleted
        // by the backend. Exclude those from explicit deletion to avoid
        // "not found" errors.
        const partIdsToDelete = new Set(selection.partIds);
        const primitiveIdsToDelete = new Set(selection.primitiveIds);
        const wireIdsToDelete = new Set(selection.wireIds);
        const pinReferencesDeletedEntity = (pinId: string): boolean => {
          if (pinId.startsWith("primitive:")) {
            return primitiveIdsToDelete.has(pinId.slice("primitive:".length));
          }
          const partId = pinId.split(":")[0];
          return !!partId && partIdsToDelete.has(partId);
        };
        for (const wire of projection.wires) {
          if (!wireIdsToDelete.has(wire.id)) continue;
          if (
            pinReferencesDeletedEntity(wire.sourcePinId) ||
            pinReferencesDeletedEntity(wire.targetPinId)
          ) {
            wireIdsToDelete.delete(wire.id);
          }
        }

        const commands: DesignerCommand[] = [];
        for (const partId of partIdsToDelete) {
          commands.push({
            type: "delete_entity",
            entityId: partId,
            entityKind: "part",
          });
        }
        for (const wireId of wireIdsToDelete) {
          commands.push({
            type: "delete_entity",
            entityId: wireId,
            entityKind: "wire",
          });
        }
        for (const labelId of selection.labelIds) {
          commands.push({
            type: "delete_entity",
            entityId: labelId,
            entityKind: "label",
          });
        }
        for (const primitiveId of selection.primitiveIds) {
          commands.push({
            type: "delete_entity",
            entityId: primitiveId,
            entityKind: "primitive",
          });
        }
        void dispatchCommandsSequentially(commands)
          .then(() => setSelection(emptySelection()))
          .catch((error) =>
            actions.setError(
              error instanceof Error ? error.message : "Delete failed",
            ),
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
          const part = projection.parts.find(
            (candidate) => candidate.id === partId,
          );
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
          actions.setError(
            error instanceof Error ? error.message : "Rotate failed",
          ),
        );
        return;
      }

      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        matchesKey(event, "l")
      ) {
        event.preventDefault();
        setArmedLabelText(labelDraftText.trim() || "NET");
        return;
      }

      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        matchesKey(event, "g")
      ) {
        event.preventDefault();
        setArmedPrimitive({ kind: "gnd" });
        return;
      }

      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        matchesKey(event, "p")
      ) {
        event.preventDefault();
        setPwrPickerOpen(true);
        return;
      }

      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        matchesKey(event, "h")
      ) {
        event.preventDefault();
        setNetPortalPickerOpen(true);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    actions,
    armedLabelText,
    armedPrimitive,
    pwrPickerOpen,
    netPortalPickerOpen,
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
        const primitiveId = hitPrimitiveId(worldNm);

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
              actions.setError(
                err instanceof Error ? err.message : "Failed to label",
              ),
            );
          return;
        }

        if (armedPrimitive) {
          const command =
            armedPrimitive.kind === "gnd"
              ? {
                  type: "place_gnd_port" as const,
                  positionNm: snappedWorldNm,
                }
              : armedPrimitive.kind === "pwr"
                ? {
                    type: "place_pwr_port" as const,
                    positionNm: snappedWorldNm,
                    railText: armedPrimitive.railText,
                  }
                : {
                    type: "place_net_portal" as const,
                    positionNm: snappedWorldNm,
                    portalText: armedPrimitive.portalText,
                  };
          void actions
            .dispatchCommand(command)
            .then(() => {
              setArmedPrimitive(null);
            })
            .catch((err) =>
              actions.setError(
                err instanceof Error
                  ? err.message
                  : "Failed to place primitive",
              ),
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
                actions.setError(
                  err instanceof Error ? err.message : "Failed to wire",
                ),
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
                  err instanceof Error
                    ? err.message
                    : "Failed to create wire junction",
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

          if (
            !nextSelection.partIds.has(partId) ||
            selection.partIds.size > 1
          ) {
            setSelection({
              partIds: new Set([partId]),
              wireIds: new Set(),
              labelIds: new Set(),
              primitiveIds: new Set(),
            });
          }

          const selectedPartIds =
            selection.partIds.has(partId) && selection.partIds.size > 0
              ? [...selection.partIds]
              : [partId];
          const initialPartPositionsNm = new Map<string, PointNm>();
          for (const selectedPartId of selectedPartIds) {
            const selectedPart = projection.parts.find(
              (part) => part.id === selectedPartId,
            );
            if (!selectedPart) {
              continue;
            }
            initialPartPositionsNm.set(selectedPartId, {
              x: selectedPart.positionNm.x,
              y: selectedPart.positionNm.y,
            });
          }

          // Co-drag any primitives that were already in the selection so
          // mixed-selection (shift-click part + primitive) drags both kinds
          // together rather than silently dropping the primitive.
          const initialPrimitivePositionsNm = new Map<string, PointNm>();
          if (selection.partIds.has(partId)) {
            for (const id of selection.primitiveIds) {
              const found = projection.primitives.find((p) => p.id === id);
              if (!found) continue;
              initialPrimitivePositionsNm.set(id, {
                x: found.positionNm.x,
                y: found.positionNm.y,
              });
            }
          }

          setDragSession({
            initialPartPositionsNm,
            initialPrimitivePositionsNm,
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
              primitiveIds: new Set(),
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
              primitiveIds: new Set(),
            });
          }
          setDragSession(null);
          return;
        }

        if (primitiveId) {
          setMarqueeSession(null);
          setWireSession(null);

          const nextSelection = cloneSelection(selection);
          if (event.modifiers.shift) {
            if (nextSelection.primitiveIds.has(primitiveId)) {
              nextSelection.primitiveIds.delete(primitiveId);
            } else {
              nextSelection.primitiveIds.add(primitiveId);
            }
            setSelection(nextSelection);
            return;
          }

          if (
            !nextSelection.primitiveIds.has(primitiveId) ||
            selection.primitiveIds.size > 1
          ) {
            setSelection({
              partIds: new Set(),
              wireIds: new Set(),
              labelIds: new Set(),
              primitiveIds: new Set([primitiveId]),
            });
          }

          const selectedPrimitiveIds =
            selection.primitiveIds.has(primitiveId) &&
            selection.primitiveIds.size > 0
              ? [...selection.primitiveIds]
              : [primitiveId];
          const initialPrimitivePositionsNm = new Map<string, PointNm>();
          for (const id of selectedPrimitiveIds) {
            const found = projection.primitives.find((p) => p.id === id);
            if (!found) continue;
            initialPrimitivePositionsNm.set(id, {
              x: found.positionNm.x,
              y: found.positionNm.y,
            });
          }

          // Co-drag any parts that were already in the selection — symmetric
          // counterpart to the part-click branch above.
          const initialPartPositionsNm = new Map<string, PointNm>();
          if (selection.primitiveIds.has(primitiveId)) {
            for (const id of selection.partIds) {
              const found = projection.parts.find((p) => p.id === id);
              if (!found) continue;
              initialPartPositionsNm.set(id, {
                x: found.positionNm.x,
                y: found.positionNm.y,
              });
            }
          }

          setDragSession({
            initialPartPositionsNm,
            initialPrimitivePositionsNm,
            startPointerNm: worldNm,
            deltaNm: { x: 0, y: 0 },
          });
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
          const hasMovement =
            dragSession.deltaNm.x !== 0 || dragSession.deltaNm.y !== 0;
          if (hasMovement) {
            const commands: DesignerCommand[] = [];
            for (const [
              partId,
              initial,
            ] of dragSession.initialPartPositionsNm.entries()) {
              commands.push({
                type: "move_part",
                partId,
                positionNm: {
                  x: initial.x + dragSession.deltaNm.x,
                  y: initial.y + dragSession.deltaNm.y,
                },
              });
            }
            for (const [
              primitiveId,
              initial,
            ] of dragSession.initialPrimitivePositionsNm.entries()) {
              commands.push({
                type: "move_primitive",
                primitiveId,
                positionNm: {
                  x: initial.x + dragSession.deltaNm.x,
                  y: initial.y + dragSession.deltaNm.y,
                },
              });
            }
            void dispatchCommandsSequentially(commands).catch((err) =>
              actions.setError(
                err instanceof Error ? err.message : "Failed to move",
              ),
            );
          }
          setDragSession(null);
          return;
        }

        if (marqueeSession) {
          const minX = Math.min(
            marqueeSession.startMm.x,
            marqueeSession.currentMm.x,
          );
          const maxX = Math.max(
            marqueeSession.startMm.x,
            marqueeSession.currentMm.x,
          );
          const minY = Math.min(
            marqueeSession.startMm.y,
            marqueeSession.currentMm.y,
          );
          const maxY = Math.max(
            marqueeSession.startMm.y,
            marqueeSession.currentMm.y,
          );
          const rect = { minX, minY, maxX, maxY };

          const next = marqueeSession.additive
            ? cloneSelection(marqueeSession.baseSelection)
            : emptySelection();

          for (const part of projection.parts) {
            const bounds = worldBoundsForPart(
              part,
              renderedPartPositionNm(part),
            );
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
                {
                  minX: minWireX,
                  minY: minWireY,
                  maxX: maxWireX,
                  maxY: maxWireY,
                },
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

          for (const primitive of projection.primitives) {
            if (pointInRect(toMm(primitive.positionNm), rect)) {
              next.primitiveIds.add(primitive.id);
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
            actions.setError(
              err instanceof Error ? err.message : "Failed to drop place",
            ),
          );
        actions.clearDragState();
      },
    }),
    [
      actions,
      armedLabelText,
      armedPrimitive,
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
      hitPrimitiveId,
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
    const anchors = [
      sourcePin.worldPositionNm,
      ...wireSession.waypointsNm,
      snapNm(cursorNm),
    ];
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

  const displayedPrimitives = useMemo(() => {
    if (!projection) return [];
    if (!dragSession || dragSession.initialPrimitivePositionsNm.size === 0) {
      return projection.primitives;
    }
    return projection.primitives.map((primitive) => {
      const positionNm = renderedPrimitivePositionNm(primitive);
      if (
        positionNm.x === primitive.positionNm.x &&
        positionNm.y === primitive.positionNm.y
      ) {
        return primitive;
      }
      return { ...primitive, positionNm };
    });
  }, [dragSession, projection, renderedPrimitivePositionNm]);

  const primitiveGhost: DesignerPrimitive | null = useMemo(() => {
    if (!armedPrimitive || !cursorNm) return null;
    const snapped = snapNm(cursorNm);
    const id = "primitive-ghost";
    if (armedPrimitive.kind === "gnd") {
      return { id, kind: "gnd", positionNm: snapped, rotationDeg: 0 };
    }
    if (armedPrimitive.kind === "pwr") {
      return {
        id,
        kind: "pwr",
        positionNm: snapped,
        rotationDeg: 0,
        railText: armedPrimitive.railText,
      };
    }
    return {
      id,
      kind: "net_portal",
      positionNm: snapped,
      rotationDeg: 0,
      portalText: armedPrimitive.portalText,
    };
  }, [armedPrimitive, cursorNm]);

  return (
    <section className="relative h-full w-full min-h-0 rounded-none">
      <EdaCanvas
        readOnly={false}
        interactionHandler={interactionHandler}
        className="h-full w-full"
        initialZoom={DEFAULT_SCHEMATIC_ZOOM}
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
        <SchematicScene
          projection={projection}
          gridVisible={gridVisible}
          unselectedWires={unselectedWires}
          selectedWires={selectedWires}
          wirePreview={wirePreview}
          parts={projection?.parts ?? []}
          renderedPartPositionNm={renderedPartPositionNm}
          selection={selection}
          labels={projection?.labels ?? []}
          primitives={displayedPrimitives}
          primitiveGhost={primitiveGhost}
          junctions={projection?.junctions ?? []}
          selectionRect={selectionRect}
          dragGhostNm={dragGhostNm}
          dragGhostModel={dragGhostModel}
        />
      </EdaCanvas>
      {pwrPickerOpen ? (
        <PwrRailPicker
          onPick={(railText) => {
            setPwrPickerOpen(false);
            setArmedPrimitive({ kind: "pwr", railText });
          }}
          onCancel={() => setPwrPickerOpen(false)}
        />
      ) : null}
      {netPortalPickerOpen ? (
        <NetPortalPicker
          onPick={(portalText) => {
            setNetPortalPickerOpen(false);
            setArmedPrimitive({ kind: "net_portal", portalText });
          }}
          onCancel={() => setNetPortalPickerOpen(false)}
        />
      ) : null}
    </section>
  );
});

interface SchematicSceneProps {
  projection: DesignerSchematicProjection | null;
  gridVisible: boolean;
  unselectedWires: DesignerWire[];
  selectedWires: DesignerWire[];
  wirePreview: DesignerWire | null;
  parts: DesignerPlacedPart[];
  renderedPartPositionNm: (part: DesignerPlacedPart) => PointNm;
  selection: SelectionState;
  labels: DesignerSchematicProjection["labels"];
  primitives: DesignerSchematicProjection["primitives"];
  primitiveGhost: DesignerPrimitive | null;
  junctions: DesignerSchematicProjection["junctions"];
  selectionRect: { a: PointMm; b: PointMm } | null;
  dragGhostNm: { x: number; y: number } | null;
  dragGhostModel: SymbolRenderModel | null;
}

function SchematicScene({
  projection,
  gridVisible,
  unselectedWires,
  selectedWires,
  wirePreview,
  parts,
  renderedPartPositionNm,
  selection,
  labels,
  primitives,
  primitiveGhost,
  junctions,
  selectionRect,
  dragGhostNm,
  dragGhostModel,
}: SchematicSceneProps) {
  const { theme } = useCanvasTheme();
  const t = theme.schematic;

  // Cross-probe: split unselected wires by net when a highlight is active
  // (set from this view or from the PCB view via the designer-wide store).
  const highlightedNetId = useDesignerHighlight((s) => s.highlightedNetId);
  const wireToNet = useMemo(() => {
    const map = new Map<string, string>();
    if (!projection) return map;
    for (const net of projection.nets) {
      for (const wireId of net.wireIds) map.set(wireId, net.id);
    }
    return map;
  }, [projection]);

  // Wire-id → net class (default | gnd | power) so we can color-bucket
  // unselected wires by net family.
  const wireToClass = useMemo(() => {
    const map = new Map<string, WireNetClass>();
    if (!projection) return map;
    for (const net of projection.nets) {
      const cls = classifyNetByName(net.name);
      for (const wireId of net.wireIds) map.set(wireId, cls);
    }
    return map;
  }, [projection]);

  const { highlightedWires, dimmedUnselectedWires } = useMemo(() => {
    if (!highlightedNetId) {
      return {
        highlightedWires: [] as DesignerWire[],
        dimmedUnselectedWires: unselectedWires,
      };
    }
    const high: DesignerWire[] = [];
    const dim: DesignerWire[] = [];
    for (const w of unselectedWires) {
      if (wireToNet.get(w.id) === highlightedNetId) high.push(w);
      else dim.push(w);
    }
    return { highlightedWires: high, dimmedUnselectedWires: dim };
  }, [highlightedNetId, unselectedWires, wireToNet]);

  // Bucket unselected wires by net class for per-color rendering.
  const wireBucketsByClass = useMemo(() => {
    const buckets: Record<WireNetClass, DesignerWire[]> = {
      default: [],
      gnd: [],
      power: [],
    };
    for (const wire of dimmedUnselectedWires) {
      const cls = wireToClass.get(wire.id) ?? "default";
      buckets[cls].push(wire);
    }
    return buckets;
  }, [dimmedUnselectedWires, wireToClass]);

  const wireOpacity = highlightedNetId ? 0.2 : 1;

  return (
    <>
      <GridShader
        gridSize={SCHEMATIC_GRID_MM}
        visible={gridVisible}
        color={t.gridColor}
        alpha={t.gridAlpha}
        majorAlpha={t.gridMajorAlpha}
        originColor={t.gridColor}
        originAlpha={t.gridMajorAlpha}
      />

      {projection ? (
        <>
          {wireBucketsByClass.default.length > 0 ? (
            <WireLayer
              wires={wireBucketsByClass.default}
              color={t.wireColor}
              opacity={wireOpacity}
            />
          ) : null}
          {wireBucketsByClass.gnd.length > 0 ? (
            <WireLayer
              wires={wireBucketsByClass.gnd}
              color={t.wireGndColor}
              opacity={wireOpacity}
            />
          ) : null}
          {wireBucketsByClass.power.length > 0 ? (
            <WireLayer
              wires={wireBucketsByClass.power}
              color={t.wirePowerColor}
              opacity={wireOpacity}
            />
          ) : null}
          {highlightedWires.length > 0 ? (
            <WireLayer wires={highlightedWires} color={t.wireSelectedColor} />
          ) : null}
          {selectedWires.length > 0 ? (
            <WireLayer wires={selectedWires} color={t.wireSelectedColor} />
          ) : null}
          {wirePreview ? (
            <WireLayer wires={[wirePreview]} color={t.wirePreviewColor} />
          ) : null}

          {parts.map((part) => {
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
                {selected ? (
                  <PartSelectionOutline part={part} color={t.selectionColor} />
                ) : null}
              </group>
            );
          })}

          {labels.map((label) => {
            const selected = selection.labelIds.has(label.id);
            return (
              <EDAText
                key={label.id}
                position={[
                  Units.nmToMm(label.positionNm.x),
                  Units.nmToMm(label.positionNm.y),
                  0,
                ]}
                color={selected ? t.labelSelectedColor : t.labelColor}
                fontSize={NET_LABEL_FONT_MM}
                anchorX="left"
                anchorY="middle"
              >
                {label.text}
              </EDAText>
            );
          })}

          <SchematicPrimitivesLayer
            primitives={primitives}
            selectedPrimitiveIds={selection.primitiveIds}
          />

          {primitiveGhost ? (
            <PrimitiveGhost primitive={primitiveGhost} />
          ) : null}

          {junctions.map((junction) => (
            <mesh
              key={`${junction.xNm}:${junction.yNm}`}
              position={[
                Units.nmToMm(junction.xNm),
                Units.nmToMm(junction.yNm),
                0,
              ]}
              renderOrder={RENDER_ORDER.JUNCTIONS}
            >
              <circleGeometry args={[0.1, 24]} />
              <meshBasicMaterial
                color={t.junctionColor}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
          ))}

          {selectionRect ? (
            <SelectionRectOverlay
              a={selectionRect.a}
              b={selectionRect.b}
              color={t.selectionColor}
            />
          ) : null}

          {dragGhostNm && dragGhostModel ? (
            <group
              position={[
                Units.nmToMm(dragGhostNm.x),
                Units.nmToMm(dragGhostNm.y),
                0,
              ]}
              renderOrder={RENDER_ORDER.PREVIEW}
            >
              <SymbolRenderLayer model={dragGhostModel} />
              <mesh>
                <circleGeometry args={[0.9, 24]} />
                <meshBasicMaterial
                  color={t.dragGhostColor}
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
    </>
  );
}

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
