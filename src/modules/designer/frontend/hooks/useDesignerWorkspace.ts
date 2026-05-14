import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DesignerCommand,
  DesignerCommandEnvelope,
  DesignerDesignSummary,
  DesignerDispatchResult,
  DesignerLabel,
  DesignerPin,
  DesignerPlacedPart,
  DesignerSchematicProjection,
  LibraryComponent,
  LibraryComponentPlacementDetail,
} from "../../../../sdks";
import { createDesignerApi } from "../api";
import type { DesignerView } from "../types";

const DESIGNER_SESSION_ID = "designer-ui-session";

export interface DesignerWorkspaceState {
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
  searchComponentsByQuery(query: string): Promise<LibraryComponent[]>;
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
  setWireSourcePinId(pinId: string | null): void;
  dispatchCommand(command: DesignerCommand): Promise<DesignerDispatchResult>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  notifyExternalRevisionBump(revision: number): void;
}

export interface DesignerWorkspaceDerived {
  selectedPart: DesignerPlacedPart | null;
  selectedParts: DesignerPlacedPart[];
  selectedPin: DesignerPin | null;
  selectedLabel: DesignerLabel | null;
  wireSourcePin: DesignerPin | null;
}

function commandErrorMessage(
  result: Exclude<DesignerDispatchResult, { ok: true }>,
): string {
  switch (result.code) {
    case "REVISION_CONFLICT":
      return "Revision conflict. Please retry after refresh.";
    case "COMPONENT_NOT_FOUND":
      return `Component '${result.componentId}' not found in library`;
    case "COMPONENT_NOT_WIREABLE":
      return `Component '${result.componentId}' has no pins and is not wireable`;
    case "PIN_NOT_FOUND":
      return `Pin '${result.pinId}' not found`;
    case "ENTITY_NOT_FOUND":
      return `${result.entityKind} '${result.entityId}' not found`;
    case "INVALID_WIRE_PATH":
      return result.detail;
    case "INVALID_LABEL":
      return result.detail;
    case "INVALID_PRIMITIVE":
      return result.detail;
    case "INVALID_PCB_BOARD_SETTINGS":
      return result.detail;
    case "DUPLICATE_REFERENCE":
      return `Reference '${result.reference}' already exists`;
    default:
      return "Command failed";
  }
}

