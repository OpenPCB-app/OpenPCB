import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DesignerCommand,
  DesignerDispatchResult,
  DesignerPcbProjection,
  PcbCopperLayerId,
  PcbLayerId,
  PcbPointMm,
  PcbTraceSegmentMode,
} from "../../../../sdks";
import { createDesignerApi } from "../api";
import { useDesignerHighlight } from "../useDesignerHighlight";

const PCB_SESSION_ID = "designer-pcb-session";

export function usePcbWorkspace(params: {
  backendURL?: string | null;
  moduleId: string;
  designId: string | null;
  dispatchCommand: (
    command: DesignerCommand,
  ) => Promise<DesignerDispatchResult>;
  notifyExternalRevisionBump?: (revision: number) => void;
}) {
  const {
    backendURL,
    moduleId,
    designId,
    dispatchCommand,
    notifyExternalRevisionBump,
  } = params;
  const api = useMemo(
    () => createDesignerApi({ backendURL, moduleId }),
    [backendURL, moduleId],
  );
  const [projection, setProjection] = useState<DesignerPcbProjection | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // Cross-probe highlight state lives in a designer-wide store so the schematic
  // and PCB views stay in lockstep (hover a pad on PCB → schematic dims; hover
  // a wire on schematic → PCB dims). UI state local to the PCB tab — like the
  // ratsnest visibility toggle — stays here.
  const highlightedNetId = useDesignerHighlight((s) => s.highlightedNetId);
  const pinnedHighlight = useDesignerHighlight((s) => s.pinned);
  const hoverNetStore = useDesignerHighlight((s) => s.hoverNet);
  const pinNetStore = useDesignerHighlight((s) => s.pinNet);
  const clearHighlightStore = useDesignerHighlight((s) => s.clear);
  const [ratsnestVisible, setRatsnestVisible] = useState(true);
  // View side mirrors the board for Top/Bottom copper switches. It is still UI
  // state (not persisted separately); refresh seeds it from the persisted active
  // copper layer so undo/redo and reload keep the same orientation.
  const [viewSide, setViewSideState] = useState<"top" | "bottom">("top");

  const refresh = useCallback(async () => {
    if (!designId) {
      setProjection(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await api.getPcbProjection(designId);
      setProjection(next);
      setViewSideState(next.board.activeLayer === "B.Cu" ? "bottom" : "top");
      if (next) notifyExternalRevisionBump?.(next.revision);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load PCB projection",
      );
    } finally {
      setLoading(false);
    }
  }, [api, designId, notifyExternalRevisionBump]);

  const refreshHistory = useCallback(async () => {
    if (!designId) {
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    try {
      const history = await api.getHistory(designId, PCB_SESSION_ID);
      setCanUndo(history.canUndo);
      setCanRedo(history.canRedo);
    } catch {
      setCanUndo(false);
      setCanRedo(false);
    }
  }, [api, designId]);

  useEffect(() => {
    void refresh();
    void refreshHistory();
  }, [refresh, refreshHistory]);

  const updateBoardSize = useCallback(
    async (widthMm: number, heightMm: number) => {
      setSaving(true);
      setError(null);
      try {
        await dispatchCommand({
          type: "pcb_set_board_settings",
          widthMm,
          heightMm,
        });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to save PCB board settings",
        );
      } finally {
        setSaving(false);
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const undo = useCallback(async () => {
    if (!designId) return;
    setError(null);
    try {
      await api.undo(designId, PCB_SESSION_ID);
      await refresh();
      await refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Undo failed");
    }
  }, [api, designId, refresh, refreshHistory]);

  const redo = useCallback(async () => {
    if (!designId) return;
    setError(null);
    try {
      await api.redo(designId, PCB_SESSION_ID);
      await refresh();
      await refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Redo failed");
    }
  }, [api, designId, refresh, refreshHistory]);

  const movePlacement = useCallback(
    async (placementId: string, positionMm: PcbPointMm) => {
      setError(null);
      try {
        await dispatchCommand({
          type: "pcb_move_placement",
          placementId,
          positionMm,
        });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Move failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const movePlacements = useCallback(
    async (
      updates: ReadonlyArray<{ placementId: string; positionMm: PcbPointMm }>,
    ) => {
      if (updates.length === 0) return;
      setError(null);
      try {
        await dispatchCommand({ type: "pcb_move_placements", updates });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Move failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const rotatePlacement = useCallback(
    async (placementId: string, rotationDeg: 0 | 90 | 180 | 270) => {
      setError(null);
      try {
        await dispatchCommand({
          type: "pcb_rotate_placement",
          placementId,
          rotationDeg,
        });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Rotate failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const flipPlacement = useCallback(
    async (placementId: string) => {
      setError(null);
      try {
        await dispatchCommand({ type: "pcb_flip_placement", placementId });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Flip failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const flipPlacements = useCallback(
    async (placementIds: ReadonlyArray<string>) => {
      if (placementIds.length === 0) return;
      setError(null);
      try {
        await dispatchCommand({
          type: "pcb_flip_placements",
          placementIds: [...placementIds],
        });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Flip failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const setActiveLayer = useCallback(
    async (layer: PcbLayerId) => {
      setError(null);
      try {
        await dispatchCommand({
          type: "pcb_set_active_layer",
          layer,
        });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Set active layer failed",
        );
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const setVisibleLayers = useCallback(
    async (visibleLayers: ReadonlyArray<PcbLayerId>) => {
      setError(null);
      try {
        await dispatchCommand({
          type: "pcb_set_visible_layers",
          visibleLayers: [...visibleLayers],
        });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Set visible layers failed",
        );
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  // Highlight setters are passthroughs to the cross-probe store.
  const hoverNet = hoverNetStore;
  const pinHighlightedNet = pinNetStore;
  const clearHighlight = clearHighlightStore;

  const toggleRatsnestVisible = useCallback(() => {
    setRatsnestVisible((v) => !v);
  }, []);

  const setViewSide = useCallback((side: "top" | "bottom") => {
    setViewSideState(side);
  }, []);

  const addTrace = useCallback(
    async (input: {
      layer: PcbCopperLayerId;
      pointsNm: Array<{ x: number; y: number }>;
      widthMm: number;
      netId: string | null;
      netClassId: string;
      segmentMode: PcbTraceSegmentMode;
    }) => {
      setError(null);
      try {
        const result = await dispatchCommand({
          type: "pcb_add_trace",
          ...input,
        });
        if (!result.ok) throw new Error("Add trace failed");
        await refresh();
        await refreshHistory();
        return result.createdEntityId;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Add trace failed");
        throw err instanceof Error ? err : new Error("Add trace failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const addVia = useCallback(
    async (input: {
      centerMm: PcbPointMm;
      netId: string | null;
      netClassId: string;
      diameterMmOverride?: number;
      drillMmOverride?: number;
    }) => {
      setError(null);
      try {
        const result = await dispatchCommand({
          type: "pcb_add_via",
          ...input,
        });
        if (!result.ok) throw new Error("Add via failed");
        await refresh();
        await refreshHistory();
        return result.createdEntityId;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Add via failed");
        throw err instanceof Error ? err : new Error("Add via failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const addTraceVia = useCallback(
    async (input: {
      trace: {
        layer: PcbCopperLayerId;
        pointsNm: Array<{ x: number; y: number }>;
        widthMm: number;
        netId: string | null;
        netClassId: string;
        segmentMode: PcbTraceSegmentMode;
      };
      via: {
        centerMm: PcbPointMm;
        netId: string | null;
        netClassId: string;
        diameterMmOverride?: number;
        drillMmOverride?: number;
      };
    }) => {
      setError(null);
      try {
        const result = await dispatchCommand({
          type: "pcb_add_trace_via",
          trace: input.trace,
          via: input.via,
        });
        if (!result.ok) throw new Error("Add trace/via failed");
        await refresh();
        await refreshHistory();
        return result.createdEntityId;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Add trace/via failed");
        throw err instanceof Error ? err : new Error("Add trace/via failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const deleteTrace = useCallback(
    async (traceId: string) => {
      setError(null);
      try {
        await dispatchCommand({ type: "pcb_delete_trace", traceId });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete trace failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const deleteVia = useCallback(
    async (viaId: string) => {
      setError(null);
      try {
        await dispatchCommand({ type: "pcb_delete_via", viaId });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete via failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const updateTraceGeometry = useCallback(
    async (traceId: string, pointsNm: Array<{ x: number; y: number }>) => {
      setError(null);
      try {
        await dispatchCommand({
          type: "pcb_update_trace_geometry",
          traceId,
          pointsNm,
        });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Reshape trace failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  return {
    projection,
    loading,
    saving,
    error,
    canUndo,
    canRedo,
    highlightedNetId,
    pinnedHighlight,
    hoverNet,
    pinHighlightedNet,
    clearHighlight,
    ratsnestVisible,
    toggleRatsnestVisible,
    viewSide,
    setViewSide,
    refresh,
    updateBoardSize,
    setActiveLayer,
    setVisibleLayers,
    undo,
    redo,
    movePlacement,
    movePlacements,
    rotatePlacement,
    flipPlacement,
    flipPlacements,
    addTrace,
    addTraceVia,
    addVia,
    deleteTrace,
    deleteVia,
    updateTraceGeometry,
  };
}
