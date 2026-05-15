import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DesignerCommand,
  DesignerDispatchResult,
  DesignerPcbProjection,
  PcbCopperLayerId,
  PcbDisplayMode,
  PcbLayerId,
  PcbPointMm,
  PcbTraceSegmentMode,
} from "../../../../sdks";
import { createDesignerApi } from "../api";
import { useDesignerHighlight } from "../useDesignerHighlight";
import { syncLayerPresetFromVisible, usePcbViewStore } from "./pcb-view-store";

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
  // a wire on schematic → PCB dims).
  const highlightedNetId = useDesignerHighlight((s) => s.highlightedNetId);
  const pinnedHighlight = useDesignerHighlight((s) => s.pinned);
  const hoverNetStore = useDesignerHighlight((s) => s.hoverNet);
  const pinNetStore = useDesignerHighlight((s) => s.pinNet);
  const clearHighlightStore = useDesignerHighlight((s) => s.clear);

  // Unified PCB view state lives in pcb-view-store (Zustand). It's hydrated
  // from `board_settings.viewState` on every projection load and persists
  // changes through a debounced `pcb_set_view_state` command, replacing the
  // earlier per-design localStorage hooks. The hook surface stays
  // compatible: callers continue to use viewSide / displayMode /
  // copperFillLayers but those values now come from the store.
  const viewState = usePcbViewStore((s) => s.viewState);
  const setViewSideStore = usePcbViewStore((s) => s.setViewSide);
  const toggleViewSideStore = usePcbViewStore((s) => s.toggleViewSide);
  const setDisplayModeStore = usePcbViewStore((s) => s.setDisplayMode);
  const cycleDisplayModeStore = usePcbViewStore((s) => s.cycleDisplayMode);
  const setCopperFillLayersStore = usePcbViewStore(
    (s) => s.setCopperFillLayers,
  );
  const toggleCopperFillLayerStore = usePcbViewStore(
    (s) => s.toggleCopperFillLayer,
  );
  const setRatsnestVisibleStore = usePcbViewStore((s) => s.setRatsnestVisible);
  const toggleRatsnestVisibleStore = usePcbViewStore(
    (s) => s.toggleRatsnestVisible,
  );
  const hydrateView = usePcbViewStore((s) => s.hydrateFromProjection);
  const setStoreDispatcher = usePcbViewStore((s) => s.setDispatcher);
  const flushView = usePcbViewStore((s) => s.flush);

  // Wire the command dispatcher exactly once per designer mount. The store
  // closes over it so debounced flushes work regardless of which component
  // is mounted at the time.
  useEffect(() => {
    setStoreDispatcher(dispatchCommand);
    return () => setStoreDispatcher(null);
  }, [dispatchCommand, setStoreDispatcher]);

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
      if (next) {
        notifyExternalRevisionBump?.(next.revision);
        // Hydrate the view store from the fresh projection. The store
        // diffs against current state to avoid clobbering unflushed local
        // edits when a remote change arrives mid-debounce.
        hydrateView({
          designId,
          viewState: next.board.viewState,
          activeLayer: next.board.activeLayer,
          visibleLayers: next.board.visibleLayers,
        });
        syncLayerPresetFromVisible();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load PCB projection",
      );
    } finally {
      setLoading(false);
    }
  }, [api, designId, hydrateView, notifyExternalRevisionBump]);

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

  // Flush any in-flight view-state changes when the design switches or the
  // tab unmounts. Prevents losing the last slider tweak.
  useEffect(() => {
    return () => {
      void flushView();
    };
  }, [designId, flushView]);

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

  const deletePlacement = useCallback(
    async (placementId: string) => {
      setError(null);
      try {
        await dispatchCommand({ type: "pcb_delete_placement", placementId });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Delete placement failed",
        );
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

  // Store-backed setters. These mutate local state immediately and schedule
  // a debounced backend write. Refresh isn't called — the view-state
  // command is non-undoable and the projection's revision bump triggers a
  // re-fetch on the next regular refresh cycle. The optimistic store value
  // remains visible meanwhile.
  const setRatsnestVisible = useCallback(
    (visible: boolean) => setRatsnestVisibleStore(visible),
    [setRatsnestVisibleStore],
  );
  const toggleRatsnestVisible = useCallback(
    () => toggleRatsnestVisibleStore(),
    [toggleRatsnestVisibleStore],
  );

  const setViewSide = useCallback(
    (side: "top" | "bottom") => setViewSideStore(side),
    [setViewSideStore],
  );
  const toggleViewSide = useCallback(
    () => toggleViewSideStore(),
    [toggleViewSideStore],
  );

  const setDisplayMode = useCallback(
    (mode: PcbDisplayMode) => setDisplayModeStore(mode),
    [setDisplayModeStore],
  );
  const cycleDisplayMode = useCallback(
    () => cycleDisplayModeStore(),
    [cycleDisplayModeStore],
  );

  const setCopperFillLayers = useCallback(
    (layers: ReadonlyArray<PcbCopperLayerId>) =>
      setCopperFillLayersStore(layers),
    [setCopperFillLayersStore],
  );

  const toggleCopperFillLayer = useCallback(
    (layer: PcbCopperLayerId) => toggleCopperFillLayerStore(layer),
    [toggleCopperFillLayerStore],
  );

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
    ratsnestVisible: viewState.ratsnestVisible,
    setRatsnestVisible,
    toggleRatsnestVisible,
    viewSide: viewState.viewSide,
    setViewSide,
    toggleViewSide,
    displayMode: viewState.displayMode,
    setDisplayMode,
    cycleDisplayMode,
    copperFillLayers: viewState.copperFillLayers,
    setCopperFillLayers,
    toggleCopperFillLayer,
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
    deletePlacement,
    addTrace,
    addTraceVia,
    addVia,
    deleteTrace,
    deleteVia,
    updateTraceGeometry,
  };
}
