import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DesignerCommand,
  DesignerPcbProjection,
  PcbPointMm,
} from "../../../../sdks";
import { createDesignerApi } from "../api";

const PCB_SESSION_ID = "designer-pcb-session";

export function usePcbWorkspace(params: {
  backendURL?: string | null;
  moduleId: string;
  designId: string | null;
  dispatchCommand: (command: DesignerCommand) => Promise<unknown>;
}) {
  const { backendURL, moduleId, designId, dispatchCommand } = params;
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

  const refresh = useCallback(async () => {
    if (!designId) {
      setProjection(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setProjection(await api.getPcbProjection(designId));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load PCB projection",
      );
    } finally {
      setLoading(false);
    }
  }, [api, designId]);

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

  return {
    projection,
    loading,
    saving,
    error,
    canUndo,
    canRedo,
    selectedPlacementId,
    setSelectedPlacementId,
    refresh,
    updateBoardSize,
    undo,
    redo,
    movePlacement,
    rotatePlacement,
  };
}
