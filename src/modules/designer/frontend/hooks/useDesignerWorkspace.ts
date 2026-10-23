import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DesignerCommand,
  DesignerDesignSummary,
  DesignerDispatchResult,
  DesignerLabel,
  DesignerPin,
  DesignerPlacedPart,
  DesignerSchematicProjection,
  DesignerWire,
  LibraryComponent,
  LibraryComponentPlacementDetail,
  LibraryTagStat,
} from "../../../../sdks";
import { confirmDialog } from "../../../../shared/frontend/ui/dialog-host-store";
import { createDesignerApi } from "../api";
import type { DesignerView } from "../types";
import {
  getDesignerCommandCoordinator,
  commandSession,
  NetMergeDeclinedError,
  SCHEMATIC_SESSION,
  type DesignerAction,
  type NetMergeRefusal,
} from "../lib/command-coordinator";
import type { CommandQueueSnapshot } from "../../../../shared/frontend/commands/revision-command-queue";
import {
  DESIGNER_BATCH_MAX_COMMANDS,
  type DesignerBatchableCommand,
} from "../../../../sdks/designer";

const DESIGNER_SESSION_ID = SCHEMATIC_SESSION;

export interface DesignerWorkspaceState {
  commandScope: string;
  commandQueue: CommandQueueSnapshot<DesignerAction> | null;
  loadingDesigns: boolean;
  creatingDesign: boolean;
  loadingProjection: boolean;
  loadingHistory: boolean;
  searchingComponents: boolean;
  error: string | null;
  designs: DesignerDesignSummary[];
  selectedDesignId: string | null;
  projection: DesignerSchematicProjection | null;
  activeView: DesignerView;
  query: string;
  components: LibraryComponent[];
  selectedPartId: string | null;
  selectedPartIds: Set<string>;
  selectedPinId: string | null;
  selectedLabelId: string | null;
  selectedWireId: string | null;
  wireSourcePinId: string | null;
  labelDraftText: string;
  draggingComponentId: string | null;
  dragPlacementLoading: boolean;
  dragPlacementDetail: LibraryComponentPlacementDetail | null;
  dragGhostNm: { x: number; y: number } | null;
  canUndo: boolean;
  canRedo: boolean;
  undoDepth: number;
  redoDepth: number;
}

export interface DesignerWorkspaceActions {
  setError(message: string | null): void;
  refreshDesigns(): Promise<void>;
  createDesign(name?: string): Promise<DesignerDesignSummary | null>;
  renameDesign(designId: string, name: string): Promise<void>;
  selectDesign(designId: string | null): void;
  refreshProjection(): Promise<void>;
  refreshHistory(): Promise<void>;
  setActiveView(view: DesignerView): void;
  setQuery(value: string): void;
  setLabelDraftText(value: string): void;
  searchComponents(): Promise<void>;
  searchComponentsByQuery(
    query: string,
    tags?: readonly string[],
  ): Promise<LibraryComponent[]>;
  fetchAvailableTags(): Promise<LibraryTagStat[]>;
  resolvePlacement(
    componentId: string,
  ): Promise<LibraryComponentPlacementDetail>;
  beginDragComponent(componentId: string): Promise<void>;
  setDragGhostNm(point: { x: number; y: number } | null): void;
  clearDragState(): void;
  setSelectedPartId(partId: string | null): void;
  setSelectedPartIds(partIds: Set<string>): void;
  setSelectedPinId(pinId: string | null): void;
  setSelectedLabelId(labelId: string | null): void;
  setSelectedWireId(wireId: string | null): void;
  setWireSourcePinId(pinId: string | null): void;
  dispatchCommand(command: DesignerCommand): Promise<DesignerDispatchResult>;
  /** One atomic command, one revision and one undo entry. */
  dispatchCommandsBatch(commands: DesignerCommand[]): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  notifyExternalRevisionBump(designId: string, revision: number): void;
  runHistory(
    designId: string,
    sessionId: string,
    kind: "undo" | "redo",
  ): Promise<void>;
  discardRetainedCommands(): Promise<void>;
  reapplyRetainedCommand(id: string): Promise<void>;
}

