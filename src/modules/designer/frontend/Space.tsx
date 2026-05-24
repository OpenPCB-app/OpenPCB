import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { Bot } from "lucide-react";
import { useNavigationStore } from "@/stores/navigation-store";
import { useAuth } from "@/cloud/AuthProvider";
import { readCloudConfig } from "@/cloud/config";
import { DesignerFloatingToolbar } from "./components/DesignerFloatingToolbar";
import { DesignerHeader } from "./components/DesignerHeader";
import { CloudSyncBadge } from "./components/CloudSyncBadge";
import { CloudPresenceIndicator } from "./components/CloudPresenceIndicator";
import { CloudDesignBrowser } from "./components/CloudDesignBrowser";
import { createDesignerApi } from "./api";
import { DesignerEmptyState } from "./components/DesignerEmptyState";
import { KicadProjectImportWizard } from "./components/KicadProjectImportWizard";
import { DesignerPlaceholderView } from "./components/DesignerPlaceholderView";
import { DesignerSidebar } from "./components/DesignerSidebar";
import {
  SchematicCanvas,
  type SchematicCanvasHandle,
} from "./components/SchematicCanvas";
import { ComponentCommandPalette } from "./components/ComponentCommandPalette";
import {
  SelectionInspector,
  type InspectorSelection,
} from "./components/SelectionInspector/SelectionInspector";
import { ToastProvider, useToast } from "./hooks/use-toast";
import { useDesignerWorkspace } from "./hooks/useDesignerWorkspace";
import { PcbCanvas } from "./pcb/PcbCanvas";
import { Board3DCanvas } from "./three-d/Board3DCanvas";
import { DesignerChatDock } from "../../assistant/frontend";
import { useDesignerTabsStore } from "./stores/designer-tabs-store";
import type {
  LibraryComponent,
  LibraryComponentFootprintVariant,
  LibraryComponentPlacementDetail,
} from "../../../sdks";
import type { DesignerWorkspaceState } from "./hooks/useDesignerWorkspace";
import type { ModuleSpaceProps, ViewportState } from "./types";
import { isEditableShortcutTarget } from "../../../shared/frontend/canvas/utils/keyboard-shortcuts";

const MIN_LEFT = 240;
const MAX_LEFT = 520;
const MIN_CHAT = 320;
const MAX_CHAT = 560;
const CHAT_OPEN_KEY = "openpcb:designer:chat-open";
const CHAT_WIDTH_KEY = "openpcb:designer:chat-width";
const DEFAULT_COMPONENT_LIMIT = 8;
const RECENT_PLACEMENTS_KEY = "openpcb:designer:recents";
const RECENT_PLACEMENTS_CAP = 20;
const PALETTE_RECENTS_LIMIT = 3;
const PALETTE_DEFAULTS_LIMIT = 50;

function readPersistedRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_PLACEMENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function writePersistedRecents(componentId: string): void {
  if (typeof window === "undefined") return;
  try {
    const current = readPersistedRecents();
    const filtered = current.filter((entry) => entry !== componentId);
    const next = [componentId, ...filtered].slice(0, RECENT_PLACEMENTS_CAP);
    window.localStorage.setItem(RECENT_PLACEMENTS_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable / quota — recents are best-effort, fall through.
  }
}

function readPersistedBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

function readPersistedNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) ? value : fallback;
}

function commonComponentRank(component: LibraryComponent): number {
  const text = [component.name, component.description, ...component.tags]
    .join(" ")
    .toLowerCase();
  if (text.includes("resistor")) return 0;
  if (text.includes("capacitor") || /\bcap\b/.test(text)) return 1;
  if (text.includes("led")) return 2;
  if (text.includes("diode")) return 3;
  if (text.includes("transistor") || text.includes("mosfet")) return 4;
  if (text.includes("connector") || text.includes("header")) return 5;
  if (text.includes("opamp") || text.includes("mcu") || /\bic\b/.test(text)) {
    return 6;
  }
  return 100;
}

