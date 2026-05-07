import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DesignerCommand,
  DesignerPcbProjection,
  PcbLayerId,
  PcbPointMm,
} from "../../../../sdks";
import { createDesignerApi } from "../api";
import { useDesignerHighlight } from "../useDesignerHighlight";

const PCB_SESSION_ID = "designer-pcb-session";

export function usePcbWorkspace(params: {
  backendURL?: string | null;
  moduleId: string;
  designId: string | null;
  dispatchCommand: (command: DesignerCommand) => Promise<unknown>;
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
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(
    null,
  );
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

  // Highlight setters are passthroughs to the cross-probe store.
  const hoverNet = hoverNetStore;
  const pinHighlightedNet = pinNetStore;
  const clearHighlight = clearHighlightStore;

  const toggleRatsnestVisible = useCallback(() => {
    setRatsnestVisible((v) => !v);
  }, []);

  return {
    projection,
    loading,
    saving,
    error,
    canUndo,
    canRedo,
    selectedPlacementId,
    setSelectedPlacementId,
    highlightedNetId,
    pinnedHighlight,
    hoverNet,
    pinHighlightedNet,
    clearHighlight,
    ratsnestVisible,
    toggleRatsnestVisible,
    refresh,
    updateBoardSize,
    setActiveLayer,
    undo,
    redo,
    movePlacement,
    rotatePlacement,
  };
}
