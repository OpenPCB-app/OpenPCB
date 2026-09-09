import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  PcbCommitLegality,
  DesignerCommand,
  DesignerDispatchResult,
  DesignerPcbAddKeepoutCommand,
  DesignerPcbAddZoneCommand,
  DesignerPcbProjection,
  DesignerPcbUpdateKeepoutCommand,
  DesignerPcbUpdateZoneCommand,
  PcbBoardOutline,
  PcbBoardSettings,
  PcbCopperLayerId,
  PcbDisplayMode,
  PcbLayerId,
  PcbPointMm,
  PcbTraceSegmentMode,
} from "../../../../sdks";
import {
  buildDrcItems,
  type LegalityContext,
} from "../../../../shared/drc/drc-context";
import type { EffectiveKeepout } from "../../../../shared/pcb-areas/copper-zones";
import { createDesignerApi } from "../api";
import { dispatchFailureMessage } from "./dispatch-failure";

/** A dispatch failure with the result attached, so a caller can read a `PCB_COPPER_ILLEGAL` verdict. */
export type DispatchRejectedError = Error & {
  dispatchResult: DesignerDispatchResult & { ok: false };
};

function rejectedCommit(
  op: string,
  result: DesignerDispatchResult & { ok: false },
): DispatchRejectedError {
  const err = new Error(dispatchFailureMessage(op, result)) as DispatchRejectedError;
  err.dispatchResult = result;
  return err;
}
import { fallbackBoardBoundsFromProjection } from "../three-d/primitives/geometry-utils";
import { useDesignerHighlight } from "../useDesignerHighlight";
import { syncLayerPresetFromVisible, usePcbViewStore } from "./pcb-view-store";

const PCB_SESSION_ID = "designer-pcb-session";