function sortCommonComponents(
  components: LibraryComponent[],
): LibraryComponent[] {
  return [...components].sort((a, b) => {
    const rankDelta = commonComponentRank(a) - commonComponentRank(b);
    if (rankDelta !== 0) return rankDelta;
    return a.name.localeCompare(b.name);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const UNTITLED_PREFIX = "Untitled Design";

function nextUntitledName(existingNames: readonly string[]): string {
  const taken = new Set(existingNames);
  if (!taken.has(UNTITLED_PREFIX)) return UNTITLED_PREFIX;
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `${UNTITLED_PREFIX} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${UNTITLED_PREFIX} ${Date.now()}`;
}

function CanvasEmptyState({ message }: { message: string }): ReactElement {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-950">
      <p className="text-sm text-slate-500 dark:text-slate-400">{message}</p>
    </div>
  );
}

function SelectionInspectorMount({
  projection,
  state,
  resolvePlacement,
  dispatchCommand,
  setError,
  onClose,
  onOpenInLibrary,
}: {
  projection: NonNullable<DesignerWorkspaceState["projection"]>;
  state: DesignerWorkspaceState;
  resolvePlacement: (
    componentId: string,
  ) => Promise<LibraryComponentPlacementDetail>;
  dispatchCommand: ReturnType<
    typeof useDesignerWorkspace
  >["actions"]["dispatchCommand"];
  setError: ReturnType<typeof useDesignerWorkspace>["actions"]["setError"];
  onClose(): void;
  onOpenInLibrary(componentId: string): void;
}): ReactElement | null {
  const selectedIds = useMemo(() => {
    if (state.selectedPartIds.size > 0) {
      return Array.from(state.selectedPartIds);
    }
    return state.selectedPartId ? [state.selectedPartId] : [];
  }, [state.selectedPartIds, state.selectedPartId]);

  const selectedParts = useMemo(
    () =>
      selectedIds
        .map((id) => projection.parts.find((part) => part.id === id))
        .filter((part): part is NonNullable<typeof part> => part != null),
    [projection.parts, selectedIds],
  );

  const selectedLabel = useMemo(
    () =>
      state.selectedLabelId
        ? (projection.labels.find(
            (label) => label.id === state.selectedLabelId,
          ) ?? null)
        : null,
    [projection.labels, state.selectedLabelId],
  );

  const selectedWire = useMemo(
    () =>
      state.selectedWireId
        ? (projection.wires.find((wire) => wire.id === state.selectedWireId) ??
          null)
        : null,
    [projection.wires, state.selectedWireId],
  );

  const selection: InspectorSelection = useMemo(() => {
    if (selectedParts.length === 1 && selectedParts[0]) {
      return { kind: "part", part: selectedParts[0] };
    }
    if (selectedParts.length > 1) {
      return { kind: "multi", parts: selectedParts };
    }
    if (selectedLabel) {
      return { kind: "label", label: selectedLabel };
    }
    if (selectedWire) {
      return { kind: "wire", wire: selectedWire };
    }
    return null;
  }, [selectedParts, selectedLabel, selectedWire]);

  const partForVariants = selection?.kind === "part" ? selection.part : null;
  const [variants, setVariants] = useState<LibraryComponentFootprintVariant[]>(
    [],
  );

  useEffect(() => {
    if (!partForVariants) {
      setVariants([]);
      return;
    }
    let cancelled = false;
    resolvePlacement(partForVariants.componentId)
      .then((detail) => {
        if (cancelled) return;
        setVariants(detail.footprintVariants ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setVariants([]);
      });
    return () => {
      cancelled = true;
    };
  }, [partForVariants?.componentId, resolvePlacement]);

  if (!selection) return null;

  return (
    <SelectionInspector
      selection={selection}
      projection={projection}
      variants={variants}
      dispatchCommand={dispatchCommand}
      setError={setError}
      onClose={onClose}
      onOpenInLibrary={onOpenInLibrary}
    />
  );
}

function DesignerSpaceInner({
  moduleId,
  backendURL,
  designId,
}: ModuleSpaceProps): ReactElement {
  const { addToast } = useToast();
  const { session, enabled: cloudEnabled } = useAuth();
  const cloudHeaders = useMemo(() => {
    if (!cloudEnabled) return undefined;
    return () => {
      const token = session?.access_token;
      const apiUrl = readCloudConfig().apiUrl;
      return {
        ...(token ? { "x-cloud-bearer": token } : {}),
        ...(apiUrl ? { "x-cloud-api-url": apiUrl } : {}),
      };
    };
  }, [cloudEnabled, session?.access_token]);
  const { state, actions } = useDesignerWorkspace({
    backendURL,
    moduleId,
    initialDesignId: designId,
    cloudHeaders,
    onNotify: addToast,
  });
  const [kicadImportOpen, setKicadImportOpen] = useState(false);

  const cloudBadgeApi = useMemo(
    () => createDesignerApi({ backendURL, moduleId, cloudHeaders }),
    [backendURL, moduleId, cloudHeaders],
  );
  const [cloudBrowserOpen, setCloudBrowserOpen] = useState(false);

  const { openDesignIds, activeDesignId } = useDesignerTabsStore(
    useShallow((s) => ({
      openDesignIds: s.openDesignIds,
      activeDesignId: s.activeDesignId,
    })),
  );
  const openTab = useDesignerTabsStore((s) => s.openTab);
  const closeTabAction = useDesignerTabsStore((s) => s.closeTab);
  const closeOthers = useDesignerTabsStore((s) => s.closeOthers);
  const closeAllTabs = useDesignerTabsStore((s) => s.closeAll);
  const reorderTabs = useDesignerTabsStore((s) => s.reorder);
  const setActiveTab = useDesignerTabsStore((s) => s.setActive);
  const pruneMissing = useDesignerTabsStore((s) => s.pruneMissing);
  const navigateToModule = useNavigationStore((s) => s.navigateToModule);

  const [leftWidth, setLeftWidth] = useState(300);
  const [chatOpen, setChatOpen] = useState(() =>
    readPersistedBoolean(CHAT_OPEN_KEY, false),
  );
  const [chatWidth, setChatWidth] = useState(() =>
    clamp(readPersistedNumber(CHAT_WIDTH_KEY, 380), MIN_CHAT, MAX_CHAT),
  );
  const [zoomPercent, setZoomPercent] = useState(20);
  const [gridVisible, setGridVisible] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pcbDrcCount, setPcbDrcCount] = useState(0);
  const [pcbBoardSlot, setPcbBoardSlot] = useState<HTMLDivElement | null>(null);
  const [pcbLayersSlot, setPcbLayersSlot] = useState<HTMLDivElement | null>(
    null,
  );
  const canvasRef = useRef<SchematicCanvasHandle | null>(null);
  const viewportRef = useRef<Map<string, ViewportState>>(new Map());
  const designsLoadedRef = useRef(false);
  const reconciledRef = useRef(false);

  // Prune tabs whose designs were deleted out-of-band, once designs load.
  useEffect(() => {
    if (state.loadingDesigns) return;
    if (designsLoadedRef.current) return;
    designsLoadedRef.current = true;
    pruneMissing(new Set(state.designs.map((d) => d.id)));
  }, [pruneMissing, state.designs, state.loadingDesigns]);

  // Reconcile initial route + persisted tabs once designs are loaded.
  useEffect(() => {
    if (reconciledRef.current) return;
    if (state.loadingDesigns) return;
    reconciledRef.current = true;

    const knownIds = new Set(state.designs.map((d) => d.id));
    const tabs = useDesignerTabsStore.getState();

    const routeDesignId = designId && knownIds.has(designId) ? designId : null;

    if (routeDesignId) {
      if (!tabs.openDesignIds.includes(routeDesignId)) {
        openTab(routeDesignId);
      } else {
        setActiveTab(routeDesignId);
      }
      return;
    }

    if (tabs.activeDesignId && knownIds.has(tabs.activeDesignId)) {
      navigateToModule("designer", tabs.activeDesignId);
      return;
    }

    if (tabs.openDesignIds.length > 0) {
      const first = tabs.openDesignIds.find((id) => knownIds.has(id));
      if (first) {
        setActiveTab(first);
        navigateToModule("designer", first);
      }
    }
  }, [
    designId,
    navigateToModule,
    openTab,
    setActiveTab,
    state.designs,
    state.loadingDesigns,
  ]);

  // Keep hook-owned selectedDesignId in sync with the active tab. `selectDesign`
  // is React's useState setter underneath — stable — so we capture the
  // reference once via a ref to avoid re-running this effect when the
  // surrounding `actions` object is rebuilt each render.
  const selectDesignRef = useRef(actions.selectDesign);
  selectDesignRef.current = actions.selectDesign;
  useEffect(() => {
    if (activeDesignId === state.selectedDesignId) return;
    selectDesignRef.current(activeDesignId ?? null);
  }, [activeDesignId, state.selectedDesignId]);

  const onSchemViewportChange = useCallback(
    (zoom: number, posX: number, posY: number) => {
      if (state.selectedDesignId)
        viewportRef.current.set(`schem:${state.selectedDesignId}`, {
          zoom,
          posX,
          posY,
        });
    },
    [state.selectedDesignId],
  );

  const onPcbViewportChange = useCallback(
    (zoom: number, posX: number, posY: number) => {
      if (state.selectedDesignId)
        viewportRef.current.set(`pcb:${state.selectedDesignId}`, {
          zoom,
          posX,
          posY,
        });
    },
    [state.selectedDesignId],
  );

  const canOpenPalette = state.activeView === "schem" && !!state.projection;

  const openComponentPalette = useCallback(() => {
    if (canOpenPalette) {
      setPaletteOpen(true);
    }
  }, [canOpenPalette]);

  const handleActivateTab = useCallback(
    (id: string) => {
      setActiveTab(id);
      navigateToModule("designer", id);
    },
    [navigateToModule, setActiveTab],
  );

  const handleCloseTab = useCallback(
    (id: string) => {
      const { nextActiveId } = closeTabAction(id);
      navigateToModule("designer", nextActiveId ?? undefined);
    },
    [closeTabAction, navigateToModule],
  );

  const handleCloseOthers = useCallback(
    (id: string) => {
      closeOthers(id);
      navigateToModule("designer", id);
    },
    [closeOthers, navigateToModule],
  );

  const handleCloseAll = useCallback(() => {
    closeAllTabs();
    navigateToModule("designer", undefined);
  }, [closeAllTabs, navigateToModule]);

  const handleRenameTab = useCallback(
    async (id: string, name: string) => {
      await actions.renameDesign(id, name);
    },
    [actions],
  );

  const handleCreateDesign = useCallback(async () => {
    const name = nextUntitledName(state.designs.map((d) => d.name));
    const created = await actions.createDesign(name);
    if (created) {
      openTab(created.id);
      navigateToModule("designer", created.id);
    }
  }, [actions, navigateToModule, openTab, state.designs]);

  const handleOpenFromEmptyState = useCallback(
    (id: string) => {
      openTab(id);
      navigateToModule("designer", id);
    },
    [navigateToModule, openTab],
  );

  // Cmd/Ctrl+K to open palette; Cmd/Ctrl+W to close active tab (capture phase
  // so the Electron accelerator does not also fire).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target)) {
        return;
      }
      const hasModifier = event.metaKey || event.ctrlKey;
      if (!hasModifier) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        openComponentPalette();
        return;
      }
      if (key === "w") {
        const tabsState = useDesignerTabsStore.getState();
        if (tabsState.activeDesignId) {
          event.preventDefault();
          event.stopPropagation();
          handleCloseTab(tabsState.activeDesignId);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleCloseTab, openComponentPalette]);

  const handlePaletteSelect = useCallback(
    async (componentId: string) => {
      setPaletteOpen(false);
      try {
        const detail = await actions.resolvePlacement(componentId);
        if (!canvasRef.current) {
          addToast("Open a schematic before placing components", "warning");
          return;
        }
        canvasRef.current.armComponentPlacement(detail);
        writePersistedRecents(componentId);
      } catch (err) {
        addToast(
          err instanceof Error ? err.message : "Failed to resolve component",
          "error",
        );
      }
    },
    [actions.resolvePlacement, addToast],
  );

  const searchPaletteComponents = useCallback(
    (q: string, tags: readonly string[] = []) =>
      actions.searchComponentsByQuery(q, tags).catch(() => []),
    [actions.searchComponentsByQuery],
  );

  const loadPaletteDefaults = useCallback(async () => {
    // Collect recent component IDs: persistent localStorage first (cross-session),
    // then schematic parts as fallback. Cap at PALETTE_RECENTS_LIMIT.
    const recentIds: string[] = [];
    const seen = new Set<string>();
    for (const componentId of readPersistedRecents()) {
      if (!componentId || seen.has(componentId)) continue;
      seen.add(componentId);
      recentIds.push(componentId);
      if (recentIds.length >= PALETTE_RECENTS_LIMIT) break;
    }
    const parts = state.projection?.parts ?? [];
    for (
      let index = parts.length - 1;
      index >= 0 && recentIds.length < PALETTE_RECENTS_LIMIT;
      index -= 1
    ) {
      const componentId = parts[index]?.componentId;
      if (!componentId || seen.has(componentId)) continue;
      seen.add(componentId);
      recentIds.push(componentId);
    }

    const [recents, allDefaults] = await Promise.all([
      recentIds.length === 0
        ? Promise.resolve<LibraryComponent[]>([])
        : Promise.all(
            recentIds.map((componentId) =>
              actions.resolvePlacement(componentId).catch(() => null),
            ),
          ).then((details) =>
            details
              .map((detail) => detail?.component ?? null)
              .filter(
                (component): component is LibraryComponent =>
                  component !== null,
              ),
          ),
      actions.searchComponentsByQuery("").catch(() => []),
    ]);

    const recentIdSet = new Set(recents.map((c) => c.id));
    const remaining = allDefaults.filter((c) => !recentIdSet.has(c.id));
    // Place curated common components first; everything else after (already
    // alphabetical from backend).
    const sortedRemaining = sortCommonComponents(remaining).slice(
      0,
      PALETTE_DEFAULTS_LIMIT,
    );

    const groups: Array<{ label: string; components: LibraryComponent[] }> = [];
    if (recents.length > 0) {
      groups.push({ label: "Recently used", components: recents });
    }
    if (sortedRemaining.length > 0) {
      groups.push({
        label: recents.length > 0 ? "All components" : "Common components",
        components: sortedRemaining,
      });
    }
    return { groups };
  }, [
    actions.resolvePlacement,
    actions.searchComponentsByQuery,
    state.projection?.parts,
  ]);

  const selectionSummary = useMemo(() => {
    if (state.selectedPinId) {
      return `Pin: ${state.selectedPinId}`;
    }
    if (state.selectedPartId) {
      return `Part: ${state.selectedPartId}`;
    }
    if (state.selectedLabelId) {
      return `Label: ${state.selectedLabelId}`;
    }
    return "Select";
  }, [state.selectedLabelId, state.selectedPartId, state.selectedPinId]);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftWidth;

    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      setLeftWidth(clamp(startWidth + delta, MIN_LEFT, MAX_LEFT));
    };

    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const noTabsOpen = openDesignIds.length === 0;
  const activeDesign = useMemo(
    () => state.designs.find((design) => design.id === state.selectedDesignId) ?? null,
    [state.designs, state.selectedDesignId],
  );

  useEffect(() => {
    window.localStorage.setItem(CHAT_OPEN_KEY, String(chatOpen));
  }, [chatOpen]);

  useEffect(() => {
    window.localStorage.setItem(CHAT_WIDTH_KEY, String(chatWidth));
  }, [chatWidth]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target)) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "i") return;
      event.preventDefault();
      setChatOpen((value) => !value);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const startChatResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = chatWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      setChatWidth(clamp(startWidth + delta, MIN_CHAT, MAX_CHAT));
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const handleAssistantDesignChanged = useCallback(
    (change?: {
      kind: "applied" | "rejected" | "tool";
      designId?: string;
      revision?: number;
    }) => {
      if (change?.revision !== undefined) {
        actions.notifyExternalRevisionBump(change.revision);
      }

      void (async () => {
        await actions.refreshDesigns();
        if (!change?.designId || change.designId === state.selectedDesignId) {
          await Promise.all([
            actions.refreshProjection(),
            actions.refreshHistory(),
          ]);
        }
      })();
    },
    [actions, state.selectedDesignId],
  );

  const canvasContent = () => {
    if (noTabsOpen) {
      return (
        <DesignerEmptyState
          designs={state.designs}
          creatingDesign={state.creatingDesign}
          onCreate={() => void handleCreateDesign()}
          onOpen={handleOpenFromEmptyState}
          onImportKicad={() => setKicadImportOpen(true)}
        />
      );
    }
    if (!state.selectedDesignId) {
      return <CanvasEmptyState message="Loading design…" />;
    }
    if (!state.projection) {
      return <CanvasEmptyState message="Loading schematic..." />;
    }
    return (
      <SchematicCanvas
        ref={canvasRef}
        projection={state.projection}
        selectedPartId={state.selectedPartId}
        selectedPinId={state.selectedPinId}
        selectedLabelId={state.selectedLabelId}
        wireSourcePinId={state.wireSourcePinId}
        labelDraftText={state.labelDraftText}
        gridVisible={gridVisible}
        draggingComponentId={state.draggingComponentId}
        dragPlacementLoading={state.dragPlacementLoading}
        dragPlacementDetail={state.dragPlacementDetail}
        dragGhostNm={state.dragGhostNm}
        actions={actions}
        onZoomChange={setZoomPercent}
        initialViewport={
          state.selectedDesignId
            ? (viewportRef.current.get(`schem:${state.selectedDesignId}`) ??
              null)
            : null
        }
        onViewportChange={onSchemViewportChange}
      />
    );
  };

  return (
    <div className="flex h-full w-full flex-col bg-slate-950">
      <DesignerHeader
        activeView={state.activeView}
        designs={state.designs}
        openDesignIds={openDesignIds}
        activeDesignId={activeDesignId}
        creatingDesign={state.creatingDesign}
        onViewChange={actions.setActiveView}
        onActivateTab={handleActivateTab}
        onCloseTab={handleCloseTab}
        onCloseOthers={handleCloseOthers}
        onCloseAll={handleCloseAll}
        onRenameTab={handleRenameTab}
        onReorderTabs={reorderTabs}
        onCreateDesign={() => void handleCreateDesign()}
        trailing={
          <>
            {cloudEnabled && session && (
              <button
                type="button"
                onClick={() => setCloudBrowserOpen(true)}
                className="rounded-sm border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                title="Browse designs from cloud"
              >
                Open from Cloud
              </button>
            )}
            <CloudSyncBadge
              designId={activeDesignId}
              api={cloudBadgeApi}
              onNotify={addToast}
            />
            <CloudPresenceIndicator
              designId={activeDesignId}
              api={cloudBadgeApi}
            />
            <button
              type="button"
              aria-pressed={chatOpen}
              onClick={() => setChatOpen((value) => !value)}
              className={`flex shrink-0 items-center gap-1 rounded-sm border px-2 py-0.5 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 ${
                chatOpen
                  ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200"
                  : "border-slate-300 dark:text-slate-200"
              }`}
              title="Toggle Designer Chat (Cmd/Ctrl+I)"
            >
              <Bot className="h-3.5 w-3.5" />
              Chat
            </button>
          </>
        }
      />

      <CloudDesignBrowser
        open={cloudBrowserOpen}
        onClose={() => setCloudBrowserOpen(false)}
        api={cloudBadgeApi}
        onNotify={addToast}
      />

      {state.error ? (
        <div className="border-b border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        <div style={{ width: leftWidth }} className="shrink-0">
          <DesignerSidebar
            state={state}
            actions={actions}
            activeView={state.activeView}
            pcbSlotRef={setPcbBoardSlot}
            pcbLayersSlotRef={setPcbLayersSlot}
            onPlaceComponent={openComponentPalette}
            onAddNetLabel={() => canvasRef.current?.armPrimitive("net_portal")}
            onBrowseLibrary={() => navigateToModule("library")}
            onFrameBoundsMm={(bounds) =>
              canvasRef.current?.frameToBoundsMm(bounds)
            }
          />
        </div>

        <div
          className="group relative w-1 shrink-0 cursor-col-resize bg-slate-800/40 hover:bg-violet-600/60"
          onPointerDown={startResize}
        >
          <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-700 group-hover:bg-violet-400" />
        </div>

        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {noTabsOpen ? (
            <DesignerEmptyState
              designs={state.designs}
              creatingDesign={state.creatingDesign}
              onCreate={() => void handleCreateDesign()}
              onOpen={handleOpenFromEmptyState}
            />
          ) : state.activeView === "schem" ? (
            canvasContent()
          ) : state.activeView === "pcb" ? (
            <PcbCanvas
              backendURL={backendURL}
              moduleId={moduleId}
              designId={state.selectedDesignId}
              gridVisible={gridVisible}
              dispatchCommand={actions.dispatchCommand}
              notifyExternalRevisionBump={actions.notifyExternalRevisionBump}
              onDrcCountChange={setPcbDrcCount}
              boardPanelTarget={pcbBoardSlot}
              layersPanelTarget={pcbLayersSlot}
              initialViewport={
                state.selectedDesignId
                  ? (viewportRef.current.get(`pcb:${state.selectedDesignId}`) ??
                    null)
                  : null
              }
              onViewportChange={onPcbViewportChange}
            />
          ) : state.activeView === "3d" ? (
            <Board3DCanvas
              backendURL={backendURL}
              moduleId={moduleId}
              selectedDesignId={state.selectedDesignId}
              error={state.error}
            />
          ) : (
            <DesignerPlaceholderView view={state.activeView} />
          )}

          {!noTabsOpen && state.activeView === "schem" && state.projection ? (
            <SelectionInspectorMount
              projection={state.projection}
              state={state}
              resolvePlacement={actions.resolvePlacement}
              dispatchCommand={actions.dispatchCommand}
              setError={actions.setError}
              onClose={() => {
                actions.setSelectedPartId(null);
                actions.setSelectedPartIds(new Set<string>());
                actions.setSelectedLabelId(null);
                actions.setSelectedWireId(null);
                actions.setSelectedPinId(null);
              }}
              onOpenInLibrary={() => navigateToModule("library")}
            />
          ) : null}

          {!noTabsOpen && state.activeView === "schem" && state.projection ? (
            <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2">
              <div className="pointer-events-auto">
                <DesignerFloatingToolbar
                  gridVisible={gridVisible}
                  onToggleGrid={() => setGridVisible((v) => !v)}
                  canUndo={state.canUndo}
                  canRedo={state.canRedo}
                  onUndo={() => void actions.undo()}
                  onRedo={() => void actions.redo()}
                  onZoomIn={() => canvasRef.current?.zoomIn()}
                  onZoomOut={() => canvasRef.current?.zoomOut()}
                  onFit={() => canvasRef.current?.fit()}
                  onPlaceComponent={openComponentPalette}
                  onPlaceGnd={() => canvasRef.current?.armPrimitive("gnd")}
                  onPlacePwr={() => canvasRef.current?.armPrimitive("pwr")}
                  onPlaceNetPortal={() =>
                    canvasRef.current?.armPrimitive("net_portal")
                  }
                />
              </div>
            </div>
          ) : null}
        </div>

        {chatOpen ? (
          <>
            <div
              className="group relative w-1 shrink-0 cursor-col-resize bg-slate-800/20 hover:bg-violet-600/60"
              onPointerDown={startChatResize}
            >
              <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-300 group-hover:bg-violet-400 dark:bg-slate-700" />
            </div>
            <div style={{ width: chatWidth }} className="min-h-0 shrink-0">
              <DesignerChatDock
                backendURL={backendURL}
                designId={state.selectedDesignId}
                designName={activeDesign?.name ?? null}
                designRevision={activeDesign?.revision ?? null}
                onClose={() => setChatOpen(false)}
                onOpenFull={(chatId) =>
                  navigateToModule("assistant", undefined, { chatId })
                }
                onDesignChanged={handleAssistantDesignChanged}
              />
            </div>
          </>
        ) : null}
      </div>

      <ComponentCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onSelect={handlePaletteSelect}
        searchComponents={searchPaletteComponents}
        loadDefaultComponents={loadPaletteDefaults}
        fetchPlacementDetail={actions.resolvePlacement}
        fetchAvailableTags={actions.fetchAvailableTags}
      />

      {kicadImportOpen && (
        <KicadProjectImportWizard
          backendURL={backendURL ?? null}
          moduleId={moduleId}
          onClose={() => setKicadImportOpen(false)}
          onImported={(result) => {
            void actions.refreshDesigns();
            openTab(result.designId);
            navigateToModule("designer", result.designId);
            setKicadImportOpen(false);
          }}
        />
      )}
    </div>
  );
}

export function DesignerSpace(props: ModuleSpaceProps): ReactElement {
  return (
    <ToastProvider>
      <DesignerSpaceInner {...props} />
    </ToastProvider>
  );
}
