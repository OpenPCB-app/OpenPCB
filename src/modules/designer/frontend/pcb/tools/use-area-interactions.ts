/**
 * Canvas interactions for polygon zones and keepouts (zone/keepout contract
 * §12.3): edge-proximity selection, marquee, vertex drag / insert / delete and
 * Delete-key removal. Kept out of `PcbCanvas.tsx` per `designer/AGENTS.md`
 * ("split interactions into hooks rather than growing the canvas").
 *
 * Everything here is a *plain* handler the canvas calls from its own pointer /
 * keydown paths — the hook owns only the live drag session, which the scene
 * reads back as `areaDragOverride` while a vertex is being moved.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type {
  PcbCopperLayerId,
  PcbKeepout,
  PcbPointMm,
  PcbZone,
} from "../../../../../sdks";
import type { BoundsMm } from "../../../../../shared/rendering/types";
import type { ContextMenuGroup } from "../../../../../shared/frontend/context-menu";
import { AREA_HIT_MM, hitKeepout, hitZone, zoneRings } from "../pcb-hit";
import {
  deleteRingVertex,
  hitRingEdge,
  hitRingVertex,
  insertRingVertex,
  moveRingVertex,
} from "../pcb-ring-edit";
import { ringContainedInRect, ringIntersectsRect } from "../pcb-rect-hit";
import {
  toggleKeepout,
  toggleZone,
  type PcbSelection,
} from "../pcb-selection";

/** Grab radius for an area vertex/edge grip, in mm. Matches the board handles. */
const AREA_VERTEX_TOLERANCE_MM = 1.0;

export interface AreaVertexDragSession {
  kind: "zone" | "keepout";
  id: string;
  /** Ring being dragged: 0 = outer / the keepout ring, i+1 = cutout i (§11). */
  ringIndex: number;
  vIndex: number;
  initialPoints: PcbPointMm[];
  current: PcbPointMm[];
  moved: boolean;
}

/** The one polygon area a vertex-editing gesture can apply to. */
export interface SelectedArea {
  kind: "zone" | "keepout";
  id: string;
  /** Every editable ring, in `ringIndex` order: outer first, then cutouts. */
  rings: PcbPointMm[][];
  /** The outer ring — `rings[0]`, kept for the selection outline. */
  pointsMm: PcbPointMm[];
  locked: boolean;
}

interface AreaInteractionsWorkspace {
  updateZone(
    zoneId: string,
    patch: {
      region?: {
        kind: "polygon";
        pointsMm: PcbPointMm[];
        holesMm?: PcbPointMm[][];
      };
    },
  ): Promise<boolean>;
  updateKeepout(
    keepoutId: string,
    patch: { pointsMm?: PcbPointMm[] },
  ): Promise<boolean>;
  deleteZone(zoneId: string): Promise<void>;
  deleteKeepout(keepoutId: string): Promise<void>;
}

export interface AreaInteractionsApi {
  /** Live vertex-drag geometry the scene renders instead of the persisted ring. */
  areaDragOverride: AreaVertexDragSession | null;
  /** Every grip to draw for the selection, with the live drag already applied. */
  vertexHandlePoints: PcbPointMm[];
  /** The single selected polygon area, or null (0 or >1 selected). */
  selectedArea: SelectedArea | null;
  /** Grab a vertex grip. True when the gesture was consumed. */
  tryGrabVertex(cursorMm: PcbPointMm): boolean;
  /** Edge-proximity selection. Returns the next selection, or null on a miss. */
  trySelect(
    cursorMm: PcbPointMm,
    shift: boolean,
    current: PcbSelection,
  ): PcbSelection | null;
  /** Live-update the drag in flight. True when a drag was in flight. */
  handlePointerMove(cursorMm: PcbPointMm): boolean;
  /** Commit the drag in flight. True when a drag was in flight. */
  handlePointerUp(): boolean;
  /** Vertex / edge ops for the selected polygon area, or null. */
  contextMenuGroup(cursorMm: PcbPointMm): ContextMenuGroup | null;
  /** Marquee additions for the given rect + mode. */
  marqueeHits(
    rect: BoundsMm,
    mode: "window" | "crossing",
    base: PcbSelection,
  ): { zoneIds: Set<string>; keepoutIds: Set<string> };
  /** Delete every selected unlocked polygon zone / keepout. Board zones refuse. */
  deleteSelected(selection: PcbSelection): Promise<void>;
}