export function useDesignerWorkspace(params: {
  backendURL?: string | null;
  moduleId: string;
  initialDesignId?: string;
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
      }),
    [params.backendURL, params.moduleId],
  );

  const notify = params.onNotify;

  const [loadingDesigns, setLoadingDesigns] = useState(false);
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

  useEffect(() => {
    projectionRef.current = projection;
  }, [projection]);

  useEffect(() => {
    selectedDesignIdRef.current = selectedDesignId;
  }, [selectedDesignId]);

  useEffect(() => {
    if (params.initialDesignId && params.initialDesignId !== selectedDesignId) {
      setSelectedDesignId(params.initialDesignId);
    }
  }, [params.initialDesignId]);

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
      setLoadingProjection(true);
      setError(null);
      try {
        const next = await api.getSchematicProjection(designId);
        projectionRef.current = next;
        setProjection(next);
      } catch (projectionError) {
        setError(
          projectionError instanceof Error
            ? projectionError.message
            : "Failed to load schematic projection",
        );
        setProjection(null);
        projectionRef.current = null;
      } finally {
        setLoadingProjection(false);
      }
    },
    [api],
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
      setLoadingHistory(true);
      try {
        const history = await api.getHistory(designId, DESIGNER_SESSION_ID);
        applyHistorySnapshot(history);
      } catch {
        clearHistorySnapshot();
      } finally {
        setLoadingHistory(false);
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
        setSelectedDesignId(created.id);
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
  }, [api, selectedDesignId]);

  const createDesign = useCallback(
    async (name?: string): Promise<DesignerDesignSummary | null> => {
      setCreatingDesign(true);
      setError(null);
      try {
        const created = await api.createDesign(name);
        await refreshDesigns();
        setSelectedDesignId(created.id);
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
    [api, refreshDesigns, notify],
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
    async (q: string) => {
      return api.searchComponents(q, 50);
    },
    [api],
  );

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
      let designId = selectedDesignIdRef.current;
      if (!designId && command.type === "place_part") {
        designId = await ensureDesignForPlacement();
      }

      if (!designId) {
        throw new Error("No design selected");
      }

      const isPcbCommand = command.type.startsWith("pcb_");
      const sessionId = isPcbCommand
        ? "designer-pcb-session"
        : DESIGNER_SESSION_ID;

      const envelope: DesignerCommandEnvelope = {
        commandId: crypto.randomUUID(),
        sessionId,
        aggregateId: designId,
        baseRevision: projectionRef.current?.revision ?? null,
        issuedAt: Date.now(),
        command,
      };

      const result = await api.dispatch(designId, envelope);
      if (!result.ok) {
        throw new Error(commandErrorMessage(result));
      }

      if (isPcbCommand) {
        if (projectionRef.current) {
          projectionRef.current = {
            ...projectionRef.current,
            revision: result.revision,
          };
        }
      } else {
        await refreshProjectionForDesign(designId);
        await refreshHistoryForDesign(designId);
      }
      return result;
    },
    [
      api,
      ensureDesignForPlacement,
      refreshProjectionForDesign,
      refreshHistoryForDesign,
    ],
  );

  const undo = useCallback(async () => {
    const designId = selectedDesignIdRef.current;
    if (!designId) {
      return;
    }
    const result = await api.undo(designId, DESIGNER_SESSION_ID);
    if (!result.ok) {
      applyHistorySnapshot(result.history);
      setError("Nothing to undo");
      return;
    }
    applyHistorySnapshot(result.history);
    await refreshProjectionForDesign(designId);
  }, [api, applyHistorySnapshot, refreshProjectionForDesign]);

  const redo = useCallback(async () => {
    const designId = selectedDesignIdRef.current;
    if (!designId) {
      return;
    }
    const result = await api.redo(designId, DESIGNER_SESSION_ID);
    if (!result.ok) {
      applyHistorySnapshot(result.history);
      setError("Nothing to redo");
      return;
    }
    applyHistorySnapshot(result.history);
    await refreshProjectionForDesign(designId);
  }, [api, applyHistorySnapshot, refreshProjectionForDesign]);

  const notifyExternalRevisionBump = useCallback((revision: number) => {
    if (projectionRef.current && projectionRef.current.revision < revision) {
      projectionRef.current = { ...projectionRef.current, revision };
    }
  }, []);

  useEffect(() => {
    void refreshDesigns();
    void searchComponents();
  }, [refreshDesigns, searchComponents]);

  useEffect(() => {
    void refreshProjection();
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

  const selectedParts = useMemo(() => {
    if (!projection || selectedPartIds.size === 0) {
      return [];
    }
    return projection.parts.filter((part) => selectedPartIds.has(part.id));
  }, [projection, selectedPartIds]);

  return {
    state: {
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
      wireSourcePinId,
      labelDraftText,
      draggingComponentId,
      dragPlacementLoading,
      dragPlacementDetail,
      dragGhostNm,
      canUndo,
      canRedo,
      undoDepth,
      redoDepth,
    },
    actions: {
      setError,
      refreshDesigns,
      createDesign,
      renameDesign,
      selectDesign: setSelectedDesignId,
      refreshProjection,
      refreshHistory,
      setActiveView,
      setQuery,
      setLabelDraftText,
      searchComponents,
      searchComponentsByQuery,
      resolvePlacement,
      beginDragComponent,
      setDragGhostNm,
      clearDragState,
      setSelectedPartId,
      setSelectedPartIds,
      setSelectedPinId,
      setSelectedLabelId,
      setWireSourcePinId,
      dispatchCommand,
      undo,
      redo,
      notifyExternalRevisionBump,
    },
    derived: {
      selectedPart,
      selectedParts,
      selectedPin,
      selectedLabel,
      wireSourcePin,
    },
  };
}