/** Stable empty list so keepout consumers keep referential identity when idle. */
const NO_KEEPOUTS: readonly EffectiveKeepout[] = [];

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
  // compatible: callers continue to use viewSide / displayMode but those
  // values now come from the store.
  const viewState = usePcbViewStore((s) => s.viewState);
  const setViewSideStore = usePcbViewStore((s) => s.setViewSide);
  const toggleViewSideStore = usePcbViewStore((s) => s.toggleViewSide);
  const setDisplayModeStore = usePcbViewStore((s) => s.setDisplayMode);
  const cycleDisplayModeStore = usePcbViewStore((s) => s.cycleDisplayMode);
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
    async (widthMm: number, heightMm: number, centerMm?: PcbPointMm) => {
      setSaving(true);
      setError(null);
      try {
        await dispatchCommand({
          type: "pcb_set_board_settings",
          widthMm,
          heightMm,
          ...(centerMm ? { centerMm } : {}),
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

  /** Set the full board outline (any shape) and optionally its cutouts. */
  const updateBoardOutline = useCallback(
    async (outline: PcbBoardOutline, cutouts?: PcbBoardSettings["cutouts"]) => {
      setSaving(true);
      setError(null);
      try {
        await dispatchCommand({
          type: "pcb_set_board_outline",
          outline,
          ...(cutouts !== undefined ? { cutouts } : {}),
        });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to save PCB board outline",
        );
      } finally {
        setSaving(false);
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  /** Shrink-wrap the board outline tightly around all parts/traces. Uses a
   * small fixed edge margin (the default 10mm camera-framing padding is far too
   * generous for a board outline — leaves a huge gap around small layouts). */
  const fitBoardToParts = useCallback(async () => {
    if (!projection) return;
    const FIT_MARGIN_MM = 2;
    const b = fallbackBoardBoundsFromProjection(projection, FIT_MARGIN_MM);
    // Round up to the next 0.1mm so the margin is never shaved below the target.
    const widthMm = Math.max(1, Math.ceil((b.maxX - b.minX) * 10) / 10);
    const heightMm = Math.max(1, Math.ceil((b.maxY - b.minY) * 10) / 10);
    const centerMm: PcbPointMm = {
      x: (b.minX + b.maxX) / 2,
      y: (b.minY + b.maxY) / 2,
    };
    await updateBoardSize(widthMm, heightMm, centerMm);
  }, [projection, updateBoardSize]);

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

  const addTrace = useCallback(
    async (input: {
      layer: PcbCopperLayerId;
      pointsNm: Array<{ x: number; y: number }>;
      widthMm: number;
      netId: string | null;
      netClassId: string;
      segmentMode: PcbTraceSegmentMode;
      legality?: PcbCommitLegality;
    }) => {
      setError(null);
      try {
        const result = await dispatchCommand({
          type: "pcb_add_trace",
          ...input,
        });
        if (!result.ok)
          throw new Error(dispatchFailureMessage("Trace", result));
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

  const cleanupPourTraces = useCallback(async () => {
    setError(null);
    try {
      const result = await dispatchCommand({ type: "pcb_cleanup_pour_traces" });
      if (!result.ok) throw new Error("Cleanup failed");
      await refresh();
      await refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cleanup failed");
      throw err instanceof Error ? err : new Error("Cleanup failed");
    }
  }, [dispatchCommand, refresh, refreshHistory]);

  const addVia = useCallback(
    async (input: {
      centerMm: PcbPointMm;
      netId: string | null;
      netClassId: string;
      diameterMmOverride?: number;
      drillMmOverride?: number;
      legality?: PcbCommitLegality;
    }) => {
      setError(null);
      try {
        const result = await dispatchCommand({
          type: "pcb_add_via",
          ...input,
        });
        if (!result.ok) throw new Error(dispatchFailureMessage("Via", result));
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
      legality?: PcbCommitLegality;
    }) => {
      setError(null);
      try {
        const result = await dispatchCommand({
          type: "pcb_add_trace_via",
          trace: input.trace,
          via: input.via,
          ...(input.legality ? { legality: input.legality } : {}),
        });
        if (!result.ok)
          throw new Error(dispatchFailureMessage("Trace/via", result));
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

  /**
   * Atomic commit of a whole routing session (multi-layer runs + vias) as ONE
   * `pcb_commit_route` — one revision, one undo entry, one refresh.
   */
  const commitRoute = useCallback(
    async (input: {
      traces: Array<{
        layer: PcbCopperLayerId;
        pointsNm: Array<{ x: number; y: number }>;
        widthMm: number;
        netId: string | null;
        netClassId: string;
        segmentMode: PcbTraceSegmentMode;
      }>;
      vias: Array<{
        centerMm: PcbPointMm;
        netId: string | null;
        netClassId: string;
        diameterMmOverride?: number;
        drillMmOverride?: number;
      }>;
      /** Contract 07 §6: `report` while the DRC override is on, else the server refuses. */
      legality?: PcbCommitLegality;
    }) => {
      setError(null);
      try {
        const result = await dispatchCommand({
          type: "pcb_commit_route",
          traces: input.traces,
          vias: input.vias,
          ...(input.legality ? { legality: input.legality } : {}),
        });
        if (!result.ok) throw rejectedCommit("Route", result);
        await refresh();
        await refreshHistory();
        return result.createdEntityId;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Route commit failed");
        throw err instanceof Error ? err : new Error("Route commit failed");
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
    async (
      traceId: string,
      pointsNm: Array<{ x: number; y: number }>,
      legality?: PcbCommitLegality,
    ): Promise<DesignerDispatchResult | null> => {
      setError(null);
      try {
        const result = await dispatchCommand({
          type: "pcb_update_trace_geometry",
          traceId,
          pointsNm,
          ...(legality ? { legality } : {}),
        });
        // A refused reshape (contract 07 §6) is reported through the result,
        // not thrown: the tune tool reads the violations off it.
        // A copper refusal is the tune tool's to show (it reads the result);
        // every other failure surfaces as the workspace error.
        if (!result.ok && result.code !== "PCB_COPPER_ILLEGAL") {
          setError(dispatchFailureMessage("Reshape", result));
        }
        await refresh();
        await refreshHistory();
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Reshape trace failed");
        return null;
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const addFreeHole = useCallback(
    async (centerMm: PcbPointMm, drillMm: number) => {
      setError(null);
      try {
        await dispatchCommand({
          type: "pcb_add_free_hole",
          centerMm,
          drillMm,
        });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Add hole failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  /** Drop a free pad at `centerMm`. v1 ships SMD rect 1.5×1.0 mm by default. */
  const addFreePad = useCallback(
    async (
      centerMm: PcbPointMm,
      options?: {
        padType?: "smd" | "hole" | "std" | "conn";
        shape?: "rect" | "circle" | "oval" | "roundrect";
        widthMm?: number;
        heightMm?: number;
        drillMm?: number;
        layer?: PcbCopperLayerId;
      },
    ) => {
      setError(null);
      try {
        const padType = options?.padType ?? "smd";
        const cmd = {
          type: "pcb_add_free_pad" as const,
          centerMm,
          rotationDeg: 0,
          padType,
          shape: options?.shape ?? "rect",
          widthMm: options?.widthMm ?? 1.5,
          heightMm: options?.heightMm ?? 1.0,
          layer: options?.layer ?? "F.Cu",
          ...(padType === "hole" || padType === "std"
            ? { drillMm: options?.drillMm ?? 0.8 }
            : {}),
        } satisfies DesignerCommand;
        await dispatchCommand(cmd);
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Add pad failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  /** Drop an overlay text label at `positionMm`. */
  const addOverlayText = useCallback(
    async (
      positionMm: PcbPointMm,
      text: string,
      options?: {
        layer?:
          | "F.SilkS"
          | "B.SilkS"
          | "F.Fab"
          | "B.Fab"
          | "F.CrtYd"
          | "B.CrtYd"
          | "Edge.Cuts";
        fontSizeMm?: number;
      },
    ) => {
      setError(null);
      try {
        await dispatchCommand({
          type: "pcb_add_overlay_text",
          layer: options?.layer ?? "F.SilkS",
          positionMm,
          text,
          fontSizeMm: options?.fontSizeMm ?? 1.0,
          rotationDeg: 0,
        });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Add label failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const deleteFreeHole = useCallback(
    async (freeHoleId: string) => {
      setError(null);
      try {
        await dispatchCommand({ type: "pcb_delete_free_hole", freeHoleId });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete hole failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const updateFreeHole = useCallback(
    async (
      freeHoleId: string,
      patch: { drillMm?: number; centerMm?: PcbPointMm },
    ) => {
      setError(null);
      try {
        await dispatchCommand({
          type: "pcb_update_free_hole",
          freeHoleId,
          ...patch,
        });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update hole failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const deleteFreePad = useCallback(
    async (freePadId: string) => {
      setError(null);
      try {
        await dispatchCommand({ type: "pcb_delete_free_pad", freePadId });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete pad failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const updateFreePad = useCallback(
    async (
      freePadId: string,
      patch: {
        centerMm?: PcbPointMm;
        widthMm?: number;
        heightMm?: number;
        shape?: "rect" | "circle" | "oval" | "roundrect";
        layer?: PcbCopperLayerId;
        drillMm?: number | null;
        rotationDeg?: number;
      },
    ) => {
      setError(null);
      try {
        await dispatchCommand({
          type: "pcb_update_free_pad",
          freePadId,
          ...patch,
        });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update pad failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const deleteOverlayText = useCallback(
    async (overlayTextId: string) => {
      setError(null);
      try {
        await dispatchCommand({
          type: "pcb_delete_overlay_text",
          overlayTextId,
        });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete text failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const updateOverlayText = useCallback(
    async (
      overlayTextId: string,
      patch: {
        positionMm?: PcbPointMm;
        text?: string;
        fontSizeMm?: number;
        layer?:
          | "F.SilkS"
          | "B.SilkS"
          | "F.Fab"
          | "B.Fab"
          | "F.CrtYd"
          | "B.CrtYd"
          | "Edge.Cuts";
        rotationDeg?: number;
      },
    ) => {
      setError(null);
      try {
        await dispatchCommand({
          type: "pcb_update_overlay_text",
          overlayTextId,
          ...patch,
        });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update text failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  // Copper zones + keepouts (zone/keepout contract §12.2). A board zone is a
  // persisted zone row too, so the layers-panel fill toggle goes through
  // addZone / updateZone rather than through view state.
  const addZone = useCallback(
    async (input: Omit<DesignerPcbAddZoneCommand, "type">) => {
      setError(null);
      try {
        const result = await dispatchCommand({ type: "pcb_add_zone", ...input });
        await refresh();
        await refreshHistory();
        return result.ok ? result.createdEntityId : null;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Add zone failed");
        return null;
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const updateZone = useCallback(
    async (
      zoneId: string,
      patch: Omit<DesignerPcbUpdateZoneCommand, "type" | "zoneId">,
    ) => {
      setError(null);
      try {
        const result = await dispatchCommand({
          type: "pcb_update_zone",
          zoneId,
          ...patch,
        });
        await refresh();
        await refreshHistory();
        return result.ok;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update zone failed");
        return false;
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const deleteZone = useCallback(
    async (zoneId: string) => {
      setError(null);
      try {
        await dispatchCommand({ type: "pcb_delete_zone", zoneId });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete zone failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const addKeepout = useCallback(
    async (input: Omit<DesignerPcbAddKeepoutCommand, "type">) => {
      setError(null);
      try {
        const result = await dispatchCommand({
          type: "pcb_add_keepout",
          ...input,
        });
        await refresh();
        await refreshHistory();
        return result.ok ? result.createdEntityId : null;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Add keepout failed");
        return null;
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const updateKeepout = useCallback(
    async (
      keepoutId: string,
      patch: Omit<DesignerPcbUpdateKeepoutCommand, "type" | "keepoutId">,
    ) => {
      setError(null);
      try {
        const result = await dispatchCommand({
          type: "pcb_update_keepout",
          keepoutId,
          ...patch,
        });
        await refresh();
        await refreshHistory();
        return result.ok;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update keepout failed");
        return false;
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const deleteKeepout = useCallback(
    async (keepoutId: string) => {
      setError(null);
      try {
        await dispatchCommand({ type: "pcb_delete_keepout", keepoutId });
        await refresh();
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete keepout failed");
      }
    },
    [dispatchCommand, refresh, refreshHistory],
  );

  const runDrc = useCallback(async () => {
    if (!designId) return null;
    return api.runDrc(designId);
  }, [api, designId]);

  const getDrcResult = useCallback(async () => {
    if (!designId) return null;
    return api.getDrcResult(designId);
  }, [api, designId]);

  /**
   * THE one legality context of this projection (live-parity contract 07 §2,
   * §7): every DRC item, the effective zones and keepouts, the board region,
   * the ONE rule resolver, the clearance bound and the broad-phase grid, built
   * O(board) ONCE per projection object and never per pointer move.
   *
   * The memo rests on the projection being an immutable snapshot replaced
   * wholesale on every refresh (§7, Astra run 1 #8) — nothing mutates a
   * projection's rules or copper in place, so object identity IS revision
   * identity. The scene, the route obstacles, the live gate and the smart-via
   * guard all read it, so the canvas cannot disagree with itself.
   */
  const legalityContext = useMemo<LegalityContext | null>(
    () => (projection ? buildDrcItems(projection) : null),
    [projection],
  );

  // The effective keepouts are the context's — one derivation, not a second
  // `collectKeepouts` call beside it (zone/keepout contract §4).
  const effectiveKeepouts: readonly EffectiveKeepout[] =
    legalityContext?.keepouts ?? NO_KEEPOUTS;

  /**
   * Upper bound of ANY copper-to-copper clearance this board can resolve to —
   * the context's own. Sizes the A* grid step and the meander leg floor, both
   * of which are copper-to-copper questions. Legality never reads it.
   */
  const maxClearanceBoundMm = legalityContext?.maxClearanceBoundMm ?? 0;

  /**
   * How far ANY obstacle rect can reach past the item that produced it: the
   * clearance bound OR the hole bound, whichever is larger. Every
   * `buildRouteObstacles` query window must be padded by this — a board with a
   * large `copperToHoleMm` puts an NPTH rect metres outside the clearance
   * bound, and a window sized on `maxClearanceBoundMm` alone drops it while
   * the gate still reports `COPPER_TO_HOLE`.
   */
  const maxObstacleReachMm = Math.max(
    legalityContext?.maxClearanceBoundMm ?? 0,
    legalityContext?.maxHoleBoundMm ?? 0,
  );

  // Nets available to pour into, sorted by name (GND/PWR first for convenience).
  const pcbNets = useMemo<ReadonlyArray<{ id: string; name: string }>>(() => {
    const entries = Object.entries(projection?.netNames ?? {}).map(
      ([id, name]) => ({ id, name }),
    );
    const rank = (n: string): number =>
      /^(gnd|ground|agnd|dgnd|earth|vss|vee)$/i.test(n)
        ? 0
        : /^(v|vcc|vdd|vbat|\+)/i.test(n)
          ? 1
          : 2;
    return entries.sort(
      (a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name),
    );
  }, [projection?.netNames]);

  return {
    projection,
    legalityContext,
    effectiveKeepouts,
    maxClearanceBoundMm,
    maxObstacleReachMm,
    loading,
    saving,
    error,
    runDrc,
    getDrcResult,
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
    addZone,
    updateZone,
    deleteZone,
    addKeepout,
    updateKeepout,
    deleteKeepout,
    cleanupPourTraces,
    nets: pcbNets,
    refresh,
    refreshHistory,
    updateBoardSize,
    updateBoardOutline,
    fitBoardToParts,
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
    commitRoute,
    deleteTrace,
    deleteVia,
    updateTraceGeometry,
    addFreeHole,
    deleteFreeHole,
    updateFreeHole,
    addFreePad,
    deleteFreePad,
    updateFreePad,
    addOverlayText,
    deleteOverlayText,
    updateOverlayText,
  };
}