function polygonPoints(zone: PcbZone): PcbPointMm[] | null {
  return zone.region.kind === "polygon" ? zone.region.pointsMm : null;
}

/**
 * The zone's region with ring `ringIndex` replaced (or, for a cutout, removed
 * when `ring` is null). Ring 0 is the outer ring, which can never be removed.
 */
function regionWithRing(
  zone: PcbZone,
  ringIndex: number,
  ring: PcbPointMm[] | null,
): { kind: "polygon"; pointsMm: PcbPointMm[]; holesMm?: PcbPointMm[][] } | null {
  if (zone.region.kind !== "polygon") return null;
  const holes = (zone.region.holesMm ?? []).map((h) => [...h]);
  let pointsMm = [...zone.region.pointsMm];
  if (ringIndex === 0) {
    if (!ring) return null;
    pointsMm = ring;
  } else {
    const i = ringIndex - 1;
    if (i >= holes.length) return null;
    if (ring) holes[i] = ring;
    else holes.splice(i, 1);
  }
  return {
    kind: "polygon",
    pointsMm,
    ...(holes.length === 0 ? {} : { holesMm: holes }),
  };
}

/** Nearest grip across every ring of the selected area, or null. */
function hitAreaVertex(
  area: SelectedArea,
  cursorMm: PcbPointMm,
): { ringIndex: number; vIndex: number } | null {
  for (let ringIndex = 0; ringIndex < area.rings.length; ringIndex += 1) {
    const vIndex = hitRingVertex(
      area.rings[ringIndex]!,
      cursorMm,
      AREA_VERTEX_TOLERANCE_MM,
    );
    if (vIndex !== null) return { ringIndex, vIndex };
  }
  return null;
}

/** Nearest edge across every ring of the selected area, or null. */
function hitAreaEdge(
  area: SelectedArea,
  cursorMm: PcbPointMm,
): { ringIndex: number; edgeIndex: number; pointMm: PcbPointMm } | null {
  for (let ringIndex = 0; ringIndex < area.rings.length; ringIndex += 1) {
    const edge = hitRingEdge(
      area.rings[ringIndex]!,
      cursorMm,
      AREA_VERTEX_TOLERANCE_MM,
    );
    if (edge) return { ringIndex, ...edge };
  }
  return null;
}

