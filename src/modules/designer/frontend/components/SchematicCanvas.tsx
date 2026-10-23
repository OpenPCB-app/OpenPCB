import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
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
  DRAG_THRESHOLD_PX,
  EdaCanvas,
  type InteractionEvent,
  type InteractionHandler,
} from "../../../../shared/frontend/canvas/interaction";
import {
  EDAText,
  GridShader,
} from "../../../../shared/frontend/canvas/primitives";
import { SymbolRenderLayer } from "../../../../shared/frontend/canvas/scene";
import {
  SelectionRectOverlay,
  aabbContains,
  aabbOverlap,
  isPointInAabb,
  polylineContainedInAabb,
  polylineIntersectsAabb,
  useMarqueeSelection,
} from "../../../../shared/frontend/canvas/selection";
import type { BoundsMm } from "../../../../shared/rendering/types";
import {
  labelBoundsMm,
  partBoundsMm,
  primitiveBoundsMm,
  unionBoundsMm,
  wireBoundsMm,
} from "./OutlinePanel/bounds";
import { RENDER_ORDER } from "../../../../shared/frontend/canvas/layers";
import { useCanvasTheme } from "../../../../shared/frontend/canvas/theme";
import { useCanvasThemeMode } from "../../../../shared/frontend/canvas/use-canvas-theme-mode";
import { Units } from "../../../../shared/frontend/canvas/coords";
import {
  DEFAULT_SCHEMATIC_ZOOM,
  NET_LABEL_FONT_MM,
  SYMBOL_PIN_DOT_RADIUS_MM,
} from "../../../../shared/frontend/canvas/defaults";
import { isShortcutBlocked } from "@shared/frontend/keyboard/shortcut-guard";
import { useEditorShortcutScope } from "@shared/frontend/keyboard/use-editor-shortcut-scope";
import { matchesShortcut, formatShortcut } from "@shared/frontend/ui/shortcut";
import type {
  DesignerCommand,
  DesignerCommentAnchor,
  DesignerCommentThread,
  DesignerCommentThreadStatus,
  DesignerCommentTodoStatus,
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
import {
  snapPointNm,
  snappedMoveDeltaNm,
} from "../../../../shared/domain/editor-grid";
import { useGridPreferences } from "../stores/grid-prefs";
import { useGridHotkeys } from "../hooks/use-grid-hotkeys";
import { snapWireWaypointNm } from "../lib/grid";
import type { ViewportState } from "../types";
import { COMPONENT_DND_MIME } from "./DesignerSidebar";
import { useDesignerHighlight } from "../useDesignerHighlight";
import {
  buildSchematicNetIndex,
  netOfPin,
  netOfSelection,
  type SchematicNetIndex,
} from "./schematic-net-index";
import {
  PrimitiveGhost,
  SchematicPrimitivesLayer,
} from "./SchematicPrimitivesLayer";
import { PinElectricalIntentMarkers } from "./PinElectricalIntentMarkers";
import {
  LABEL_STEM_MM,
  SchematicAttachAnchor,
} from "./SchematicAttachAnchor";
import { NetPortalPicker, PwrRailPicker } from "./LabelPicker";
import { openContextMenu } from "../../../../shared/frontend/context-menu";
import type { ContextMenuGroup } from "../../../../shared/frontend/context-menu";
import {
  CanvasCommentLayer,
  type CommentDraft,
} from "./comments/CanvasCommentLayer";
import { useCanvasProjection } from "./comments/useCanvasProjection";
import type { OpenpcbCapturePcbApi } from "../capture-bridge";
import {
  buildManhattanPathThroughAnchors,
  pointOnOrthogonalSegment,
  simplifyCollinearPath,
} from "../../../../shared/schematic-routing/manhattan";
import { routeSchematicWire } from "../../../../shared/schematic-routing/schematic-autoroute";
import { collectWireObstacles } from "../../../../shared/schematic-routing/wire-obstacles";
import { computeWireCrossingGaps } from "../../../../shared/schematic-routing/crossing-gaps";
import {
  dragWireSegment,
  wireSegmentAxis,
  type SegmentAxis,
} from "../../../../shared/schematic-routing/segment-drag";
import {
  applyPendingMoveToProjection,
  mergePendingMoves,
  type PendingMoveState,
} from "../lib/pending-move-overlay";
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
  DesignerPrimitive["kind"],
  { minX: number; minY: number; maxX: number; maxY: number }
> = {
  gnd: { minX: -2.032, minY: -3.556, maxX: 2.032, maxY: 0 },
  pwr: { minX: -1.27, minY: 0, maxX: 1.27, maxY: 2.794 },
  net_portal: { minX: -4.47, minY: -1.016, maxX: 0, maxY: 1.016 },
  // Junction node (wire T-tap anchor): no glyph, just a small grab target
  // around the derived junction dot.
  junction: { minX: -0.3, minY: -0.3, maxX: 0.3, maxY: 0.3 },
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

/** Move-drag state machine. ARMED on pointerdown over a part/primitive/wire;
 *  becomes ACTIVE only once the pointer travels DRAG_THRESHOLD_PX on screen,
 *  so a plain click can never leave a sticky move behind. Lives in a ref
 *  (stable identity across pointermove steps — window listeners register once
 *  per gesture); `dragVersion` state drives re-renders.
 *
 *  Two kinds share the same threshold/commit plumbing:
 *   - "move": reposition selected parts/primitives (attached wires re-route).
 *   - "wireSegment": slide one orthogonal wire segment perpendicular to its axis
 *     (Flux-style), keeping the wire's pinned endpoints fixed. */
interface DragCommonState {
  phase: "armed" | "active";
  startScreenPx: { x: number; y: number };
  startPointerNm: PointNm;
  deltaNm: PointNm;
  gridNm: number;
  /** Removes the gesture's window listeners + releases pointer capture. */
  cleanup: () => void;
}
interface DragMovePayload {
  kind: "move";
  originNm: PointNm;
  initialPartPositionsNm: Map<string, PointNm>;
  initialPrimitivePositionsNm: Map<string, PointNm>;
}
interface DragWireSegmentPayload {
  kind: "wireSegment";
  wireId: string;
  segmentIndex: number;
  /** The wire's polyline at gesture start; the drag is recomputed from it. */
  basePointsNm: PointNm[];
}
type DragMovePayloadUnion = DragMovePayload | DragWireSegmentPayload;
type DragMoveState = DragCommonState & DragMovePayloadUnion;

interface WireSession {
  sourcePinId: string;
  waypointsNm: PointNm[];
}

export interface SchematicCanvasHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  /**
   * Frame the camera onto a bounding box in millimeters. Used by the outline
   * panel's "Frame to canvas" action to pan/zoom to a single entity.
   */
  frameToBoundsMm(bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }): void;
  /**
   * Arm the next click for a primitive placement. PWR/portal need text;
   * supplying an empty string lets the canvas open its inline picker.
   */
  armPrimitive(kind: DesignerPrimitiveKind, text?: string): void;
  /**
   * Arm the next click for a component placement. Click canvas to place;
   * Esc cancels.
   */
  armComponentPlacement(detail: LibraryComponentPlacementDetail): void;
  /**
   * Frame the camera onto the current canvas selection (parts, wires, labels
   * and primitives). No-op when nothing is selected.
   */
  frameSelection(): void;
}

interface SchematicCanvasProps {
  projection: DesignerSchematicProjection | null;
  selectedPartId: string | null;
  selectedPinId: string | null;
  selectedLabelId: string | null;
  selectionRequest?: {
    partIds?: readonly string[];
    wireIds?: readonly string[];
    labelIds?: readonly string[];
    nonce: number;
  } | null;
  wireSourcePinId: string | null;
  labelDraftText: string;
  canUndo?: boolean;
  canRedo?: boolean;
  draggingComponentId: string | null;
  dragPlacementLoading: boolean;
  dragPlacementDetail: LibraryComponentPlacementDetail | null;
  dragGhostNm: { x: number; y: number } | null;
  actions: DesignerWorkspaceActions;
  commentThreads?: readonly DesignerCommentThread[];
  activeCommentThreadId?: string | null;
  commentMode?: boolean;
  currentUserEmail?: string | null;
  onCreateComment?: (anchor: DesignerCommentAnchor, body: string) => void;
  onSelectCommentThread?: (threadId: string) => void;
  onCloseCommentThread?: () => void;
  onAddCommentMessage?: (
    thread: DesignerCommentThread,
    body: string,
    file?: File | null,
  ) => Promise<void>;
  onSetCommentStatus?: (
    thread: DesignerCommentThread,
    status: DesignerCommentThreadStatus,
  ) => Promise<void>;
  onSetCommentTodoStatus?: (
    thread: DesignerCommentThread,
    todoStatus: DesignerCommentTodoStatus,
  ) => Promise<void>;
  onToggleCommentReaction?: (
    thread: DesignerCommentThread,
    messageId: string,
    emoji: string,
  ) => Promise<void>;
  onMoveComment?: (
    thread: DesignerCommentThread,
    pointNm: { x: number; y: number },
  ) => void;
  commentAttachmentUrl?: (attachmentId: string) => string;
  /** Toggle comment-placement mode; also bound to the "C" hotkey here. */
  onToggleCommentMode?: () => void;
  /** Sheet-space cursor for the status-bar X / Y readout. */
  onCursorChange?: (point: { xMm: number; yMm: number } | null) => void;
  /** Contextual status-bar hint, derived from tool + selection state only. */
  onHintChange?: (hint: string) => void;
  onZoomChange?: (zoomPercent: number) => void;
  initialViewport?: ViewportState | null;
  onViewportChange?: (zoom: number, posX: number, posY: number) => void;
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

/** Capture the pointer on the canvas for the duration of a drag so
 *  pointermove/pointerup keep arriving even when the cursor leaves the
 *  canvas or passes over an HTML overlay. Returns the release fn. */
function capturePointerForDrag(event: InteractionEvent): () => void {
  const dom = event.nativeEvent?.nativeEvent;
  const target = dom?.target;
  if (dom && target instanceof Element) {
    try {
      target.setPointerCapture(dom.pointerId);
      return () => {
        try {
          target.releasePointerCapture(dom.pointerId);
        } catch {
          // Already released (implicit on pointerup) — nothing to do.
        }
      };
    } catch {
      // Unsupported (synthetic events in tests) — window fallback covers it.
    }
  }
  return () => {};
}

/**
 * Commit-parity wire geometry for a move: wires attached to the moved parts/
 * primitives get the exact polyline the backend will persist on drop (≤2
 * points → obstacle-aware router; user waypoints kept verbatim + re-
 * Manhattaned to the moved endpoints). Used both for the live drag preview
 * (per pointer step) and to seed the optimistic overlay at drop — the drop
 * path recomputes from the FINAL delta so it can never lag the render memo.
 * Co-moving wires are excluded from each other's obstacle sets (their stale
 * pre-move paths are phantom walls), matching the backend's move re-route.
 */
function computeDragWireOverrides(
  projection: DesignerSchematicProjection,
  initialPartPositionsNm: ReadonlyMap<string, PointNm>,
  initialPrimitivePositionsNm: ReadonlyMap<string, PointNm>,
  deltaNm: PointNm,
): Map<string, PointNm[]> {
  const overrides = new Map<string, PointNm[]>();
  if (deltaNm.x === 0 && deltaNm.y === 0) return overrides;
  const nextByPinId = new Map<string, PointNm>();
  for (const part of projection.parts) {
    if (!initialPartPositionsNm.has(part.id)) continue;
    for (const p of part.pins) {
      nextByPinId.set(p.id, {
        x: p.worldPositionNm.x + deltaNm.x,
        y: p.worldPositionNm.y + deltaNm.y,
      });
    }
  }
  for (const primitive of projection.primitives) {
    if (!initialPrimitivePositionsNm.has(primitive.id)) continue;
    nextByPinId.set(`primitive:${primitive.id}`, {
      x: primitive.positionNm.x + deltaNm.x,
      y: primitive.positionNm.y + deltaNm.y,
    });
  }
  if (nextByPinId.size === 0) return overrides;
  const movedWireIds = new Set(
    projection.wires
      .filter(
        (w) => nextByPinId.has(w.sourcePinId) || nextByPinId.has(w.targetPinId),
      )
      .map((w) => w.id),
  );
  const staticWires = projection.wires.filter((w) => !movedWireIds.has(w.id));
  for (const wire of projection.wires) {
    const movedSource = nextByPinId.get(wire.sourcePinId);
    const movedTarget = nextByPinId.get(wire.targetPinId);
    if (!movedSource && !movedTarget) continue;
    const source = movedSource ?? wire.pointsNm[0];
    const target = movedTarget ?? wire.pointsNm[wire.pointsNm.length - 1];
    if (!source || !target) continue;
    if (wire.pointsNm.length <= 2) {
      overrides.set(
        wire.id,
        simplifyCollinearPath(
          routeSchematicWire({
            source,
            target,
            obstacles: collectWireObstacles(projection, {
              source,
              target,
              sourcePinId: wire.sourcePinId,
              targetPinId: wire.targetPinId,
              wires: staticWires,
            }),
          }),
        ),
      );
    } else {
      overrides.set(
        wire.id,
        simplifyCollinearPath(
          buildManhattanPathThroughAnchors([
            source,
            ...wire.pointsNm.slice(1, -1),
            target,
          ]),
        ),
      );
    }
  }
  return overrides;
}

/**
 * Status-bar hints. Only gestures and hotkeys that actually exist are listed:
 * a wire ends by clicking a pin or a wire (there is no double-click finish),
 * and the schematic keydown handler binds R (rotate) and Delete on a part.
 */
const HINT_WIRE =
  "Click a pin or wire to connect · click empty space for a corner · Esc cancel";
const HINT_PLACE = "Click to place · Esc cancel";
const HINT_SELECT =
  "Click to select · Shift+click to add · drag to box-select";

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

function sameStringSet(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

/**
 * Schematic wire stroke width in mm. Rendered with LineSegments2 +
 * LineMaterial in world-units mode so it stays a true 0.05 mm at every zoom
 * level instead of a fixed 1-pixel hairline. ~2× the previous 1-px line
 * without overpowering symbol-body strokes.
 */
const SCHEMATIC_WIRE_WIDTH_MM = 0.18;

// Warning tint for wires the auto-router committed on its known-colliding
// fallback (audit §4.4). Local constant — the canvas theme lives in the
// tag-installed @openpcb/r3f-eda-canvas package and is not editable here.
const COLLIDING_WIRE_COLOR = "#f59e0b";

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
  widthMm = SCHEMATIC_WIRE_WIDTH_MM,
  renderOrder = RENDER_ORDER.WIRES,
}: {
  wires: DesignerWire[];
  color: string;
  opacity?: number;
  widthMm?: number;
  renderOrder?: number;
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
      linewidth: widthMm,
      worldUnits: true,
      transparent: opacity < 1,
      opacity,
      depthTest: false,
      depthWrite: false,
    });
  }, [color, opacity, widthMm]);

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
    built.renderOrder = renderOrder;
    return built;
  }, [geometry, material, renderOrder]);

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

