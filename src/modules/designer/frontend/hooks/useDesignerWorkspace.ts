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
} from "../../../../contracts/modules/sdk";
import { createDesignerApi } from "../api";
import type { DesignerView, ToolMode } from "../types";

export interface DesignerWorkspaceState {
  loadingDesigns: boolean;
  creatingDesign: boolean;
  loadingProjection: boolean;
  searchingComponents: boolean;
  error: string | null;
  designs: DesignerDesignSummary[];
  selectedDesignId: string | null;
  projection: DesignerSchematicProjection | null;
  activeView: DesignerView;
  tool: ToolMode;
  query: string;
  components: LibraryComponent[];
  selectedComponent: LibraryComponentPlacementDetail | null;
  selectedPartId: string | null;
  selectedPinId: string | null;
  selectedLabelId: string | null;
  wireSourcePinId: string | null;
  labelDraftText: string;
  draggingComponentId: string | null;
  dragPlacementLoading: boolean;
  dragPlacementDetail: LibraryComponentPlacementDetail | null;
  dragGhostNm: { x: number; y: number } | null;
}

export interface DesignerWorkspaceActions {
  setError(message: string | null): void;
  refreshDesigns(): Promise<void>;
  createDesign(): Promise<void>;
  selectDesign(designId: string | null): void;
  refreshProjection(): Promise<void>;
  setActiveView(view: DesignerView): void;
  setTool(tool: ToolMode): void;
  setQuery(value: string): void;
  setLabelDraftText(value: string): void;
  searchComponents(): Promise<void>;
  chooseComponent(componentId: string): Promise<void>;
  beginDragComponent(componentId: string): Promise<void>;
  setDragGhostNm(point: { x: number; y: number } | null): void;
  clearDragState(): void;
  setSelectedPartId(partId: string | null): void;
  setSelectedPinId(pinId: string | null): void;
  setSelectedLabelId(labelId: string | null): void;
  setWireSourcePinId(pinId: string | null): void;
  dispatchCommand(command: DesignerCommand): Promise<DesignerDispatchResult>;
}

export interface DesignerWorkspaceDerived {
  selectedPart: DesignerPlacedPart | null;
  selectedPin: DesignerPin | null;
  selectedLabel: DesignerLabel | null;
  wireSourcePin: DesignerPin | null;
}

function commandErrorMessage(result: Exclude<DesignerDispatchResult, { ok: true }>): string {
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
    default:
      return "Command failed";
  }
}