export function useAreaInteractions({
  zones,
  keepouts,
  selection,
  activeCopperLayer,
  layerAllowed,
  snapPoint,
  workspace,
}: {
  zones: readonly PcbZone[];
  keepouts: readonly PcbKeepout[];
  selection: PcbSelection;
  activeCopperLayer: PcbCopperLayerId;
  /** Visible-copper-layer gate: hidden layers are never hit or marquee-selected. */
  layerAllowed: (layer: PcbCopperLayerId) => boolean;
  snapPoint: (pointMm: PcbPointMm) => PcbPointMm;
  workspace: AreaInteractionsWorkspace;
}): AreaInteractionsApi {
  const [drag, setDrag] = useState<AreaVertexDragSession | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  // `commitRing` rebuilds a zone's whole region (outer + cutouts), so it needs
  // the current row without restaging on every projection refresh.
  const zonesRef = useRef(zones);
  zonesRef.current = zones;

  const selectedArea = useMemo<SelectedArea | null>(() => {
    const zoneIds = [...(selection.zoneIds ?? [])];
    const keepoutIds = [...(selection.keepoutIds ?? [])];
    if (zoneIds.length + keepoutIds.length !== 1) return null;
    if (zoneIds.length === 1) {
      const zone = zones.find((z) => z.id === zoneIds[0]);
      const points = zone ? polygonPoints(zone) : null;
      // A zone on a hidden layer draws nothing, so it must expose no grips
      // either (contract §12.3) — the selection outline applies the same gate.
      if (!zone || !points || !layerAllowed(zone.layer)) return null;
      return {
        kind: "zone",
        id: zone.id,
        rings: zoneRings(zone).map((r) => [...r]),
        pointsMm: points,
        locked: zone.lockedAt !== null,
      };
    }
    const keepout = keepouts.find((k) => k.id === keepoutIds[0]);
    if (!keepout || !keepout.layers.some(layerAllowed)) return null;
    return {
      kind: "keepout",
      id: keepout.id,
      rings: [[...keepout.pointsMm]],
      pointsMm: keepout.pointsMm,
      locked: keepout.lockedAt !== null,
    };
  }, [keepouts, layerAllowed, selection.keepoutIds, selection.zoneIds, zones]);
  const selectedAreaRef = useRef(selectedArea);
  selectedAreaRef.current = selectedArea;

  const tryGrabVertex = useCallback(
    (cursorMm: PcbPointMm): boolean => {
      const area = selectedAreaRef.current;
      if (!area || area.locked) return false;
      const grab = hitAreaVertex(area, cursorMm);
      if (!grab) return false;
      const ring = area.rings[grab.ringIndex]!.map((p) => ({ x: p.x, y: p.y }));
      setDrag({
        kind: area.kind,
        id: area.id,
        ringIndex: grab.ringIndex,
        vIndex: grab.vIndex,
        initialPoints: ring,
        current: ring.map((p) => ({ x: p.x, y: p.y })),
        moved: false,
      });
      return true;
    },
    [],
  );

  const trySelect = useCallback(
    (
      cursorMm: PcbPointMm,
      shift: boolean,
      current: PcbSelection,
    ): PcbSelection | null => {
      const opts = {
        toleranceMm: AREA_HIT_MM,
        layerAllowed,
        activeLayer: activeCopperLayer,
      };
      const zoneHit = hitZone(zones, cursorMm, opts);
      if (zoneHit) {
        const zone = zoneHit.zone;
        return shift
          ? toggleZone(current, zone.id)
          : {
              placementIds: new Set<string>(),
              traceIds: new Set<string>(),
              viaIds: new Set<string>(),
              freeHoleIds: new Set<string>(),
              freePadIds: new Set<string>(),
              overlayTextIds: new Set<string>(),
              zoneIds: new Set([zone.id]),
              keepoutIds: new Set<string>(),
            };
      }
      const keepout = hitKeepout(keepouts, cursorMm, opts);
      if (keepout) {
        return shift
          ? toggleKeepout(current, keepout.id)
          : {
              placementIds: new Set<string>(),
              traceIds: new Set<string>(),
              viaIds: new Set<string>(),
              freeHoleIds: new Set<string>(),
              freePadIds: new Set<string>(),
              overlayTextIds: new Set<string>(),
              zoneIds: new Set<string>(),
              keepoutIds: new Set([keepout.id]),
            };
      }
      return null;
    },
    [activeCopperLayer, keepouts, layerAllowed, zones],
  );

  const handlePointerMove = useCallback(
    (cursorMm: PcbPointMm): boolean => {
      if (!dragRef.current) return false;
      const snapped = snapPoint(cursorMm);
      setDrag((prev) =>
        prev
          ? {
              ...prev,
              current: moveRingVertex(prev.initialPoints, prev.vIndex, snapped),
              moved: true,
            }
          : prev,
      );
      return true;
    },
    [snapPoint],
  );

  const commitRing = useCallback(
    (
      kind: "zone" | "keepout",
      id: string,
      ringIndex: number,
      pointsMm: PcbPointMm[] | null,
    ): void => {
      if (kind === "keepout") {
        if (!pointsMm) return;
        void workspace.updateKeepout(id, { pointsMm }).catch(() => undefined);
        return;
      }
      const zone = zonesRef.current.find((z) => z.id === id);
      const region = zone ? regionWithRing(zone, ringIndex, pointsMm) : null;
      if (!region) return;
      void workspace.updateZone(id, { region }).catch(() => undefined);
    },
    [workspace],
  );

  const handlePointerUp = useCallback((): boolean => {
    const session = dragRef.current;
    if (!session) return false;
    setDrag(null);
    if (session.moved) {
      commitRing(session.kind, session.id, session.ringIndex, session.current);
    }
    return true;
  }, [commitRing]);

  const contextMenuGroup = useCallback(
    (cursorMm: PcbPointMm): ContextMenuGroup | null => {
      const area = selectedAreaRef.current;
      if (!area || area.locked) return null;
      const grab = hitAreaVertex(area, cursorMm);
      if (grab) {
        const ring = area.rings[grab.ringIndex]!;
        const next = deleteRingVertex(ring, grab.vIndex);
        // A cutout below three vertices is not a repairable ring — deleting
        // that vertex removes the whole cutout (copper-pour contract §11).
        const dropsCutout = next === null && grab.ringIndex > 0;
        return {
          id: "area-vertex",
          items: [
            {
              kind: "action",
              id: "delete-area-vertex",
              label: dropsCutout ? "Delete cutout" : "Delete vertex",
              disabled: next === null && !dropsCutout,
              onSelect: () => {
                if (next || dropsCutout) {
                  commitRing(area.kind, area.id, grab.ringIndex, next);
                }
              },
            },
          ],
        };
      }
      const edge = hitAreaEdge(area, cursorMm);
      if (!edge) return null;
      return {
        id: "area-edge",
        items: [
          {
            kind: "action",
            id: "insert-area-vertex",
            label: "Insert vertex here",
            onSelect: () =>
              commitRing(
                area.kind,
                area.id,
                edge.ringIndex,
                insertRingVertex(
                  area.rings[edge.ringIndex]!,
                  edge.edgeIndex,
                  snapPoint(edge.pointMm),
                ),
              ),
          },
        ],
      };
    },
    [commitRing, snapPoint],
  );

  const marqueeHits = useCallback(
    (rect: BoundsMm, mode: "window" | "crossing", base: PcbSelection) => {
      const hit = mode === "window" ? ringContainedInRect : ringIntersectsRect;
      const zoneIds = new Set(base.zoneIds ?? []);
      const keepoutIds = new Set(base.keepoutIds ?? []);
      for (const zone of zones) {
        const points = polygonPoints(zone);
        if (!points) continue;
        if (!layerAllowed(zone.layer)) continue;
        if (hit(points, rect)) zoneIds.add(zone.id);
      }
      for (const keepout of keepouts) {
        if (!keepout.layers.some((l) => layerAllowed(l))) continue;
        if (hit(keepout.pointsMm, rect)) keepoutIds.add(keepout.id);
      }
      return { zoneIds, keepoutIds };
    },
    [keepouts, layerAllowed, zones],
  );

  const deleteSelected = useCallback(
    async (sel: PcbSelection): Promise<void> => {
      const tasks: Array<Promise<unknown>> = [];
      for (const id of sel.zoneIds ?? []) {
        const zone = zones.find((z) => z.id === id);
        // Board zones are lifecycle-controlled by the layers panel, never by
        // Delete (contract §12.3); a locked row rejects the command anyway.
        if (!zone || zone.region.kind !== "polygon") continue;
        if (zone.lockedAt !== null || !layerAllowed(zone.layer)) continue;
        tasks.push(workspace.deleteZone(id));
      }
      for (const id of sel.keepoutIds ?? []) {
        const keepout = keepouts.find((k) => k.id === id);
        if (!keepout || keepout.lockedAt !== null) continue;
        // Invisible objects are never deleted through the canvas (§12.3).
        if (!keepout.layers.some(layerAllowed)) continue;
        tasks.push(workspace.deleteKeepout(id));
      }
      await Promise.allSettled(tasks);
    },
    [keepouts, layerAllowed, workspace, zones],
  );

  // Grips for every ring, with the ring being dragged shown at its live
  // position — a drag on a cutout must not blank the outer ring's grips.
  const vertexHandlePoints = useMemo<PcbPointMm[]>(() => {
    if (!selectedArea || selectedArea.locked) return [];
    return selectedArea.rings.flatMap((ring, i) =>
      drag && drag.id === selectedArea.id && drag.ringIndex === i
        ? drag.current
        : ring,
    );
  }, [drag, selectedArea]);

  return useMemo(
    () => ({
      areaDragOverride: drag,
      vertexHandlePoints,
      selectedArea,
      tryGrabVertex,
      trySelect,
      handlePointerMove,
      handlePointerUp,
      contextMenuGroup,
      marqueeHits,
      deleteSelected,
    }),
    [
      contextMenuGroup,
      deleteSelected,
      drag,
      handlePointerMove,
      handlePointerUp,
      marqueeHits,
      selectedArea,
      trySelect,
      tryGrabVertex,
      vertexHandlePoints,
    ],
  );
}