export interface DesignerWorkspaceDerived {
  selectedPart: DesignerPlacedPart | null;
  selectedParts: DesignerPlacedPart[];
  selectedPin: DesignerPin | null;
  selectedLabel: DesignerLabel | null;
  selectedWire: DesignerWire | null;
  wireSourcePin: DesignerPin | null;
}

function netMergeDescription(nets: NetMergeRefusal["nets"]): string {
  const list = nets
    .map(
      (net) =>
        `${net.name ?? "unnamed net"} (${net.pinCount} pin${net.pinCount === 1 ? "" : "s"})`,
    )
    .join(", ");
  return `This change merges these nets into one: ${list}.`;
}

export function useDesignerWorkspace(params: {
  backendURL?: string | null;
  moduleId: string;
  initialDesignId?: string;
  cloudHeaders?: () => {
    "x-cloud-bearer"?: string;
    "x-cloud-api-url"?: string;
  };
  onNotify?: (
    message: string,
    variant?: "info" | "success" | "warning" | "error",
  ) => void;
}): {
  state: DesignerWorkspaceState;
  actions: DesignerWorkspaceActions;
  derived: DesignerWorkspaceDerived;
} {
  const api = useMemo(
    () =>
      createDesignerApi({
        backendURL: params.backendURL,
        moduleId: params.moduleId,
        cloudHeaders: params.cloudHeaders,
      }),
    [params.backendURL, params.moduleId, params.cloudHeaders],
  );

  const notify = params.onNotify;

  const coordinator = useMemo(
    () =>
      getDesignerCommandCoordinator(
        api,
        params.backendURL
          ? `${params.backendURL}/api/modules/${params.moduleId}`
          : undefined,
      ),
    [params.backendURL, params.moduleId],
  );
  coordinator.setApi(api);
  coordinator.confirmNetMerge = (refusal) =>
    confirmDialog({
      title: "Merge nets?",
      description: netMergeDescription(refusal.nets),
      confirmLabel: "Merge nets",
    });
  const [, setCommandVersion] = useState(0);
  useEffect(
    () =>
      coordinator.queue.subscribe(() =>
        setCommandVersion((version) => version + 1),
      ),
    [coordinator],
  );
  const projectionRequest = useRef(0);
  const historyRequest = useRef(0);
  const [loadingDesigns, setLoadingDesigns] = useState(true);
  const [creatingDesign, setCreatingDesign] = useState(false);
  const [loadingProjection, setLoadingProjection] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [searchingComponents, setSearchingComponents] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [designs, setDesigns] = useState<DesignerDesignSummary[]>([]);
  const [selectedDesignId, setSelectedDesignId] = useState<string | null>(null);
  const [projection, setProjection] =
    useState<DesignerSchematicProjection | null>(null);
  const [activeView, setActiveView] = useState<DesignerView>("schem");
  const [query, setQuery] = useState("");
  const [components, setComponents] = useState<LibraryComponent[]>([]);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [selectedPartIds, setSelectedPartIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [wireSourcePinId, setWireSourcePinId] = useState<string | null>(null);
  const [labelDraftText, setLabelDraftText] = useState("NET");
  const [draggingComponentId, setDraggingComponentId] = useState<string | null>(
    null,
  );
  const [dragPlacementLoading, setDragPlacementLoading] = useState(false);
  const [dragPlacementDetail, setDragPlacementDetail] =
    useState<LibraryComponentPlacementDetail | null>(null);
  const [dragGhostNm, setDragGhostNm] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);
  const dragResolvePromiseRef =
    useRef<Promise<LibraryComponentPlacementDetail> | null>(null);
  const dragResolveComponentRef = useRef<string | null>(null);
  const ensureDesignPromiseRef = useRef<Promise<string> | null>(null);
  const projectionRef = useRef<DesignerSchematicProjection | null>(null);
  const selectedDesignIdRef = useRef<string | null>(null);
  // Capture-bridge sync counters, read by `window.__openpcbCapture.sync()`.
  // Plain refs — never rendered, so they cost nothing when capture is off.
  const pendingCommandsRef = useRef(0);
  const lastConflictAtRef = useRef<number | null>(null);

  const selectDesign = useCallback((id: string | null) => {
    selectedDesignIdRef.current = id;
    projectionRequest.current += 1;
    historyRequest.current += 1;
    projectionRef.current = null;
    setProjection(null);
    setSelectedDesignId(id);
    setCanUndo(false);
    setCanRedo(false);
    setUndoDepth(0);
    setRedoDepth(0);
    setError(null);
  }, []);

  useEffect(() => {
    if (
      params.initialDesignId &&
      params.initialDesignId !== selectedDesignIdRef.current
    )
      selectDesign(params.initialDesignId);
  }, [params.initialDesignId, selectDesign]);

  const refreshDesigns = useCallback(async () => {
    setLoadingDesigns(true);
    setError(null);
    try {
      const next = await api.listDesigns();
      setDesigns(next);
    } catch (listError) {
      const message =
        listError instanceof Error
          ? listError.message
          : "Failed to load designs";
      setError(message);
      setDesigns([]);
    } finally {
      setLoadingDesigns(false);
    }
  }, [api]);

  const refreshProjectionForDesign = useCallback(
    async (designId: string) => {
      if (selectedDesignIdRef.current !== designId) return;
      const request = ++projectionRequest.current;
      const current = () =>
        selectedDesignIdRef.current === designId &&
        request === projectionRequest.current;
      if (current()) setLoadingProjection(true);
      try {
        const next = await api.getSchematicProjection(designId);
        if (!current() || next.designId !== designId) return;
        if (
          next.revision < (coordinator.queue.snapshot(designId).revision ?? 0)
        )
          return;
        coordinator.queue.observe(designId, next.revision);
        projectionRef.current = next;
        setProjection(next);
      } catch (error) {
        if (current())
          setError(
            error instanceof Error
              ? error.message
              : "Failed to load schematic projection",
          );
        throw error;
      } finally {
        if (current()) setLoadingProjection(false);
      }
    },
    [api, coordinator],
  );

  const refreshProjection = useCallback(async () => {
    if (!selectedDesignId) {
      setProjection(null);
      return;
    }

    await refreshProjectionForDesign(selectedDesignId);
  }, [refreshProjectionForDesign, selectedDesignId]);

  const applyHistorySnapshot = useCallback(
    (history: {
      canUndo: boolean;
      canRedo: boolean;
      undoDepth: number;
      redoDepth: number;
    }) => {
      setCanUndo(history.canUndo);
      setCanRedo(history.canRedo);
      setUndoDepth(history.undoDepth);
      setRedoDepth(history.redoDepth);
    },
    [],
  );

  const clearHistorySnapshot = useCallback(() => {
    applyHistorySnapshot({
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      redoDepth: 0,
    });
  }, [applyHistorySnapshot]);

  const refreshHistoryForDesign = useCallback(
    async (designId: string) => {
      if (selectedDesignIdRef.current !== designId) return;
      const request = ++historyRequest.current;
      const current = () =>
        selectedDesignIdRef.current === designId &&
        request === historyRequest.current;
      if (current()) setLoadingHistory(true);
      try {
        const history = await api.getHistory(designId, DESIGNER_SESSION_ID);
        if (current()) applyHistorySnapshot(history);
      } catch {
        if (current()) clearHistorySnapshot();
      } finally {
        if (current()) setLoadingHistory(false);
      }
    },
    [api, applyHistorySnapshot, clearHistorySnapshot],
  );

  const refreshHistory = useCallback(async () => {
    if (!selectedDesignId) {
      clearHistorySnapshot();
      return;
    }
    await refreshHistoryForDesign(selectedDesignId);
  }, [clearHistorySnapshot, refreshHistoryForDesign, selectedDesignId]);

  const ensureDesignForPlacement = useCallback(async (): Promise<string> => {
    if (selectedDesignId) {
      return selectedDesignId;
    }

    if (ensureDesignPromiseRef.current) {
      return ensureDesignPromiseRef.current;
    }

    const pending = (async () => {
      setCreatingDesign(true);
      setError(null);
      try {
        const created = await api.createDesign();
        setDesigns((current) => {
          if (current.some((design) => design.id === created.id)) {
            return current;
          }
          return [created, ...current];
        });
        if (selectedDesignIdRef.current === selectedDesignId)
          selectDesign(created.id);
        return created.id;
      } catch (createError) {
        const message =
          createError instanceof Error
            ? createError.message
            : "Failed to create design";
        setError(message);
        throw new Error(message);
      } finally {
        setCreatingDesign(false);
      }
    })();

    ensureDesignPromiseRef.current = pending;
    try {
      return await pending;
    } finally {
      ensureDesignPromiseRef.current = null;
    }
  }, [api, selectedDesignId, selectDesign]);

  const createDesign = useCallback(
    async (name?: string): Promise<DesignerDesignSummary | null> => {
      setCreatingDesign(true);
      setError(null);
      try {
        const created = await api.createDesign(name);
        await refreshDesigns();
        if (selectedDesignIdRef.current === selectedDesignId)
          selectDesign(created.id);
        notify?.("Design created", "success");
        return created;
      } catch (createError) {
        const message =
          createError instanceof Error
            ? createError.message
            : "Failed to create design";
        setError(message);
        return null;
      } finally {
        setCreatingDesign(false);
      }
    },
    [api, refreshDesigns, notify, selectedDesignId, selectDesign],
  );

  const renameDesign = useCallback(
    async (designId: string, name: string): Promise<void> => {
      try {
        const updated = await api.updateDesign(designId, { name });
        setDesigns((current) =>
          current.map((design) =>
            design.id === designId
              ? { ...design, name: updated.name, updatedAt: updated.updatedAt }
              : design,
          ),
        );
      } catch (renameError) {
        const message =
          renameError instanceof Error
            ? renameError.message
            : "Failed to rename design";
        notify?.(message, "error");
        throw renameError;
      }
    },
    [api, notify],
  );

  const searchComponents = useCallback(async () => {
    setSearchingComponents(true);
    setError(null);
    try {
      const found = await api.searchComponents(query, 30);
      setComponents(found);
    } catch (searchError) {
      const message =
        searchError instanceof Error
          ? searchError.message
          : "Failed to search components";
      setError(message);
    } finally {
      setSearchingComponents(false);
    }
  }, [api, query]);

  const searchComponentsByQuery = useCallback(
    async (q: string, tags: readonly string[] = []) => {
      return api.searchComponents(q, 50, tags);
    },
    [api],
  );

  const fetchAvailableTags = useCallback(async () => {
    return api.fetchLibraryTags({ excludeSystem: true });
  }, [api]);

  const resolvePlacement = useCallback(
    async (componentId: string) => {
      return api.resolvePlacement(componentId);
    },
    [api],
  );

  const beginDragComponent = useCallback(
    async (componentId: string) => {
      setDraggingComponentId(componentId);
      if (dragPlacementDetail?.component.id === componentId) {
        return;
      }

      if (
        dragResolvePromiseRef.current &&
        dragResolveComponentRef.current === componentId
      ) {
        await dragResolvePromiseRef.current;
        return;
      }

      setDragPlacementLoading(true);
      const pending = api.resolvePlacement(componentId);
      dragResolvePromiseRef.current = pending;
      dragResolveComponentRef.current = componentId;

      try {
        const detail = await pending;
        if (dragResolveComponentRef.current !== componentId) {
          return;
        }
        setDragPlacementDetail(detail);
      } finally {
        if (dragResolveComponentRef.current === componentId) {
          dragResolvePromiseRef.current = null;
          dragResolveComponentRef.current = null;
        }
        setDragPlacementLoading(false);
      }
    },
    [api, dragPlacementDetail?.component.id],
  );

  const clearDragState = useCallback(() => {
    setDraggingComponentId(null);
    setDragPlacementLoading(false);
    setDragPlacementDetail(null);
    setDragGhostNm(null);
    dragResolvePromiseRef.current = null;
    dragResolveComponentRef.current = null;
  }, []);

  const dispatchCommand = useCallback(
    async (command: DesignerCommand) => {
      // This callback belongs to the rendered document; delayed consumers cannot retarget it.
      const designId =
        selectedDesignId ??
        (command.type === "place_part"
          ? await ensureDesignForPlacement()
          : null);
      if (!designId) throw new Error("No design selected");
      pendingCommandsRef.current += 1;
      try {
        let result: DesignerDispatchResult;
        try {
          result = await coordinator.dispatch(designId, command);
        } catch (error) {
          // Declined merge: not a failure; report the refusal, nothing changed.
          if (error instanceof NetMergeDeclinedError) return error.refusal;
          throw error;
        }
        if (
          selectedDesignIdRef.current === designId &&
          projectionRef.current?.designId === designId
        )
          projectionRef.current = {
            ...projectionRef.current,
            revision: result.ok
              ? result.revision
              : projectionRef.current.revision,
          };
        if (commandSession(command) === SCHEMATIC_SESSION) {
          await refreshProjectionForDesign(designId);
          await refreshHistoryForDesign(designId);
        }
        return result;
      } finally {
        pendingCommandsRef.current -= 1;
        lastConflictAtRef.current = coordinator.lastConflictAt;
      }
    },
    [
      selectedDesignId,
      ensureDesignForPlacement,
      coordinator,
      refreshProjectionForDesign,
      refreshHistoryForDesign,
    ],
  );

  const dispatchCommandsBatch = useCallback(
    async (commands: DesignerCommand[]) => {
      if (!commands.length) return;
      if (commands.length > DESIGNER_BATCH_MAX_COMMANDS)
        throw new Error("Selection exceeds the atomic batch limit");
      const batch: DesignerBatchableCommand[] = [];
      for (const command of commands) {
        if (
          command.type === "batch_commands" ||
          command.type === "place_part" ||
          command.type === "pcb_set_view_state" ||
          command.type === "pcb_apply_autolayout_candidate" ||
          command.type === "refresh_part_footprint" ||
          command.type === "pcb_rebind_net_references"
        )
          throw new Error("This action cannot be included in an atomic batch");
        batch.push(command);
      }
      await dispatchCommand({ type: "batch_commands", commands: batch });
    },
    [dispatchCommand],
  );

  const runHistory = useCallback(
    async (designId: string, sessionId: string, kind: "undo" | "redo") => {
      await coordinator.history(designId, sessionId, kind, async () => {
        await refreshProjectionForDesign(designId);
        await refreshHistoryForDesign(designId);
      });
    },
    [coordinator, refreshProjectionForDesign, refreshHistoryForDesign],
  );
  const undo = useCallback(async () => {
    if (selectedDesignId)
      await runHistory(selectedDesignId, DESIGNER_SESSION_ID, "undo");
  }, [selectedDesignId, runHistory]);
  const redo = useCallback(async () => {
    if (selectedDesignId)
      await runHistory(selectedDesignId, DESIGNER_SESSION_ID, "redo");
  }, [selectedDesignId, runHistory]);
  const notifyExternalRevisionBump = useCallback(
    (designId: string, revision: number) => {
      coordinator.queue.observe(designId, revision);
    },
    [coordinator],
  );
  const discardRetainedCommands = useCallback(async () => {
    if (!selectedDesignId) return;
    await refreshProjectionForDesign(selectedDesignId);
    coordinator.queue.discardRetained(selectedDesignId);
  }, [selectedDesignId, coordinator, refreshProjectionForDesign]);
  const reapplyRetainedCommand = useCallback(
    async (id: string) => {
      if (!selectedDesignId) return;
      await refreshProjectionForDesign(selectedDesignId);
      if (selectedDesignIdRef.current !== selectedDesignId)
        throw new Error("Return to the originating design to review this edit");
      await coordinator.reapply(selectedDesignId, id);
      await refreshProjectionForDesign(selectedDesignId);
      await refreshHistoryForDesign(selectedDesignId);
    },
    [
      selectedDesignId,
      coordinator,
      refreshProjectionForDesign,
      refreshHistoryForDesign,
    ],
  );

  // Dev-only capture hooks (M0.2): expose command dispatch + the active design
  // on `window.__openpcbCapture`, gated on OPENPCB_CAPTURE=1. Merges into the
  // shared namespace and removes only its own keys on cleanup.
  //
  // `sync()` is the read-only readiness signal: a capture harness polls it to
  // wait for the frontend to settle instead of guessing with tab bounces. It
  // reports the revision the NEXT envelope would send as `baseRevision`, so a
  // harness can compare it against the backend head before committing.
  useEffect(() => {
    const captureMode =
      (window as { electronAPI?: { captureMode?: boolean } }).electronAPI
        ?.captureMode === true;
    if (!captureMode) return;
    const existing = window.__openpcbCapture ?? {};
    window.__openpcbCapture = {
      ...existing,
      dispatch: (command) => dispatchCommand(command),
      selectedDesignId,
      sync: () => ({
        mountedRevision: selectedDesignId
          ? coordinator.queue.snapshot(selectedDesignId).revision
          : null,
        pendingCommands: pendingCommandsRef.current,
        lastConflictAt: lastConflictAtRef.current,
      }),
    };
    return () => {
      const current = window.__openpcbCapture;
      if (current) {
        delete current.dispatch;
        delete current.selectedDesignId;
        delete current.sync;
      }
    };
  }, [dispatchCommand, selectedDesignId, coordinator]);

  useEffect(() => {
    void refreshDesigns();
    void searchComponents();
  }, [refreshDesigns, searchComponents]);

  useEffect(() => {
    void refreshProjection().catch(() => undefined);
  }, [refreshProjection]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const selectedPart = useMemo(() => {
    if (!projection || !selectedPartId) {
      return null;
    }
    return projection.parts.find((part) => part.id === selectedPartId) ?? null;
  }, [projection, selectedPartId]);

  const selectedPin = useMemo(() => {
    if (!projection || !selectedPinId) {
      return null;
    }
    for (const part of projection.parts) {
      const pin = part.pins.find((candidate) => candidate.id === selectedPinId);
      if (pin) {
        return pin;
      }
    }
    return null;
  }, [projection, selectedPinId]);

  const wireSourcePin = useMemo(() => {
    if (!projection || !wireSourcePinId) {
      return null;
    }
    for (const part of projection.parts) {
      const pin = part.pins.find(
        (candidate) => candidate.id === wireSourcePinId,
      );
      if (pin) {
        return pin;
      }
    }
    return null;
  }, [projection, wireSourcePinId]);

  const selectedLabel = useMemo(() => {
    if (!projection || !selectedLabelId) {
      return null;
    }
    return (
      projection.labels.find((label) => label.id === selectedLabelId) ?? null
    );
  }, [projection, selectedLabelId]);

  const selectedWire = useMemo(() => {
    if (!projection || !selectedWireId) {
      return null;
    }
    return projection.wires.find((wire) => wire.id === selectedWireId) ?? null;
  }, [projection, selectedWireId]);

  const selectedParts = useMemo(() => {
    if (!projection || selectedPartIds.size === 0) {
      return [];
    }
    return projection.parts.filter((part) => selectedPartIds.has(part.id));
  }, [projection, selectedPartIds]);

  return {
    state: {
      commandScope: coordinator.scope,
      commandQueue: selectedDesignId
        ? coordinator.queue.snapshot(selectedDesignId)
        : null,
      loadingDesigns,
      creatingDesign,
      loadingProjection,
      loadingHistory,
      searchingComponents,
      error,
      designs,
      selectedDesignId,
      projection,
      activeView,
      query,
      components,
      selectedPartId,
      selectedPartIds,
      selectedPinId,
      selectedLabelId,
      selectedWireId,
      wireSourcePinId,
      labelDraftText,
      draggingComponentId,
      dragPlacementLoading,
      dragPlacementDetail,
      dragGhostNm,
      canUndo:
        canUndo &&
        !!selectedDesignId &&
        coordinator.queue.snapshot(selectedDesignId).pending === 0,
      canRedo:
        canRedo &&
        !!selectedDesignId &&
        coordinator.queue.snapshot(selectedDesignId).pending === 0,
      undoDepth,
      redoDepth,
    },
    actions: {
      setError,
      refreshDesigns,
      createDesign,
      renameDesign,
      selectDesign,
      refreshProjection,
      refreshHistory,
      setActiveView,
      setQuery,
      setLabelDraftText,
      searchComponents,
      searchComponentsByQuery,
      fetchAvailableTags,
      resolvePlacement,
      beginDragComponent,
      setDragGhostNm,
      clearDragState,
      setSelectedPartId,
      setSelectedPartIds,
      setSelectedPinId,
      setSelectedLabelId,
      setSelectedWireId,
      setWireSourcePinId,
      dispatchCommand,
      dispatchCommandsBatch,
      undo,
      redo,
      notifyExternalRevisionBump,
      runHistory,
      discardRetainedCommands,
      reapplyRetainedCommand,
    },
    derived: {
      selectedPart,
      selectedParts,
      selectedPin,
      selectedLabel,
      selectedWire,
      wireSourcePin,
    },
  };
}