export function useDesignerWorkspace(params: {
  backendURL?: string | null;
  moduleId: string;
}): {
  state: DesignerWorkspaceState;
  actions: DesignerWorkspaceActions;
  derived: DesignerWorkspaceDerived;
} {
  const api = useMemo(
    () => createDesignerApi({ backendURL: params.backendURL, moduleId: params.moduleId }),
    [params.backendURL, params.moduleId],
  );

  const [loadingDesigns, setLoadingDesigns] = useState(false);
  const [creatingDesign, setCreatingDesign] = useState(false);
  const [loadingProjection, setLoadingProjection] = useState(false);
  const [searchingComponents, setSearchingComponents] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [designs, setDesigns] = useState<DesignerDesignSummary[]>([]);
  const [selectedDesignId, setSelectedDesignId] = useState<string | null>(null);
  const [projection, setProjection] = useState<DesignerSchematicProjection | null>(null);
  const [activeView, setActiveView] = useState<DesignerView>("schem");
  const [tool, setTool] = useState<ToolMode>("select");
  const [query, setQuery] = useState("");
  const [components, setComponents] = useState<LibraryComponent[]>([]);
  const [selectedComponent, setSelectedComponent] =
    useState<LibraryComponentPlacementDetail | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [wireSourcePinId, setWireSourcePinId] = useState<string | null>(null);
  const [labelDraftText, setLabelDraftText] = useState("NET");
  const [draggingComponentId, setDraggingComponentId] = useState<string | null>(null);
  const [dragPlacementLoading, setDragPlacementLoading] = useState(false);
  const [dragPlacementDetail, setDragPlacementDetail] =
    useState<LibraryComponentPlacementDetail | null>(null);
  const [dragGhostNm, setDragGhostNm] = useState<{ x: number; y: number } | null>(
    null,
  );
  const dragResolvePromiseRef = useRef<Promise<LibraryComponentPlacementDetail> | null>(null);
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

  const refreshDesigns = useCallback(async () => {
    setLoadingDesigns(true);
    setError(null);
    try {
      const next = await api.listDesigns();
      setDesigns(next);
      if (!selectedDesignId && next[0]) {
        setSelectedDesignId(next[0].id);
      }
    } catch (listError) {
      setError(listError instanceof Error ? listError.message : "Failed to load designs");
      setDesigns([]);
    } finally {
      setLoadingDesigns(false);
    }
  }, [api, selectedDesignId]);

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
          createError instanceof Error ? createError.message : "Failed to create design";
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

  const createDesign = useCallback(async () => {
    setCreatingDesign(true);
    setError(null);
    try {
      const created = await api.createDesign();
      await refreshDesigns();
      setSelectedDesignId(created.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create design");
    } finally {
      setCreatingDesign(false);
    }
  }, [api, refreshDesigns]);

  const searchComponents = useCallback(async () => {
    setSearchingComponents(true);
    setError(null);
    try {
      const found = await api.searchComponents(query, 30);
      setComponents(found);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Failed to search components");
    } finally {
      setSearchingComponents(false);
    }
  }, [api, query]);

  const chooseComponent = useCallback(
    async (componentId: string) => {
      setError(null);
      try {
        const detail = await api.resolvePlacement(componentId);
        setSelectedComponent(detail);
        setTool("place");
      } catch (resolveError) {
        setError(resolveError instanceof Error ? resolveError.message : "Failed to resolve component");
      }
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
        setSelectedComponent(detail);
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

      const envelope: DesignerCommandEnvelope = {
        commandId: crypto.randomUUID(),
        sessionId: "designer-ui-session",
        aggregateId: designId,
        baseRevision: projectionRef.current?.revision ?? null,
        issuedAt: Date.now(),
        command,
      };

      const result = await api.dispatch(designId, envelope);
      if (!result.ok) {
        throw new Error(commandErrorMessage(result));
      }

      await refreshProjectionForDesign(designId);
      return result;
    },
    [
      api,
      ensureDesignForPlacement,
      refreshProjectionForDesign,
    ],
  );

  useEffect(() => {
    void refreshDesigns();
    void searchComponents();
  }, [refreshDesigns, searchComponents]);

  useEffect(() => {
    void refreshProjection();
  }, [refreshProjection]);

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
      const pin = part.pins.find((candidate) => candidate.id === wireSourcePinId);
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
    return projection.labels.find((label) => label.id === selectedLabelId) ?? null;
  }, [projection, selectedLabelId]);

  return {
    state: {
      loadingDesigns,
      creatingDesign,
      loadingProjection,
      searchingComponents,
      error,
      designs,
      selectedDesignId,
      projection,
      activeView,
      tool,
      query,
      components,
      selectedComponent,
      selectedPartId,
      selectedPinId,
      selectedLabelId,
      wireSourcePinId,
      labelDraftText,
      draggingComponentId,
      dragPlacementLoading,
      dragPlacementDetail,
      dragGhostNm,
    },
    actions: {
      setError,
      refreshDesigns,
      createDesign,
      selectDesign: setSelectedDesignId,
      refreshProjection,
      setActiveView,
      setTool,
      setQuery,
      setLabelDraftText,
      searchComponents,
      chooseComponent,
      beginDragComponent,
      setDragGhostNm,
      clearDragState,
      setSelectedPartId,
      setSelectedPinId,
      setSelectedLabelId,
      setWireSourcePinId,
      dispatchCommand,
    },
    derived: {
      selectedPart,
      selectedPin,
      selectedLabel,
      wireSourcePin,
    },
  };
}