/** Opacity of non-net text/glyphs while a net highlight is active. */
const NET_DIM_OPACITY = 0.35;

function InvalidateOnCanvasChange({
  projection,
  cursorNm,
  selection,
  dragVersion,
  pendingMove,
  marqueeRect,
  wireSession,
  armedComponentDetail,
  highlightedNetId,
}: {
  projection: DesignerSchematicProjection | null;
  cursorNm: PointNm | null;
  selection: SelectionState;
  dragVersion: number;
  pendingMove: PendingMoveState | null;
  marqueeRect: { a: PointMm | null; b: PointMm | null } | null;
  wireSession: WireSession | null;
  armedComponentDetail: LibraryComponentPlacementDetail | null;
  highlightedNetId: string | null;
}) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
  }, [
    invalidate,
    projection,
    cursorNm,
    selection,
    dragVersion,
    pendingMove,
    marqueeRect,
    wireSession,
    armedComponentDetail,
    highlightedNetId,
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

function ViewportReporter({
  enabledRef,
  onViewportChange,
}: {
  enabledRef: React.MutableRefObject<boolean>;
  onViewportChange: (zoom: number, posX: number, posY: number) => void;
}): null {
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const lastRef = useRef<{ zoom: number; posX: number; posY: number } | null>(
    null,
  );

  useFrame(() => {
    if (!enabledRef.current) return;
    const { zoom, position } = camera;
    const l = lastRef.current;
    if (
      !l ||
      Math.abs(l.zoom - zoom) > 0.001 ||
      Math.abs(l.posX - position.x) > 0.1 ||
      Math.abs(l.posY - position.y) > 0.1
    ) {
      lastRef.current = { zoom, posX: position.x, posY: position.y };
      onViewportChange(zoom, position.x, position.y);
    }
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
    canUndo = false,
    canRedo = false,
    draggingComponentId,
    dragPlacementLoading,
    dragPlacementDetail,
    dragGhostNm,
    actions,
    commentThreads = [],
    activeCommentThreadId = null,
    commentMode = false,
    currentUserEmail = null,
    onCreateComment,
    onSelectCommentThread,
    onCloseCommentThread,
    onAddCommentMessage,
    onSetCommentStatus,
    onSetCommentTodoStatus,
    onToggleCommentReaction,
    onMoveComment,
    onToggleCommentMode,
    commentAttachmentUrl,
    onZoomChange,
    initialViewport,
    onViewportChange,
  } = props;

  // Light-mode canvas background tracks the app surface (#f0f4fb) so the
  // schematic reads as part of the shell; dark mode keeps the canvas default.
  const mode = useCanvasThemeMode();
  const canvasInstanceId = useId();
  const menuOwnerId = `${canvasInstanceId}:${projection?.designId ?? ""}`;
  const canvasBackground = mode === "light" ? "#f0f4fb" : undefined;

  const grid = useGridPreferences((state) => state.schematic);
  const gridVisible = grid.visible;
  const gridNm = grid.snap ? SCHEMATIC_GRID_NM : 0;
  const snap = useCallback(
    (pointNm: PointNm) => snapPointNm(pointNm, gridNm),
    [gridNm],
  );

  const [cursorNm, setCursorNm] = useState<PointNm | null>(null);
  const [selection, setSelection] = useState<SelectionState>(emptySelection);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  // Move-drag machine lives in a ref (stable identity across pointermove
  // steps); dragVersion bumps to re-render the position/wire overlays.
  const dragRef = useRef<DragMoveState | null>(null);
  const [dragVersion, setDragVersion] = useState(0);
  // Optimistic overlay held from drop until the move commands + projection
  // refresh settle — without it, parts/wires flash back to their pre-drag
  // positions (and through partial multi-command states) while the async
  // dispatch chain runs. Drops stack (merge) while earlier commits are still
  // in flight; the overlay clears only when the serialized queue drains.
  const [pendingMove, setPendingMove] = useState<PendingMoveState | null>(null);
  const moveChainRef = useRef<Promise<void>>(Promise.resolve());
  const movesInFlightRef = useRef(0);
  // Latest finalizer — window listeners registered at gesture start call
  // through this ref so they can never commit via a stale closure.
  const finalizeDragRef = useRef<(commit: boolean) => void>(() => {});
  const [wireSession, setWireSession] = useState<WireSession | null>(null);
  const [armedLabelText, setArmedLabelText] = useState<string | null>(null);
  const [armedPrimitive, setArmedPrimitive] = useState<ArmedPrimitive>(null);
  const [armedComponentDetail, setArmedComponentDetail] =
    useState<LibraryComponentPlacementDetail | null>(null);
  const [pwrPickerOpen, setPwrPickerOpen] = useState(false);
  const [netPortalPickerOpen, setNetPortalPickerOpen] = useState(false);

  // Single optimistic source of truth: the raw projection with any in-flight
  // move overlaid (parts/primitives at committed positions, pins shifted,
  // wires re-routed). EVERY position consumer below — hit tests, drag
  // seeding, live re-route, marquee, rendering — reads this, never the raw
  // projection, so a drag started while a previous move is still saving can
  // never teleport parts or stretch wires between stale and new endpoints.
  const effectiveProjection = useMemo(
    () => (projection ? applyPendingMoveToProjection(projection, pendingMove) : null),
    [projection, pendingMove],
  );

  const cameraRef = useRef<OrthographicCamera | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const lastAutoFittedDesignIdRef = useRef<string | null>(null);
  const markCameraReady = useCallback(() => setCameraReady(true), []);
  // Viewport reporting stays off until the initial fit/restore is applied.
  const viewportReportingRef = useRef(false);
  // The parent's saved viewport is captured once per design: ViewportReporter
  // writes back into the same parent store, so reading the live prop would
  // let the pre-fit default camera masquerade as a saved viewport.
  const initialViewportSnapshotRef = useRef<{
    designId: string;
    viewport: ViewportState | null;
  } | null>(null);
  if (
    projection?.designId &&
    initialViewportSnapshotRef.current?.designId !== projection.designId
  ) {
    initialViewportSnapshotRef.current = {
      designId: projection.designId,
      viewport: initialViewport ?? null,
    };
    // The camera still shows the previous design until the effect below
    // restores/fits this one; reporting it now would save it under this key.
    viewportReportingRef.current = false;
  }
  const awaitingContentRef = useRef(false);
  const hasFittableContent = useMemo(
    () => (projection ? computeProjectionBoundsMm(projection) !== null : false),
    [projection],
  );

  // Floating canvas comment overlay: projection + new-comment draft.
  const wrapperRef = useRef<HTMLElement | null>(null);
  useGridHotkeys(wrapperRef, "schematic");
  const projection2d = useCanvasProjection(wrapperRef, initialViewport);
  const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null);
  // Schedule a re-render in demand mode. CameraRefBridge publishes R3F's
  // invalidate fn onto camera.userData on Canvas mount (in the same effect that
  // flips cameraReady true), so it is set before any camera mutation below runs.
  // Camera mutations are imperative (no React re-render), so this MUST be called
  // or the new view never paints until the next user interaction.
  const requestRender = useCallback(() => {
    const camera = cameraRef.current;
    (camera?.userData.invalidate as (() => void) | undefined)?.();
  }, []);

  const recenterOnNm = useCallback(
    (anchorNm: { x: number; y: number }) => {
      const camera = cameraRef.current;
      if (!camera) return;
      camera.position.set(
        Units.nmToMm(anchorNm.x),
        Units.nmToMm(anchorNm.y),
        camera.position.z,
      );
      camera.zoom = Math.min(Math.max(camera.zoom, 40), 200);
      camera.updateProjectionMatrix();
      requestRender();
    },
    [requestRender],
  );

  // Dev-only capture hooks (M0.2): expose the live world-nm → canvas-px projection on
  // `window.__openpcbCapture.schematic`, gated on OPENPCB_CAPTURE=1 — the same contract PcbCanvas
  // publishes under `.pcb`. Read-only; it exists so a capture can aim a REAL click at a real pin.
  useEffect(() => {
    const captureMode =
      (window as { electronAPI?: { captureMode?: boolean } }).electronAPI
        ?.captureMode === true;
    if (!captureMode) return;
    const schematic: OpenpcbCapturePcbApi = {
      project: (anchorNm, mirrorX) => projection2d.project(anchorNm, mirrorX),
      rect: () => projection2d.rect,
    };
    const existing = window.__openpcbCapture ?? {};
    window.__openpcbCapture = { ...existing, schematic };
    return () => {
      const current = window.__openpcbCapture;
      if (current) delete current.schematic;
    };
  }, [projection2d]);

  useEffect(() => {
    actions.setSelectedPartId(firstSelectedId(selection.partIds));
    actions.setSelectedPartIds(selection.partIds);
    actions.setSelectedLabelId(firstSelectedId(selection.labelIds));
    actions.setSelectedWireId(firstSelectedId(selection.wireIds));
    const pinId = wireSession?.sourcePinId ?? null;
    actions.setSelectedPinId(pinId);
    actions.setWireSourcePinId(pinId);
  }, [actions, selection, wireSession]);

  useEffect(() => {
    const request = props.selectionRequest;
    if (!request) return;
    setSelection((current) => {
      const nextPartIds = new Set(request.partIds ?? []);
      const nextWireIds = new Set(request.wireIds ?? []);
      const nextLabelIds = new Set(request.labelIds ?? []);
      if (
        sameStringSet(current.partIds, nextPartIds) &&
        sameStringSet(current.wireIds, nextWireIds) &&
        sameStringSet(current.labelIds, nextLabelIds) &&
        current.primitiveIds.size === 0
      ) {
        return current;
      }
      return {
        partIds: nextPartIds,
        wireIds: nextWireIds,
        labelIds: nextLabelIds,
        primitiveIds: new Set<string>(),
      };
    });
    setWireSession(null);
  }, [props.selectionRequest]);

  useEffect(() => {
    if (!projection) {
      setSelection(emptySelection());
      setWireSession(null);
      finalizeDragRef.current(false);
      marquee.cancelMarquee();
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

  const fitCamera = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera || !projection) return;

    const bounds = computeProjectionBoundsMm(projection);
    if (!bounds) {
      camera.position.set(0, 0, camera.position.z);
      camera.zoom = 10;
      camera.updateProjectionMatrix();
      onZoomChange?.(camera.zoom * 2);
      requestRender();
      return;
    }

    const canvas = camera.userData?.canvas as HTMLCanvasElement | undefined;
    const width = canvas?.clientWidth ?? 800;
    const height = canvas?.clientHeight ?? 600;

    const contentWidth = bounds.maxX - bounds.minX;
    const contentHeight = bounds.maxY - bounds.minY;
    const padding = Math.max(contentWidth, contentHeight, 1) * 0.1;

    const paddedWidth = contentWidth + padding * 2;
    const paddedHeight = contentHeight + padding * 2;

    const zoomX = width / paddedWidth;
    const zoomY = height / paddedHeight;
    const zoom = Math.min(zoomX, zoomY);

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    camera.position.set(centerX, centerY, camera.position.z);
    // Floor well below the default so large sheets still frame completely.
    camera.zoom = Math.max(0.5, Math.min(zoom, 500));
    camera.updateProjectionMatrix();
    onZoomChange?.(camera.zoom * 2);
    requestRender();
  }, [projection, onZoomChange, requestRender]);

  // Auto-fit when the canvas first becomes ready and on every projection
  // designId change. Runs on mount (project open, tab switch back, module
  // re-entry) since cameraReady flips false→true each remount.
  useEffect(() => {
    if (!cameraReady) return;
    if (!projection?.designId) return;
    const camera = cameraRef.current;
    if (!camera) return;

    if (lastAutoFittedDesignIdRef.current === projection.designId) {
      // Already handled this design within this mount. The one exception: a
      // design that opened empty is framed once when its first content
      // arrives (AI edit, import); later revisions never move the camera.
      if (awaitingContentRef.current && hasFittableContent) {
        awaitingContentRef.current = false;
        fitCamera();
      }
      return;
    }
    lastAutoFittedDesignIdRef.current = projection.designId;

    const initialViewport =
      initialViewportSnapshotRef.current?.designId === projection.designId
        ? initialViewportSnapshotRef.current.viewport
        : null;
    awaitingContentRef.current = !initialViewport && !hasFittableContent;

    if (initialViewport) {
      camera.position.set(
        initialViewport.posX,
        initialViewport.posY,
        camera.position.z,
      );
      camera.zoom = initialViewport.zoom;
      camera.updateProjectionMatrix();
      onZoomChange?.(camera.zoom * 2);
      requestRender();
    } else {
      fitCamera();
    }
    viewportReportingRef.current = true;
  }, [
    cameraReady,
    projection?.designId,
    hasFittableContent,
    fitCamera,
    onZoomChange,
    requestRender,
  ]);

  /**
   * Pan + zoom onto a sheet-space box. Shared by the `frameToBoundsMm` and
   * `frameSelection` handle methods (and, through them, by the outline panel,
   * the ERC dock and the toolbar's zoom-to-selection).
   */
  const frameBounds = useCallback(
    (bounds: BoundsMm) => {
      const camera = cameraRef.current;
      if (!camera) return;
      const canvas = camera.userData?.canvas as HTMLCanvasElement | undefined;
      const width = canvas?.clientWidth ?? 800;
      const height = canvas?.clientHeight ?? 600;
      const contentWidth = Math.max(bounds.maxX - bounds.minX, 1);
      const contentHeight = Math.max(bounds.maxY - bounds.minY, 1);
      const padding = Math.max(contentWidth, contentHeight) * 0.4;
      const paddedWidth = contentWidth + padding * 2;
      const paddedHeight = contentHeight + padding * 2;
      const zoomX = width / paddedWidth;
      const zoomY = height / paddedHeight;
      const targetZoom = Math.max(20, Math.min(Math.min(zoomX, zoomY), 200));
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;
      camera.position.set(centerX, centerY, camera.position.z);
      camera.zoom = targetZoom;
      camera.updateProjectionMatrix();
      onZoomChange?.(camera.zoom * 2);
      requestRender();
    },
    [onZoomChange, requestRender],
  );

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
      setArmedComponentDetail(null);
      setArmedLabelText(null);
      setArmedPrimitive(null);
      setPwrPickerOpen(false);
      setNetPortalPickerOpen(false);
      setWireSession(null);
      actions.setWireSourcePinId(null);
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
      const portalText = text?.trim();
      if (portalText && portalText.length > 0) {
        setArmedPrimitive({ kind: "net_portal", portalText });
      } else {
        setNetPortalPickerOpen(true);
      }
    },
    armComponentPlacement(detail) {
      setArmedLabelText(null);
      setArmedPrimitive(null);
      setPwrPickerOpen(false);
      setNetPortalPickerOpen(false);
      finalizeDragRef.current(false);
      setWireSession(null);
      actions.setWireSourcePinId(null);
      setArmedComponentDetail(detail);
    },
    fit() {
      fitCamera();
    },
    frameToBoundsMm(bounds) {
      frameBounds(bounds);
    },
    frameSelection() {
      if (!projection) return;
      const boxes: Array<BoundsMm | null> = [];
      for (const partId of selection.partIds) {
        const part = projection.parts.find((p) => p.id === partId);
        if (part) boxes.push(partBoundsMm(part));
      }
      for (const wireId of selection.wireIds) {
        const wire = projection.wires.find((w) => w.id === wireId);
        if (wire) boxes.push(wireBoundsMm(wire));
      }
      for (const labelId of selection.labelIds) {
        const label = projection.labels.find((l) => l.id === labelId);
        if (label) boxes.push(labelBoundsMm(label));
      }
      for (const primitiveId of selection.primitiveIds) {
        const primitive = projection.primitives.find(
          (candidate) => candidate.id === primitiveId,
        );
        if (primitive) boxes.push(primitiveBoundsMm(primitive));
      }
      const bounds = unionBoundsMm(boxes);
      if (bounds) frameBounds(bounds);
    },
  }));

  // Sheet-space cursor for the status-bar X / Y readout. `cursorNm` already
  // dedupes to integer nanometres, so this fires at most once per moved
  // nanometre and lands in a dedicated store — never in the editor shell.
  const onCursorChange = props.onCursorChange;
  useEffect(() => {
    onCursorChange?.(
      cursorNm
        ? { xMm: Units.nmToMm(cursorNm.x), yMm: Units.nmToMm(cursorNm.y) }
        : null,
    );
  }, [cursorNm, onCursorChange]);
  useEffect(() => () => onCursorChange?.(null), [onCursorChange]);

  // Status-bar hint. Derived from tool + selection state only (never the
  // cursor) so pointer moves cannot re-render the editor shell.
  const singleSelectedPart = useMemo(() => {
    if (
      selection.partIds.size !== 1 ||
      selection.wireIds.size > 0 ||
      selection.labelIds.size > 0 ||
      selection.primitiveIds.size > 0
    ) {
      return null;
    }
    const [partId] = [...selection.partIds];
    return projection?.parts.find((part) => part.id === partId) ?? null;
  }, [selection, projection?.parts]);

  const statusHint = useMemo(() => {
    if (wireSession) return HINT_WIRE;
    if (armedComponentDetail || armedPrimitive || armedLabelText) {
      return HINT_PLACE;
    }
    if (singleSelectedPart) {
      return `${singleSelectedPart.reference} — drag to move · R rotate · Del delete`;
    }
    return HINT_SELECT;
  }, [
    armedComponentDetail,
    armedLabelText,
    armedPrimitive,
    singleSelectedPart,
    wireSession,
  ]);

  const onHintChange = props.onHintChange;
  useEffect(() => {
    onHintChange?.(statusHint);
  }, [statusHint, onHintChange]);

  // Parts/primitives passed in come from `effectiveProjection` (pending moves
  // already applied); only the LIVE drag delta is layered on top here. The
  // drag delta is seeded from effective positions at arm time, so both
  // branches agree mid-flight. `dragVersion` keys the callbacks to the ref's
  // mutations.
  const renderedPartPositionNm = useCallback(
    (part: DesignerPlacedPart): PointNm => {
      const state = dragRef.current;
      const initial =
        state?.kind === "move"
          ? state.initialPartPositionsNm.get(part.id)
          : undefined;
      if (state && initial) {
        return {
          x: initial.x + state.deltaNm.x,
          y: initial.y + state.deltaNm.y,
        };
      }
      return { x: part.positionNm.x, y: part.positionNm.y };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dragVersion tracks dragRef mutations
    [dragVersion],
  );

  const renderedPrimitivePositionNm = useCallback(
    (primitive: DesignerPrimitive): PointNm => {
      const state = dragRef.current;
      const initial =
        state?.kind === "move"
          ? state.initialPrimitivePositionsNm.get(primitive.id)
          : undefined;
      if (state && initial) {
        return {
          x: initial.x + state.deltaNm.x,
          y: initial.y + state.deltaNm.y,
        };
      }
      return { x: primitive.positionNm.x, y: primitive.positionNm.y };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dragVersion tracks dragRef mutations
    [dragVersion],
  );

  // Marquee/rubber-band selection — uses the same shared hook as PCB so both
  // canvases behave identically (KiCad direction-based window/crossing modes,
  // Shift = additive, Escape = cancel + restore prior selection).
  const marquee = useMarqueeSelection<SelectionState>({
    enabled: true,
    cloneSelection,
    emptySelection,
    getSelection: () => selectionRef.current,
    setSelection,
    applyMarqueeHits: ({ rect, mode, baseSelection }) => {
      const next = cloneSelection(baseSelection);
      if (!effectiveProjection) return next;
      const partTest = (b: BoundsMm) =>
        mode === "window" ? aabbContains(rect, b) : aabbOverlap(b, rect);
      for (const part of effectiveProjection.parts) {
        const b = worldBoundsForPart(part, renderedPartPositionNm(part));
        if (b && partTest(b)) next.partIds.add(part.id);
      }
      for (const wire of effectiveProjection.wires) {
        if (wire.pointsNm.length === 0) continue;
        const ptsMm: PointMm[] = wire.pointsNm.map((p) => toMm(p));
        const inside =
          mode === "window"
            ? polylineContainedInAabb(ptsMm, rect)
            : polylineIntersectsAabb(ptsMm, rect);
        if (inside) next.wireIds.add(wire.id);
      }
      // Labels & primitives are point-like → window/crossing equivalent.
      for (const label of effectiveProjection.labels) {
        if (isPointInAabb(toMm(label.positionNm), rect)) {
          next.labelIds.add(label.id);
        }
      }
      for (const primitive of effectiveProjection.primitives) {
        if (isPointInAabb(toMm(renderedPrimitivePositionNm(primitive)), rect)) {
          next.primitiveIds.add(primitive.id);
        }
      }
      return next;
    },
  });

  const pinById = useMemo(() => {
    const map = new Map<string, DesignerPin>();
    if (!effectiveProjection) {
      return map;
    }
    for (const part of effectiveProjection.parts) {
      for (const pin of part.pins) {
        map.set(pin.id, pin);
      }
    }
    // Synthetic single-pin entries for each primitive's connection point.
    // Connection point is local (0, 0); rotation pivots around it so the
    // world position equals the primitive's position.
    for (const primitive of effectiveProjection.primitives) {
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
  }, [effectiveProjection]);

  const hitPin = useCallback(
    (worldNm: PointNm): DesignerPin | null => {
      if (!effectiveProjection) {
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
      for (const part of effectiveProjection.parts) {
        for (const pin of part.pins) {
          const d = distanceMm(cursor, toMm(pin.worldPositionNm));
          if (d <= PIN_HIT_MM && d < bestDistance) {
            bestDistance = d;
            best = pin;
          }
        }
      }
      for (const primitive of effectiveProjection.primitives) {
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
    [pinById, effectiveProjection],
  );

  const hitWire = useCallback(
    (
      worldNm: PointNm,
    ): {
      wire: DesignerWire;
      projectedNm: PointNm;
      /** Index of the nearest segment (points[i]..points[i+1]). */
      segmentIndex: number;
      /** Axis of that segment, or null if it is degenerate/non-orthogonal. */
      axis: SegmentAxis | null;
    } | null => {
      if (!effectiveProjection) {
        return null;
      }
      const cursor = toMm(worldNm);
      let bestWire: DesignerWire | null = null;
      let bestProjected: PointNm | null = null;
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const wire of effectiveProjection.wires) {
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
            bestIndex = index - 1;
          }
        }
      }

      if (
        !bestWire ||
        !bestProjected ||
        bestIndex < 0 ||
        bestDistance > WIRE_HIT_MM
      ) {
        return null;
      }
      const a = bestWire.pointsNm[bestIndex];
      const b = bestWire.pointsNm[bestIndex + 1];
      return {
        wire: bestWire,
        projectedNm: bestProjected,
        segmentIndex: bestIndex,
        axis: a && b ? wireSegmentAxis(a, b) : null,
      };
    },
    [effectiveProjection],
  );

  const hitLabelId = useCallback(
    (worldNm: PointNm): string | null => {
      if (!effectiveProjection) {
        return null;
      }
      const cursor = toMm(worldNm);
      let bestId: string | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const label of effectiveProjection.labels) {
        const d = distanceMm(cursor, toMm(label.positionNm));
        if (d < bestDistance) {
          bestDistance = d;
          bestId = label.id;
        }
      }
      return bestDistance <= LABEL_HIT_MM ? bestId : null;
    },
    [effectiveProjection],
  );

  const hitPrimitiveId = useCallback(
    (worldNm: PointNm): string | null => {
      if (!effectiveProjection) return null;
      const cursorMm = toMm(worldNm);
      // Glyph-bounds hit-test: transform cursor into the primitive's local
      // frame (inverse of position + rotation) and check the kind's AABB
      // padded by PRIMITIVE_HIT_PADDING_MM.
      for (const primitive of effectiveProjection.primitives) {
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
      for (const primitive of effectiveProjection.primitives) {
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
    [effectiveProjection, renderedPrimitivePositionNm],
  );

  // Net highlight (hover + selection pin). Element id -> net id lookup from
  // the same projection.nets ERC/netlist use.
  const netIndex = useMemo(
    () => buildSchematicNetIndex(effectiveProjection),
    [effectiveProjection],
  );
  const highlightedNetId = useDesignerHighlight((s) => s.highlightedNetId);
  const hoverNetStore = useDesignerHighlight((s) => s.hoverNet);
  const hoverRafRef = useRef<number | null>(null);
  const hoverPendingRef = useRef<PointNm | null>(null);
  const hoverBusyRef = useRef(false);
  const hoverResolveRef = useRef<(worldNm: PointNm) => string | null>(
    () => null,
  );

  const setHoverNet = useCallback(
    (netId: string | null) => {
      // Compare with the store (not a shadow ref): hoverNet is a no-op while
      // pinned, and a shadow would then go stale once the pin clears.
      const state = useDesignerHighlight.getState();
      if (state.pinned || state.highlightedNetId === netId) return;
      hoverNetStore(netId);
    },
    [hoverNetStore],
  );

  // Priority pin > label > primitive > wire.
  hoverResolveRef.current = (worldNm) => {
    const pin = hitPin(worldNm);
    if (pin) return netOfPin(netIndex, pin.id);
    const labelId = hitLabelId(worldNm);
    if (labelId) return netIndex.label.get(labelId) ?? null;
    const primitiveId = hitPrimitiveId(worldNm);
    if (primitiveId) return netIndex.primitive.get(primitiveId) ?? null;
    const wire = hitWire(worldNm);
    return wire ? (netIndex.wire.get(wire.wire.id) ?? null) : null;
  };

  const cancelHover = useCallback(() => {
    if (hoverRafRef.current !== null) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }
    hoverPendingRef.current = null;
  }, []);

  const scheduleHover = useCallback(
    (worldNm: PointNm) => {
      hoverPendingRef.current = worldNm;
      if (hoverRafRef.current !== null) return;
      hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = null;
        const pending = hoverPendingRef.current;
        hoverPendingRef.current = null;
        if (pending && !hoverBusyRef.current) {
          setHoverNet(hoverResolveRef.current(pending));
        }
      });
    },
    [setHoverNet],
  );

  useEffect(() => cancelHover, [cancelHover]);

  // Selection pins the highlight; clearing selection releases only a pin we
  // set (PCB cross-probe pins are left alone).
  const selectionPinnedRef = useRef(false);
  // Pin held by someone else (PCB cross-probe) when we took over; restored on
  // release instead of being lost.
  const priorPinRef = useRef<string | null>(null);
  const releaseSelectionPin = useCallback(() => {
    if (!selectionPinnedRef.current) return;
    selectionPinnedRef.current = false;
    const store = useDesignerHighlight.getState();
    const prior = priorPinRef.current;
    priorPinRef.current = null;
    if (prior) store.pinNet(prior);
    else store.clear();
  }, []);
  useEffect(() => {
    const netId = netOfSelection(netIndex, selection);
    const store = useDesignerHighlight.getState();
    if (netId) {
      if (!selectionPinnedRef.current) {
        priorPinRef.current = store.pinned ? store.highlightedNetId : null;
        selectionPinnedRef.current = true;
      }
      store.pinNet(netId);
    } else {
      releaseSelectionPin();
    }
  }, [netIndex, selection, releaseSelectionPin]);
  useEffect(() => releaseSelectionPin, [releaseSelectionPin]);

  // Stale id (net merged/renamed/deleted): drop the highlight.
  useEffect(() => {
    if (!effectiveProjection || !highlightedNetId) return;
    if (!netIndex.netIds.has(highlightedNetId)) {
      useDesignerHighlight.getState().clear();
    }
  }, [effectiveProjection, highlightedNetId, netIndex]);

  const hitPartId = useCallback(
    (worldNm: PointNm): string | null => {
      if (!effectiveProjection) {
        return null;
      }
      const cursorMm = toMm(worldNm);

      for (const part of effectiveProjection.parts) {
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
      for (const part of effectiveProjection.parts) {
        const position = toMm(renderedPartPositionNm(part));
        const d = distanceMm(cursorMm, position);
        if (d < bestDistance) {
          bestDistance = d;
          bestPartId = part.id;
        }
      }
      return bestDistance <= PART_CENTER_FALLBACK_MM ? bestPartId : null;
    },
    [effectiveProjection, renderedPartPositionNm],
  );

  const commitWireToPin = useCallback(
    async (
      sourcePin: DesignerPin,
      targetPin: DesignerPin,
      waypointsNm: PointNm[],
    ) => {
      // No user-placed waypoints → omit pointsNm so the backend routes the
      // wire through the obstacle-aware auto-router (audit §4.2). Explicit
      // waypoints are user intent and are sent verbatim.
      if (waypointsNm.length === 0) {
        await actions.dispatchCommand({
          type: "create_wire",
          sourcePinId: sourcePin.id,
          targetPinId: targetPin.id,
        });
        return;
      }
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

  useEditorShortcutScope(wrapperRef, {
    ownerId: menuOwnerId,
    identity: projection?.designId,
    onDeactivate: () => {
      setWireSession(null);
      marquee.cancelMarquee();
      finalizeDragRef.current(false);
      setArmedLabelText(null);
      setArmedPrimitive(null);
      setArmedComponentDetail(null);
      actions.setWireSourcePinId(null);
    },
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isShortcutBlocked(event, { scopeRoot: wrapperRef.current })) return;

      const undo = matchesShortcut(event, "Mod+Z");
      const redo =
        matchesShortcut(event, "Mod+Shift+Z") ||
        matchesShortcut(event, "Ctrl+Y");
      if (undo || redo) {
        event.preventDefault();
        // History must not invalidate geometry beneath an unfinished gesture.
        if (
          wireSession ||
          marquee.marqueeSession ||
          dragRef.current ||
          armedLabelText ||
          armedPrimitive ||
          armedComponentDetail ||
          draggingComponentId ||
          commentMode
        )
          return;
        if ((undo && !canUndo) || (redo && !canRedo)) return;
        void (undo ? actions.undo() : actions.redo()).catch((error: unknown) =>
          actions.setError(
            error instanceof Error ? error.message : "History action failed",
          ),
        );
        return;
      }

      if (matchesShortcut(event, "Escape")) {
        if (
          wireSession ||
          marquee.marqueeSession ||
          dragRef.current ||
          armedLabelText ||
          armedPrimitive ||
          armedComponentDetail ||
          pwrPickerOpen ||
          netPortalPickerOpen
        ) {
          event.preventDefault();
          setWireSession(null);
          marquee.cancelMarquee();
          // Cancelled — finalize removes the gesture's window listeners, so
          // a late pointerup can never commit it.
          finalizeDragRef.current(false);
          setArmedLabelText(null);
          setArmedPrimitive(null);
          setArmedComponentDetail(null);
          setPwrPickerOpen(false);
          setNetPortalPickerOpen(false);
          actions.setWireSourcePinId(null);
        }
        return;
      }

      if (matchesShortcut(event, "Mod+A")) {
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

      if (
        matchesShortcut(event, "Delete") ||
        matchesShortcut(event, "Backspace")
      ) {
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
        void actions
          .dispatchCommandsBatch(commands)
          .then(() => setSelection(emptySelection()))
          .catch((error) =>
            actions.setError(
              error instanceof Error ? error.message : "Delete failed",
            ),
          );
        return;
      }

      if (
        (matchesShortcut(event, "R") || matchesShortcut(event, "Shift+R")) &&
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
        void actions
          .dispatchCommandsBatch(commands)
          .catch((error) =>
            actions.setError(
              error instanceof Error ? error.message : "Rotate failed",
            ),
          );
        return;
      }

      if (matchesShortcut(event, "L")) {
        event.preventDefault();
        setArmedLabelText(labelDraftText.trim() || "NET");
        return;
      }

      if (matchesShortcut(event, "G")) {
        event.preventDefault();
        setArmedPrimitive({ kind: "gnd" });
        return;
      }

      if (matchesShortcut(event, "P")) {
        event.preventDefault();
        setPwrPickerOpen(true);
        return;
      }

      if (matchesShortcut(event, "H")) {
        event.preventDefault();
        setNetPortalPickerOpen(true);
        return;
      }

      // Comment mode — same toggle the toolbar's "Comment (C)" button drives.
      if (onToggleCommentMode && matchesShortcut(event, "C")) {
        event.preventDefault();
        onToggleCommentMode();
        return;
      }
    };

    const root = wrapperRef.current;
    root?.addEventListener("keydown", handleKeyDown);
    return () => root?.removeEventListener("keydown", handleKeyDown);
  }, [
    actions,
    onToggleCommentMode,
    canUndo,
    canRedo,
    commentMode,
    draggingComponentId,
    armedLabelText,
    armedPrimitive,
    armedComponentDetail,
    pwrPickerOpen,
    netPortalPickerOpen,
    labelDraftText,
    marquee,
    projection,
    selection,
    wireSession,
  ]);

  // Live wire re-route while dragging: wires attached to the dragged parts/
  // primitives preview their COMMIT geometry each drag step (shared with the
  // drop path via computeDragWireOverrides). Reads effectiveProjection so a
  // drag started while a previous move is still saving re-routes from the
  // optimistic — not stale — endpoints.
  const dragReroutedWires = useMemo(() => {
    const state = dragRef.current;
    if (!effectiveProjection || !state || state.phase !== "active") {
      return new Map<string, PointNm[]>();
    }
    if (state.kind === "wireSegment") {
      return new Map<string, PointNm[]>([
        [
          state.wireId,
          dragWireSegment(
            state.basePointsNm,
            state.segmentIndex,
            state.deltaNm,
            state.gridNm,
          ),
        ],
      ]);
    }
    return computeDragWireOverrides(
      effectiveProjection,
      state.initialPartPositionsNm,
      state.initialPrimitivePositionsNm,
      state.deltaNm,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dragVersion tracks dragRef mutations
  }, [dragVersion, effectiveProjection]);

  // ── Drag lifecycle ──
  // One idempotent finalization path (the ref is nulled on entry) shared by
  // the canvas pointerup, the per-gesture window listeners (pointerup lost
  // off-canvas → commit; pointercancel/blur → cancel), Escape, and the
  // stuck-session click guard. A sub-threshold gesture ("armed") finalizes
  // as a plain click — nothing to commit, nothing left behind.
  const finalizeDrag = useCallback(
    (commit: boolean) => {
      const state = dragRef.current;
      if (!state) return;
      dragRef.current = null;
      state.cleanup();
      setDragVersion((v) => v + 1);
      const hasMovement = state.deltaNm.x !== 0 || state.deltaNm.y !== 0;
      if (!commit || state.phase !== "active" || !hasMovement) return;

      if (state.kind === "wireSegment") {
        const finalPoints = dragWireSegment(
          state.basePointsNm,
          state.segmentIndex,
          state.deltaNm,
          state.gridNm,
        );
        // dragWireSegment returns the base array unchanged on a no-op.
        if (finalPoints === state.basePointsNm) return;
        setPendingMove((prev) =>
          mergePendingMoves(prev, {
            partPositionsNm: new Map(),
            primitivePositionsNm: new Map(),
            wirePointsNm: new Map([[state.wireId, finalPoints]]),
          }),
        );
        movesInFlightRef.current += 1;
        moveChainRef.current = moveChainRef.current
          .then(() =>
            actions.dispatchCommandsBatch([
              {
                type: "update_wire_geometry",
                wireId: state.wireId,
                pointsNm: finalPoints,
              },
            ]),
          )
          .catch((err) =>
            actions.setError(
              err instanceof Error ? err.message : "Failed to move wire",
            ),
          )
          .finally(() => {
            movesInFlightRef.current -= 1;
            if (movesInFlightRef.current === 0) setPendingMove(null);
          });
        return;
      }

      const commands: DesignerCommand[] = [];
      const partPositionsNm = new Map<string, PointNm>();
      const primitivePositionsNm = new Map<string, PointNm>();
      for (const [partId, initial] of state.initialPartPositionsNm.entries()) {
        const positionNm = {
          x: initial.x + state.deltaNm.x,
          y: initial.y + state.deltaNm.y,
        };
        partPositionsNm.set(partId, positionNm);
        commands.push({ type: "move_part", partId, positionNm });
      }
      for (const [
        primitiveId,
        initial,
      ] of state.initialPrimitivePositionsNm.entries()) {
        const positionNm = {
          x: initial.x + state.deltaNm.x,
          y: initial.y + state.deltaNm.y,
        };
        primitivePositionsNm.set(primitiveId, positionNm);
        commands.push({ type: "move_primitive", primitiveId, positionNm });
      }
      // Re-compute the dropped wire geometry from the FINAL delta — the
      // render memo can lag one pointer step behind this event.
      const wirePointsNm = effectiveProjection
        ? computeDragWireOverrides(
            effectiveProjection,
            state.initialPartPositionsNm,
            state.initialPrimitivePositionsNm,
            state.deltaNm,
          )
        : new Map<string, PointNm[]>();

      // Hold the dropped state on screen until every enqueued move chain has
      // landed AND the projection refreshed. Drops merge over any overlay
      // still in flight; the overlay clears only when the whole queue drains
      // — a chain finishing early must not strip a newer drop's overlay.
      setPendingMove((prev) =>
        mergePendingMoves(prev, {
          partPositionsNm,
          primitivePositionsNm,
          wirePointsNm,
        }),
      );
      // Serialize drops: each batch dispatches only after the previous one
      // (including its projection refresh) settled, so concurrent chains can
      // never interleave move commands or race baseRevision.
      movesInFlightRef.current += 1;
      moveChainRef.current = moveChainRef.current
        .then(() => actions.dispatchCommandsBatch(commands))
        .catch((err) =>
          actions.setError(
            err instanceof Error ? err.message : "Failed to move",
          ),
        )
        .finally(() => {
          movesInFlightRef.current -= 1;
          if (movesInFlightRef.current === 0) setPendingMove(null);
        });
    },
    [actions, effectiveProjection],
  );
  finalizeDragRef.current = finalizeDrag;

  // Arm a move gesture: pointer capture + per-gesture window listeners. The
  // gesture stays a plain click until the pointer travels DRAG_THRESHOLD_PX.
  const armDrag = useCallback(
    (
      event: InteractionEvent,
      worldNm: PointNm,
      payload: DragMovePayloadUnion,
    ) => {
      // Never two live gestures — cancel any leftover state first.
      finalizeDragRef.current(false);
      const releaseCapture = capturePointerForDrag(event);
      const handleUp = () => finalizeDragRef.current(true);
      const handleCancel = () => finalizeDragRef.current(false);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleCancel);
      window.addEventListener("blur", handleCancel);
      dragRef.current = {
        ...payload,
        phase: "armed",
        startScreenPx: { x: event.screenPoint.x, y: event.screenPoint.y },
        startPointerNm: worldNm,
        deltaNm: { x: 0, y: 0 },
        gridNm,
        cleanup: () => {
          window.removeEventListener("pointerup", handleUp);
          window.removeEventListener("pointercancel", handleCancel);
          window.removeEventListener("blur", handleCancel);
          releaseCapture();
        },
      };
    },
    [gridNm],
  );

  // Component unmount mid-gesture must not leak the window listeners.
  useEffect(
    () => () => {
      const state = dragRef.current;
      if (state) {
        dragRef.current = null;
        state.cleanup();
      }
    },
    [],
  );

  const interactionHandler: InteractionHandler = useMemo(
    () => ({
      onPointerMove(event) {
        const worldNm = {
          x: Math.round(event.worldPoint.x),
          y: Math.round(event.worldPoint.y),
        };
        setCursorNm((prev) => {
          if (prev?.x === worldNm.x && prev.y === worldNm.y) {
            return prev;
          }
          return worldNm;
        });

        const dragState = dragRef.current;
        if (dragState) {
          if (dragState.phase === "armed") {
            // Screen-space threshold: below it the gesture is still a click
            // (select only) — parts never stick to an accidental press.
            const dxPx = event.screenPoint.x - dragState.startScreenPx.x;
            const dyPx = event.screenPoint.y - dragState.startScreenPx.y;
            if (Math.hypot(dxPx, dyPx) >= DRAG_THRESHOLD_PX) {
              dragState.phase = "active";
            }
          }
          if (dragState.phase === "active") {
            const rawDelta = {
              x: worldNm.x - dragState.startPointerNm.x,
              y: worldNm.y - dragState.startPointerNm.y,
            };
            const snappedDelta =
              dragState.kind === "wireSegment"
                ? rawDelta
                : snappedMoveDeltaNm(
                    dragState.originNm,
                    rawDelta,
                    dragState.gridNm,
                  );
            if (
              snappedDelta.x !== dragState.deltaNm.x ||
              snappedDelta.y !== dragState.deltaNm.y
            ) {
              dragState.deltaNm = snappedDelta;
              setDragVersion((v) => v + 1);
            }
          }
        }

        if (marquee.marqueeSession) {
          marquee.updateMarqueeCursor(toMm(worldNm));
        }

        const busy = !!(
          dragRef.current ||
          marquee.marqueeSession ||
          wireSession ||
          armedPrimitive ||
          armedComponentDetail ||
          armedLabelText
        );
        hoverBusyRef.current = busy;
        if (busy) {
          cancelHover();
          setHoverNet(null);
        } else {
          scheduleHover(worldNm);
        }
      },
      onPointerLeave() {
        setCursorNm((prev) => (prev === null ? prev : null));
        cancelHover();
        setHoverNet(null);
      },
      onPointerDown(event) {
        // A press may start a gesture: drop any queued/applied hover.
        hoverBusyRef.current = true;
        cancelHover();
        setHoverNet(null);
        if (!projection) {
          return;
        }

        // Belt-and-braces: a live gesture surviving to the next pointerdown
        // should be impossible (per-gesture window listeners finalize on any
        // release), but if one exists, treat this press as its drop.
        if (dragRef.current?.phase === "active") {
          finalizeDrag(true);
          return;
        }
        if (dragRef.current) {
          finalizeDrag(false);
        }

        const worldNm = {
          x: Math.round(event.worldPoint.x),
          y: Math.round(event.worldPoint.y),
        };
        const snappedWorldNm = snap(worldNm);
        const pin = hitPin(worldNm);
        const wireHit = hitWire(worldNm);
        const partId = hitPartId(worldNm);
        const labelId = hitLabelId(worldNm);
        const primitiveId = hitPrimitiveId(worldNm);

        if (commentMode && onCreateComment) {
          const r = wrapperRef.current?.getBoundingClientRect();
          setCommentDraft({
            anchor: {
              surface: "schematic",
              pointNm: snappedWorldNm,
              entity: pin
                ? { kind: "pin", id: pin.id }
                : wireHit
                  ? { kind: "wire", id: wireHit.wire.id }
                  : partId
                    ? { kind: "part", id: partId }
                    : labelId
                      ? { kind: "label", id: labelId }
                      : primitiveId
                        ? { kind: "primitive", id: primitiveId }
                        : undefined,
              sourceRevision: projection.revision,
            },
            screen: {
              x: event.screenPoint.x - (r?.left ?? 0),
              y: event.screenPoint.y - (r?.top ?? 0),
            },
          });
          return;
        }

        if (armedComponentDetail) {
          void actions
            .dispatchCommand({
              type: "place_part",
              componentId: armedComponentDetail.component.id,
              positionNm: snappedWorldNm,
            })
            .then(() => {
              setArmedComponentDetail(null);
            })
            .catch((err) =>
              actions.setError(
                err instanceof Error
                  ? err.message
                  : "Failed to place component",
              ),
            );
          return;
        }

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
          // A selected electrical anchor is exact, even when intentionally off-grid.
          const positionNm = pin?.worldPositionNm ?? snappedWorldNm;
          const command =
            armedPrimitive.kind === "gnd"
              ? {
                  type: "place_gnd_port" as const,
                  positionNm,
                }
              : armedPrimitive.kind === "pwr"
                ? {
                    type: "place_pwr_port" as const,
                    positionNm,
                    railText: armedPrimitive.railText,
                  }
                : {
                    type: "place_net_portal" as const,
                    positionNm,
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
            waypointsNm: [
              ...activeSession.waypointsNm,
              snapWireWaypointNm(
                worldNm,
                activeSession.waypointsNm.at(-1) ?? sourcePin.worldPositionNm,
                gridNm,
                cameraRef.current?.zoom ?? 1,
              ),
            ],
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
          marquee.cancelMarquee();
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
          // Seed from the EFFECTIVE (pending-move-aware) positions — seeding
          // from the raw projection mid-flight teleports the part back to its
          // pre-move position and commits the next move from that stale base.
          const effective = effectiveProjection ?? projection;
          const initialPartPositionsNm = new Map<string, PointNm>();
          for (const selectedPartId of selectedPartIds) {
            const selectedPart = effective.parts.find(
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
              const found = effective.primitives.find((p) => p.id === id);
              if (!found) continue;
              initialPrimitivePositionsNm.set(id, {
                x: found.positionNm.x,
                y: found.positionNm.y,
              });
            }
          }

          armDrag(event, worldNm, {
            kind: "move",
            originNm: initialPartPositionsNm.get(partId) ?? worldNm,
            initialPartPositionsNm,
            initialPrimitivePositionsNm,
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
            return;
          }
          marquee.cancelMarquee();
          setWireSession(null);
          setSelection({
            partIds: new Set(),
            wireIds: new Set([wireHit.wire.id]),
            labelIds: new Set(),
            primitiveIds: new Set(),
          });
          // Arm a segment drag: grab anywhere on an orthogonal segment and slide
          // it perpendicular to its axis (Flux-style). Below-threshold gestures
          // stay a plain select; the endpoints remain pinned to their pins.
          if (wireHit.axis) {
            armDrag(event, worldNm, {
              kind: "wireSegment",
              wireId: wireHit.wire.id,
              segmentIndex: wireHit.segmentIndex,
              basePointsNm: wireHit.wire.pointsNm.map((p) => ({
                x: p.x,
                y: p.y,
              })),
            });
          }
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
          return;
        }

        if (primitiveId) {
          marquee.cancelMarquee();
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
          const effective = effectiveProjection ?? projection;
          const initialPrimitivePositionsNm = new Map<string, PointNm>();
          for (const id of selectedPrimitiveIds) {
            const found = effective.primitives.find((p) => p.id === id);
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
              const found = effective.parts.find((p) => p.id === id);
              if (!found) continue;
              initialPartPositionsNm.set(id, {
                x: found.positionNm.x,
                y: found.positionNm.y,
              });
            }
          }

          armDrag(event, worldNm, {
            kind: "move",
            originNm: initialPrimitivePositionsNm.get(primitiveId) ?? worldNm,
            initialPartPositionsNm,
            initialPrimitivePositionsNm,
          });
          return;
        }

        const startMm = toMm(worldNm);
        marquee.beginMarquee(startMm, event.modifiers.shift);
      },
      onPointerUp() {
        if (!projection) {
          return;
        }

        if (dragRef.current) {
          // Fast path — the per-gesture window listener would finalize this
          // same release anyway (finalizeDrag is idempotent).
          finalizeDrag(true);
          return;
        }

        if (marquee.marqueeSession) {
          marquee.finishMarquee();
        }
      },
      onContextMenu(event) {
        if (!projection) {
          return;
        }

        const worldNm = {
          x: Math.round(event.worldPoint.x),
          y: Math.round(event.worldPoint.y),
        };

        const pin = hitPin(worldNm);
        const wireHit = hitWire(worldNm);
        const partId = hitPartId(worldNm);
        const labelId = hitLabelId(worldNm);
        const primitiveId = hitPrimitiveId(worldNm);

        const groups: ContextMenuGroup[] = [];

        if (partId) {
          if (!selection.partIds.has(partId)) {
            setSelection({
              partIds: new Set([partId]),
              wireIds: new Set(),
              labelIds: new Set(),
              primitiveIds: new Set(),
            });
          }
          groups.push({
            id: "part-actions",
            items: [
              {
                kind: "action",
                id: "rotate-cw",
                label: "Rotate 90° clockwise",
                shortcut: "R",
                onSelect: () => {
                  const part = projection.parts.find((p) => p.id === partId);
                  if (!part) return;
                  const next = ((((part.rotationDeg + 90) % 360) + 360) %
                    360) as 0 | 90 | 180 | 270;
                  void actions
                    .dispatchCommand({
                      type: "rotate_part",
                      partId,
                      rotationDeg: next,
                    })
                    .catch((err) =>
                      actions.setError(
                        err instanceof Error ? err.message : "Rotate failed",
                      ),
                    );
                },
              },
              {
                kind: "action",
                id: "rotate-ccw",
                label: "Rotate 90° counter-clockwise",
                shortcut: "Shift+R",
                onSelect: () => {
                  const part = projection.parts.find((p) => p.id === partId);
                  if (!part) return;
                  const next = ((((part.rotationDeg - 90) % 360) + 360) %
                    360) as 0 | 90 | 180 | 270;
                  void actions
                    .dispatchCommand({
                      type: "rotate_part",
                      partId,
                      rotationDeg: next,
                    })
                    .catch((err) =>
                      actions.setError(
                        err instanceof Error ? err.message : "Rotate failed",
                      ),
                    );
                },
              },
              {
                kind: "separator",
                id: "sep-rotate-delete",
              },
              {
                kind: "action",
                id: "delete-part",
                label: "Delete",
                shortcut: "Del",
                destructive: true,
                onSelect: () => {
                  void actions
                    .dispatchCommand({
                      type: "delete_entity",
                      entityId: partId,
                      entityKind: "part",
                    })
                    .then(() => setSelection(emptySelection()))
                    .catch((err) =>
                      actions.setError(
                        err instanceof Error ? err.message : "Delete failed",
                      ),
                    );
                },
              },
            ],
          });
        } else if (wireHit) {
          if (!selection.wireIds.has(wireHit.wire.id)) {
            setSelection({
              partIds: new Set(),
              wireIds: new Set([wireHit.wire.id]),
              labelIds: new Set(),
              primitiveIds: new Set(),
            });
          }
          groups.push({
            id: "wire-actions",
            items: [
              {
                kind: "action",
                id: "delete-wire",
                label: "Delete wire",
                shortcut: "Del",
                destructive: true,
                onSelect: () => {
                  void actions
                    .dispatchCommand({
                      type: "delete_entity",
                      entityId: wireHit.wire.id,
                      entityKind: "wire",
                    })
                    .then(() => setSelection(emptySelection()))
                    .catch((err) =>
                      actions.setError(
                        err instanceof Error ? err.message : "Delete failed",
                      ),
                    );
                },
              },
            ],
          });
        } else if (labelId) {
          if (!selection.labelIds.has(labelId)) {
            setSelection({
              partIds: new Set(),
              wireIds: new Set(),
              labelIds: new Set([labelId]),
              primitiveIds: new Set(),
            });
          }
          groups.push({
            id: "label-actions",
            items: [
              {
                kind: "action",
                id: "delete-label",
                label: "Delete label",
                shortcut: "Del",
                destructive: true,
                onSelect: () => {
                  void actions
                    .dispatchCommand({
                      type: "delete_entity",
                      entityId: labelId,
                      entityKind: "label",
                    })
                    .then(() => setSelection(emptySelection()))
                    .catch((err) =>
                      actions.setError(
                        err instanceof Error ? err.message : "Delete failed",
                      ),
                    );
                },
              },
            ],
          });
        } else if (primitiveId) {
          if (!selection.primitiveIds.has(primitiveId)) {
            setSelection({
              partIds: new Set(),
              wireIds: new Set(),
              labelIds: new Set(),
              primitiveIds: new Set([primitiveId]),
            });
          }
          const primitive = projection.primitives.find(
            (p) => p.id === primitiveId,
          );
          groups.push({
            id: "primitive-actions",
            items: [
              {
                kind: "action",
                id: "rotate-cw",
                label: "Rotate 90° clockwise",
                onSelect: () => {
                  if (!primitive) return;
                  const next = ((((primitive.rotationDeg + 90) % 360) + 360) %
                    360) as 0 | 90 | 180 | 270;
                  void actions
                    .dispatchCommand({
                      type: "rotate_primitive",
                      primitiveId,
                      rotationDeg: next,
                    })
                    .catch((err) =>
                      actions.setError(
                        err instanceof Error ? err.message : "Rotate failed",
                      ),
                    );
                },
              },
              {
                kind: "action",
                id: "rotate-ccw",
                label: "Rotate 90° counter-clockwise",
                onSelect: () => {
                  if (!primitive) return;
                  const next = ((((primitive.rotationDeg - 90) % 360) + 360) %
                    360) as 0 | 90 | 180 | 270;
                  void actions
                    .dispatchCommand({
                      type: "rotate_primitive",
                      primitiveId,
                      rotationDeg: next,
                    })
                    .catch((err) =>
                      actions.setError(
                        err instanceof Error ? err.message : "Rotate failed",
                      ),
                    );
                },
              },
              {
                kind: "separator",
                id: "sep-rotate-delete",
              },
              {
                kind: "action",
                id: "delete-primitive",
                label: "Delete",
                shortcut: "Del",
                destructive: true,
                onSelect: () => {
                  void actions
                    .dispatchCommand({
                      type: "delete_entity",
                      entityId: primitiveId,
                      entityKind: "primitive",
                    })
                    .then(() => setSelection(emptySelection()))
                    .catch((err) =>
                      actions.setError(
                        err instanceof Error ? err.message : "Delete failed",
                      ),
                    );
                },
              },
            ],
          });
        } else {
          groups.push(
            {
              id: "selection",
              items: [
                {
                  kind: "action",
                  id: "select-all",
                  label: "Select all",
                  shortcut: formatShortcut("Mod+A"),
                  onSelect: () => {
                    setSelection({
                      partIds: new Set(projection.parts.map((p) => p.id)),
                      wireIds: new Set(projection.wires.map((w) => w.id)),
                      labelIds: new Set(projection.labels.map((l) => l.id)),
                      primitiveIds: new Set(
                        projection.primitives.map((p) => p.id),
                      ),
                    });
                  },
                },
                {
                  kind: "action",
                  id: "clear-selection",
                  label: "Clear selection",
                  shortcut: "Esc",
                  disabled: selectionIsEmpty(selection),
                  onSelect: () => setSelection(emptySelection()),
                },
              ],
            },
            {
              id: "place",
              items: [
                {
                  kind: "action",
                  id: "place-gnd",
                  label: "Place GND",
                  shortcut: "G",
                  onSelect: () => setArmedPrimitive({ kind: "gnd" }),
                },
                {
                  kind: "action",
                  id: "place-pwr",
                  label: "Place PWR",
                  shortcut: "P",
                  onSelect: () => setPwrPickerOpen(true),
                },
                {
                  kind: "action",
                  id: "place-label",
                  label: "Place net label",
                  shortcut: "L",
                  onSelect: () =>
                    setArmedLabelText(labelDraftText.trim() || "NET"),
                },
              ],
            },
          );
        }

        if (onCreateComment) {
          groups.push({
            id: "comment",
            items: [
              {
                kind: "action",
                id: "add-comment",
                label: "Add comment",
                onSelect: () => {
                  const r = wrapperRef.current?.getBoundingClientRect();
                  setCommentDraft({
                    anchor: {
                      surface: "schematic",
                      pointNm: snap(worldNm),
                      entity: pin
                        ? { kind: "pin", id: pin.id }
                        : wireHit
                          ? { kind: "wire", id: wireHit.wire.id }
                          : partId
                            ? { kind: "part", id: partId }
                            : labelId
                              ? { kind: "label", id: labelId }
                              : primitiveId
                                ? { kind: "primitive", id: primitiveId }
                                : undefined,
                      sourceRevision: projection.revision,
                    },
                    screen: {
                      x: event.screenPoint.x - (r?.left ?? 0),
                      y: event.screenPoint.y - (r?.top ?? 0),
                    },
                  });
                },
              },
            ],
          });
        }

        openContextMenu({
          scope: "schematic",
          ownerId: menuOwnerId,
          position: { x: event.screenPoint.x, y: event.screenPoint.y },
          groups,
        });
      },
      onDragEnter(event) {
        const componentId = event.getData(COMPONENT_DND_MIME);
        if (componentId && componentId !== draggingComponentId) {
          void actions.beginDragComponent(componentId).catch(() => {});
        }
        actions.setDragGhostNm(snap(event.worldPoint));
      },
      onDragOver(event) {
        const componentId = event.getData(COMPONENT_DND_MIME);
        if (componentId && !dragPlacementDetail && !dragPlacementLoading) {
          void actions.beginDragComponent(componentId).catch(() => {});
        }
        actions.setDragGhostNm(snap(event.worldPoint));
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

        const snapped = snap({
          x: Math.round(event.worldPoint.x),
          y: Math.round(event.worldPoint.y),
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
      armedComponentDetail,
      armDrag,
      cancelHover,
      commentMode,
      commentThreads,
      commitWireToPin,
      commitWireToWireJunction,
      dragPlacementDetail,
      dragPlacementLoading,
      dragGhostNm,
      draggingComponentId,
      effectiveProjection,
      finalizeDrag,
      hitLabelId,
      hitPartId,
      hitPin,
      hitPrimitiveId,
      hitWire,
      labelDraftText,
      menuOwnerId,
      marquee,
      onCreateComment,
      onSelectCommentThread,
      pinById,
      projection,
      renderedPartPositionNm,
      scheduleHover,
      selection,
      setHoverNet,
      snap,
      gridNm,
      wireSession,
    ],
  );

  // Wires as displayed: effectiveProjection already carries any pending-move
  // geometry; the live drag re-route layers on top (merge, not replace — a
  // previous drop's wires must not snap back the instant a new drag starts).
  const effectiveWires = useMemo(() => {
    if (!effectiveProjection) return [];
    if (dragReroutedWires.size === 0) return effectiveProjection.wires;
    return effectiveProjection.wires.map((wire) => {
      const pointsNm = dragReroutedWires.get(wire.id);
      return pointsNm ? { ...wire, pointsNm } : wire;
    });
  }, [dragReroutedWires, effectiveProjection]);

  const selectedWires = useMemo(() => {
    if (selection.wireIds.size === 0) {
      return [];
    }
    return effectiveWires.filter((wire) => selection.wireIds.has(wire.id));
  }, [effectiveWires, selection.wireIds]);

  const unselectedWires = useMemo(() => {
    if (selection.wireIds.size === 0) {
      return effectiveWires;
    }
    return effectiveWires.filter((wire) => !selection.wireIds.has(wire.id));
  }, [effectiveWires, selection.wireIds]);

  const wirePreview = useMemo(() => {
    if (!effectiveProjection || !wireSession || !cursorNm) {
      return null;
    }
    const sourcePin = pinById.get(wireSession.sourcePinId);
    if (!sourcePin) {
      return null;
    }
    const target =
      hitPin(cursorNm)?.worldPositionNm ??
      hitWire(cursorNm)?.projectedNm ??
      snapWireWaypointNm(
        cursorNm,
        wireSession.waypointsNm.at(-1) ?? sourcePin.worldPositionNm,
        gridNm,
        cameraRef.current?.zoom ?? 1,
      );
    // Preview parity with the commit path: a session without user waypoints
    // commits through the backend's obstacle-aware router, so preview with
    // the same shared router. Waypointed sessions preview the exact polyline
    // that will be committed verbatim.
    const pointsNm =
      wireSession.waypointsNm.length === 0
        ? routeSchematicWire({
            source: sourcePin.worldPositionNm,
            target,
            obstacles: collectWireObstacles(effectiveProjection, {
              source: sourcePin.worldPositionNm,
              target,
              sourcePinId: sourcePin.id,
              targetPinId: "preview:cursor",
            }),
          })
        : buildManhattanPathThroughAnchors([
            sourcePin.worldPositionNm,
            ...wireSession.waypointsNm,
            target,
          ]);
    return {
      id: "preview",
      sourcePinId: sourcePin.id,
      targetPinId: "cursor",
      pointsNm,
    } satisfies DesignerWire;
  }, [
    cursorNm,
    gridNm,
    hitPin,
    hitWire,
    pinById,
    effectiveProjection,
    wireSession,
  ]);

  // Live connect-by-touch indicator while dragging (Altium-style): a dragged
  // pin (or primitive connection point) landing on a non-dragged wire's path
  // will auto-connect at commit — preview the junction dot during the drag.
  const dragTouchIndicators = useMemo(() => {
    const state = dragRef.current;
    if (!effectiveProjection || !state || state.phase !== "active") return [];
    if (state.kind !== "move") return [];
    const delta = state.deltaNm;
    if (delta.x === 0 && delta.y === 0) return [];
    const draggedPartIds = new Set(state.initialPartPositionsNm.keys());
    const draggedPrimitiveIds = new Set(
      state.initialPrimitivePositionsNm.keys(),
    );
    const movedPinIds = new Set<string>();
    const movedPoints: PointNm[] = [];
    for (const part of effectiveProjection.parts) {
      if (!draggedPartIds.has(part.id)) continue;
      for (const pin of part.pins) {
        movedPinIds.add(pin.id);
        movedPoints.push({
          x: pin.worldPositionNm.x + delta.x,
          y: pin.worldPositionNm.y + delta.y,
        });
      }
    }
    for (const primitive of effectiveProjection.primitives) {
      if (!draggedPrimitiveIds.has(primitive.id)) continue;
      movedPinIds.add(`primitive:${primitive.id}`);
      movedPoints.push({
        x: primitive.positionNm.x + delta.x,
        y: primitive.positionNm.y + delta.y,
      });
    }
    // Wires attached to the dragged selection re-route at commit; only wires
    // that stay put are touch targets during the drag.
    const staticWires = effectiveProjection.wires.filter(
      (w) => !movedPinIds.has(w.sourcePinId) && !movedPinIds.has(w.targetPinId),
    );
    const indicators: PointNm[] = [];
    for (const point of movedPoints) {
      for (const w of staticWires) {
        let touched = false;
        for (let i = 1; i < w.pointsNm.length; i += 1) {
          const a = w.pointsNm[i - 1];
          const b = w.pointsNm[i];
          if (a && b && pointOnOrthogonalSegment(point, a, b)) {
            touched = true;
            break;
          }
        }
        if (touched) {
          indicators.push(point);
          break;
        }
      }
    }
    return indicators;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dragVersion tracks dragRef mutations
  }, [dragVersion, effectiveProjection]);

  const dragGhostModel = dragPlacementDetail?.symbol.preview ?? null;
  const componentGhostModel = armedComponentDetail?.symbol.preview ?? null;
  const componentGhostNm =
    armedComponentDetail && cursorNm ? snap(cursorNm) : null;
  const marqueeOverlay = marquee.overlayProps;

  const displayedPrimitives = useMemo(() => {
    if (!effectiveProjection) return [];
    const state = dragRef.current;
    if (
      !state ||
      state.kind !== "move" ||
      state.initialPrimitivePositionsNm.size === 0
    ) {
      return effectiveProjection.primitives;
    }
    return effectiveProjection.primitives.map((primitive) => {
      const positionNm = renderedPrimitivePositionNm(primitive);
      if (
        positionNm.x === primitive.positionNm.x &&
        positionNm.y === primitive.positionNm.y
      ) {
        return primitive;
      }
      return { ...primitive, positionNm };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dragVersion tracks dragRef mutations
  }, [dragVersion, effectiveProjection, renderedPrimitivePositionNm]);

  const primitiveGhost: DesignerPrimitive | null = useMemo(() => {
    if (!armedPrimitive || !cursorNm) return null;
    const snapped = hitPin(cursorNm)?.worldPositionNm ?? snap(cursorNm);
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
  }, [armedPrimitive, cursorNm, snap, hitPin]);

  return (
    <section
      ref={wrapperRef}
      tabIndex={0}
      aria-label="Schematic canvas"
      className="relative h-full w-full min-h-0 rounded-none"
    >
      <EdaCanvas
        themeMode={mode}
        readOnly={false}
        interactionHandler={interactionHandler}
        className="h-full w-full"
        initialZoom={DEFAULT_SCHEMATIC_ZOOM}
        enableDragDrop
        gridSize={gridNm}
        backgroundColor={canvasBackground}
      >
        <CameraRefBridge
          cameraRef={cameraRef}
          onZoomChange={onZoomChange}
          onReady={markCameraReady}
        />
        <ZoomReporter onZoomChange={onZoomChange} />
        <ViewportReporter
          enabledRef={viewportReportingRef}
          onViewportChange={(zoom, posX, posY) => {
            projection2d.setViewport(zoom, posX, posY);
            onViewportChange?.(zoom, posX, posY);
          }}
        />
        <InvalidateOnCanvasChange
          projection={effectiveProjection}
          cursorNm={cursorNm}
          selection={selection}
          dragVersion={dragVersion}
          pendingMove={pendingMove}
          marqueeRect={{ a: marqueeOverlay.a, b: marqueeOverlay.b }}
          wireSession={wireSession}
          armedComponentDetail={armedComponentDetail}
          highlightedNetId={highlightedNetId}
        />
        <SchematicScene
          projection={effectiveProjection}
          netIndex={netIndex}
          gridVisible={gridVisible}
          unselectedWires={unselectedWires}
          selectedWires={selectedWires}
          wirePreview={wirePreview}
          parts={effectiveProjection?.parts ?? []}
          renderedPartPositionNm={renderedPartPositionNm}
          selection={selection}
          labels={effectiveProjection?.labels ?? []}
          primitives={displayedPrimitives}
          primitiveGhost={primitiveGhost}
          junctions={effectiveProjection?.junctions ?? []}
          dragTouchIndicators={dragTouchIndicators}
          marqueeOverlay={marqueeOverlay}
          dragGhostNm={dragGhostNm}
          dragGhostModel={dragGhostModel}
          componentGhostNm={componentGhostNm}
          componentGhostModel={componentGhostModel}
          commentThreads={commentThreads}
          activeCommentThreadId={activeCommentThreadId}
        />
      </EdaCanvas>
      <CanvasCommentLayer
        threads={commentThreads}
        activeThreadId={activeCommentThreadId}
        mirrored={false}
        rect={projection2d.rect}
        project={projection2d.project}
        screenToWorld={projection2d.screenToWorld}
        clampToEdge={projection2d.clampToEdge}
        draft={commentDraft}
        currentUserEmail={currentUserEmail}
        attachmentUrl={commentAttachmentUrl ?? (() => "")}
        onCreateComment={(anchor, body) => {
          onCreateComment?.(anchor, body);
          setCommentDraft(null);
        }}
        onCancelDraft={() => setCommentDraft(null)}
        onOpenThread={(id) => onSelectCommentThread?.(id)}
        onCloseThread={() => onCloseCommentThread?.()}
        onRecenter={recenterOnNm}
        onMoveComment={(thread, pointNm) => onMoveComment?.(thread, pointNm)}
        onAddMessage={async (thread, body, file) => {
          await onAddCommentMessage?.(thread, body, file);
        }}
        onSetStatus={async (thread, status) => {
          await onSetCommentStatus?.(thread, status);
        }}
        onSetTodoStatus={async (thread, todoStatus) => {
          await onSetCommentTodoStatus?.(thread, todoStatus);
        }}
        onToggleReaction={async (thread, messageId, emoji) => {
          await onToggleCommentReaction?.(thread, messageId, emoji);
        }}
      />
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
  netIndex: SchematicNetIndex;
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
  /** Connect-by-touch preview dots shown while dragging (world nm). */
  dragTouchIndicators: PointNm[];
  marqueeOverlay: { a: PointMm | null; b: PointMm | null; color: string };
  dragGhostNm: { x: number; y: number } | null;
  dragGhostModel: SymbolRenderModel | null;
  componentGhostNm: { x: number; y: number } | null;
  componentGhostModel: SymbolRenderModel | null;
  commentThreads: readonly DesignerCommentThread[];
  activeCommentThreadId: string | null;
}

function SchematicScene({
  projection,
  netIndex,
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
  dragTouchIndicators,
  marqueeOverlay,
  dragGhostNm,
  dragGhostModel,
  componentGhostNm,
  componentGhostModel,
  commentThreads,
  activeCommentThreadId,
}: SchematicSceneProps) {
  const { theme } = useCanvasTheme();
  const t = theme.schematic;

  // Cross-probe: split unselected wires by net when a highlight is active
  // (set from this view or from the PCB view via the designer-wide store).
  const highlightedNetId = useDesignerHighlight((s) => s.highlightedNetId);
  const wireToNet = netIndex.wire;

  // Net-highlight: non-net text/glyphs dim to this opacity. Part bodies are
  // not dimmed (SymbolRenderLayer exposes no opacity); pins of the net get an
  // emphasis dot instead.
  const dimOpacity = highlightedNetId ? NET_DIM_OPACITY : 1;
  const highlightedPrimitiveIds = useMemo(() => {
    if (!highlightedNetId) return null;
    const ids = new Set<string>();
    for (const [id, netId] of netIndex.primitive) {
      if (netId === highlightedNetId) ids.add(id);
    }
    return ids;
  }, [highlightedNetId, netIndex]);
  const highlightedPinPoints = useMemo(() => {
    const points: PointNm[] = [];
    if (!highlightedNetId) return points;
    for (const part of parts) {
      const rendered = renderedPartPositionNm(part);
      const dx = rendered.x - part.positionNm.x;
      const dy = rendered.y - part.positionNm.y;
      for (const pin of part.pins) {
        if (netIndex.pin.get(pin.id) !== highlightedNetId) continue;
        points.push({
          x: pin.worldPositionNm.x + dx,
          y: pin.worldPositionNm.y + dy,
        });
      }
    }
    return points;
  }, [highlightedNetId, netIndex, parts, renderedPartPositionNm]);

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

  // Display geometry with crossing gaps (audit §4.8): where independent wires
  // cross without connecting, the vertical segment renders with a small break.
  // Stored geometry / hit-testing / selection are untouched.
  const displayRunsByWireId = useMemo(() => {
    if (!projection) return null;
    // Use the wires as passed in (they carry live drag re-route geometry),
    // not projection.wires, so gaps track the previewed positions.
    return computeWireCrossingGaps(
      [...unselectedWires, ...selectedWires],
      projection.junctions,
    );
  }, [projection, selectedWires, unselectedWires]);

  const toDisplayWires = useCallback(
    (wires: DesignerWire[]): DesignerWire[] =>
      wires.flatMap((wire) => {
        const runs = displayRunsByWireId?.get(wire.id);
        if (!runs || runs.length <= 1) return [wire];
        return runs.map((run, index) => ({
          ...wire,
          id: `${wire.id}#gap${index}`,
          pointsNm: run,
        }));
      }),
    [displayRunsByWireId],
  );

  // Bucket ALL wires (selected + unselected) by net class so selected wires
  // keep their net-class color. The selection halo is rendered as a
  // separate thicker pass behind the wires. Wires flagged by the auto-router
  // as committed on its known-colliding fallback (audit §4.4) split into a
  // dedicated warning bucket instead of their net-class color.
  const { wireBucketsByClass, collidingWires } = useMemo(() => {
    const buckets: Record<WireNetClass, DesignerWire[]> = {
      default: [],
      gnd: [],
      power: [],
    };
    const colliding: DesignerWire[] = [];
    // Classify on the ORIGINAL wire ids first (gap pseudo-ids would miss the
    // net-class map), then swap in the gapped display geometry per group.
    for (const wire of [...dimmedUnselectedWires, ...selectedWires]) {
      if (wire.routeStatus === "colliding") {
        colliding.push(wire);
        continue;
      }
      const cls = wireToClass.get(wire.id) ?? "default";
      buckets[cls].push(wire);
    }
    return {
      wireBucketsByClass: {
        default: toDisplayWires(buckets.default),
        gnd: toDisplayWires(buckets.gnd),
        power: toDisplayWires(buckets.power),
      },
      collidingWires: toDisplayWires(colliding),
    };
  }, [dimmedUnselectedWires, selectedWires, toDisplayWires, wireToClass]);

  const wireOpacity = highlightedNetId ? 0.2 : 1;

  const displayHighlightedWires = useMemo(
    () => toDisplayWires(highlightedWires),
    [highlightedWires, toDisplayWires],
  );

  return (
    <>
      <GridShader
        gridSize={SCHEMATIC_GRID_MM}
        visible={gridVisible}
        color={t.gridColor}
        alpha={t.gridAlpha}
        majorAlpha={t.gridMajorAlpha}
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
          {collidingWires.length > 0 ? (
            <WireLayer
              wires={collidingWires}
              color={COLLIDING_WIRE_COLOR}
              opacity={wireOpacity}
            />
          ) : null}
          {displayHighlightedWires.length > 0 ? (
            <WireLayer
              wires={displayHighlightedWires}
              color={t.wireSelectedColor}
            />
          ) : null}
          {/* Selection halo: thicker semi-transparent line behind selected
              wires. The wires themselves render in their net-class color
              via wireBucketsByClass above (selected wires are bucketed
              alongside unselected ones), so the only "selection" indicator
              is this glow underneath. */}
          {selectedWires.length > 0 ? (
            <WireLayer
              wires={selectedWires}
              color={t.selectionColor}
              widthMm={SCHEMATIC_WIRE_WIDTH_MM * 3}
              opacity={0.35}
              renderOrder={RENDER_ORDER.WIRES - 0.1}
            />
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
                <SymbolRenderLayer
                  model={model}
                  counterRotationDeg={part.rotationDeg}
                  counterMirrored={part.mirrored}
                  referenceText={part.reference}
                  valueText={part.value}
                />
                {selected ? (
                  <PartSelectionOutline part={part} color={t.selectionColor} />
                ) : null}
              </group>
            );
          })}

          <PinElectricalIntentMarkers
            parts={parts}
            renderedPartPositionNm={renderedPartPositionNm}
            noConnectColor={t.labelColor}
            powerSourceColor={t.primitivePwrColor}
          />

          {labels.map((label) => {
            const selected = selection.labelIds.has(label.id);
            const onNet =
              !!highlightedNetId &&
              netIndex.label.get(label.id) === highlightedNetId;
            const anchorColor = onNet ? t.wireSelectedColor : t.wireColor;
            const attached = label.attached !== false;
            return (
              <group
                key={label.id}
                position={[
                  Units.nmToMm(label.positionNm.x),
                  Units.nmToMm(label.positionNm.y),
                  0,
                ]}
              >
                <SchematicAttachAnchor
                  attached={attached}
                  color={anchorColor}
                  opacity={onNet ? 1 : dimOpacity}
                  stem
                />
                <EDAText
                  opacity={onNet ? 1 : dimOpacity}
                  position={[LABEL_STEM_MM + 0.1, 0, 0]}
                  color={
                    selected
                      ? t.labelSelectedColor
                      : onNet
                        ? t.wireSelectedColor
                        : t.labelColor
                  }
                  fontSize={NET_LABEL_FONT_MM}
                  anchorX="left"
                  anchorY="middle"
                >
                  {label.text}
                </EDAText>
              </group>
            );
          })}

          <SchematicPrimitivesLayer
            primitives={primitives}
            selectedPrimitiveIds={selection.primitiveIds}
            highlightedPrimitiveIds={highlightedPrimitiveIds}
          />

          {highlightedPinPoints.map((point) => (
            <mesh
              key={`netpin:${point.x}:${point.y}`}
              position={[Units.nmToMm(point.x), Units.nmToMm(point.y), 0]}
              renderOrder={RENDER_ORDER.JUNCTIONS}
            >
              <circleGeometry args={[SYMBOL_PIN_DOT_RADIUS_MM * 1.8, 24]} />
              <meshBasicMaterial
                color={t.wireSelectedColor}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
          ))}

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

          {/* Live connect-by-touch preview while dragging: where a dragged
              pin would land on a wire, a junction dot WILL appear at commit
              — show it during the drag (slightly larger, preview-tinted). */}
          {dragTouchIndicators.map((point) => (
            <mesh
              key={`touch:${point.x}:${point.y}`}
              position={[Units.nmToMm(point.x), Units.nmToMm(point.y), 0]}
              renderOrder={RENDER_ORDER.PREVIEW}
            >
              <circleGeometry args={[0.14, 24]} />
              <meshBasicMaterial
                color={t.wirePreviewColor}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
          ))}

          <SelectionRectOverlay
            a={marqueeOverlay.a}
            b={marqueeOverlay.b}
            color={marqueeOverlay.color}
          />

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

          {componentGhostNm && componentGhostModel ? (
            <group
              position={[
                Units.nmToMm(componentGhostNm.x),
                Units.nmToMm(componentGhostNm.y),
                0,
              ]}
              renderOrder={RENDER_ORDER.PREVIEW}
            >
              <SymbolRenderLayer model={componentGhostModel} />
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
  onReady,
}: {
  cameraRef: React.MutableRefObject<OrthographicCamera | null>;
  onZoomChange?: (zoomPercent: number) => void;
  onReady?: () => void;
}) {
  const camera = useThree((state) => state.camera) as OrthographicCamera;
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    cameraRef.current = camera;
    camera.userData.canvas = gl.domElement;
    camera.userData.invalidate = invalidate;
    onZoomChange?.(camera.zoom * 2);
    onReady?.();
  }, [camera, gl, invalidate, cameraRef, onZoomChange, onReady]);

  return null;
}
