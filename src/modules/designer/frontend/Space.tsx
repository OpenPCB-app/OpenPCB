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
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Bot, HardDrive, PanelRight } from "lucide-react";
import { useNavigationStore } from "@/stores/navigation-store";
import { useWindowTitleStore } from "@/stores/window-title-store";
import { useAuth } from "@/cloud/AuthProvider";
import { useCloudPrefs } from "@/cloud/cloud-prefs";
import { useFeatureFlag } from "@/feature-flags";
import { readCloudConfig } from "@/cloud/config";
import { getSupabase } from "@/cloud/supabase";
import { SchematicToolbar } from "./components/DesignerFloatingToolbar";
import { DesignerHeader } from "./components/DesignerHeader";
import { CloudSyncBadge } from "./components/CloudSyncBadge";
import { CloudPresenceIndicator } from "./components/CloudPresenceIndicator";
import { CloudDesignBrowser } from "./components/CloudDesignBrowser";
import { createDesignerApi } from "./api";
import { DesignerEmptyState } from "./components/DesignerEmptyState";
import { KicadProjectImportWizard } from "./components/KicadProjectImportWizard";
import { DesignerPlaceholderView } from "./components/DesignerPlaceholderView";
import { DesignerBomView } from "./components/DesignerBomView";
import { DesignerDrcView } from "./components/DesignerDrcView";
import { DesignerErcView } from "./components/DesignerErcView";
import { DesignerStatusBar } from "./components/DesignerStatusBar";
import { DesignerSidebar } from "./components/DesignerSidebar";
import { DesignerRightDock } from "./components/DesignerRightDock";
import { useDrcStore } from "./pcb/drc/drc-store";
import { usePcbViewStore } from "./pcb/pcb-view-store";
import { setPcbCursorPoint } from "./pcb/pcb-cursor-store";
import { setSchematicCursorPoint } from "./stores/schematic-cursor-store";
import { ercIssueCount, useErcStore } from "./stores/erc-store";
import {
  MAX_DOCK_WIDTH,
  MIN_DOCK_WIDTH,
  clampDockWidth,
  readDockPrefs,
  writeDockPrefs,
  type DockTab,
} from "./stores/designer-dock-prefs";
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
import { useDesignerComments } from "./hooks/useDesignerComments";
import { PcbCanvas } from "./pcb/PcbCanvas";
import { Board3DCanvas } from "./three-d/Board3DCanvas";
import { DesignerChatDock } from "../../assistant/frontend";
import { useDesignerTabsStore } from "./stores/designer-tabs-store";
import { useDesignerEvents } from "./hooks/useDesignerEvents";
import { useActiveDesignSync } from "./hooks/useActiveDesignSync";
import type {
  DesignerPlacedPart,
  LibraryComponent,
  LibraryComponentFootprintVariant,
  LibraryComponentPlacementDetail,
} from "../../../sdks";
import type { DesignerWorkspaceState } from "./hooks/useDesignerWorkspace";
import type { ModuleSpaceProps, ViewportState } from "./types";
import { isEditableShortcutTarget } from "../../../shared/frontend/canvas/utils/keyboard-shortcuts";
import type { PcbLayerId } from "../../../sdks";
import { IconButton } from "@shared/frontend/ui/icon-button";
import { TooltipProvider } from "@shared/frontend/ui/tooltip";
import type { DockTabItem } from "@shared/frontend/ui/dock-tabs";
import { CanvasZoomCluster } from "@shared/frontend/ui/canvas-zoom-cluster";

const MIN_LEFT = 240;
const MAX_LEFT = 520;
const DEFAULT_LEFT = 260;
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
    <div className="flex h-full w-full items-center justify-center bg-surface-app">
      <p className="text-xs text-text-tertiary">{message}</p>
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
  onCrossProbePcb,
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
  onCrossProbePcb?(part: DesignerPlacedPart): void;
}): ReactElement {
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
  // The library record behind the selected part: fallback source for the
  // Fields rows (MPN / Manufacturer / Datasheet) when the instance carries no
  // per-part override in `propertiesJson`.
  const [libraryComponent, setLibraryComponent] =
    useState<LibraryComponent | null>(null);

  useEffect(() => {
    if (!partForVariants) {
      setVariants([]);
      setLibraryComponent(null);
      return;
    }
    let cancelled = false;
    resolvePlacement(partForVariants.componentId)
      .then((detail) => {
        if (cancelled) return;
        setVariants(detail.footprintVariants ?? []);
        setLibraryComponent(detail.component ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setVariants([]);
        setLibraryComponent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [partForVariants?.componentId, resolvePlacement]);

  // Nothing selected renders the idle "Sheet" summary rather than an empty
  // dock body.
  return (
    <SelectionInspector
      selection={selection}
      projection={projection}
      variants={variants}
      component={libraryComponent}
      dispatchCommand={dispatchCommand}
      setError={setError}
      onClose={onClose}
      onOpenInLibrary={onOpenInLibrary}
      onCrossProbePcb={onCrossProbePcb}
    />
  );
}

function DesignerSpaceInner({
  moduleId,
  backendURL,
  designId,
  params,
}: ModuleSpaceProps): ReactElement {
  const { addToast } = useToast();
  const { session, user, enabled: cloudEnabled } = useAuth();
  const projectSyncEnabled = useCloudPrefs((s) => s.projectSyncEnabled);
  // Per-feature cloud gates (dev-only by default — see @/feature-flags).
  const syncFeatureEnabled = useFeatureFlag("cloud.sync");
  const autoLayoutFeatureEnabled = useFeatureFlag("cloud.autolayout");
  const presenceFeatureEnabled = useFeatureFlag("cloud.presence");
  const commentsFeatureEnabled = useFeatureFlag("cloud.comments");
  const designBrowserFeatureEnabled = useFeatureFlag("cloud.designBrowser");
  // No cloud headers (→ no command mirroring, no linking) unless cloud is
  // configured AND the user has project sync turned on.
  const cloudHeaders = useMemo(() => {
    if (!cloudEnabled || !projectSyncEnabled || !syncFeatureEnabled)
      return undefined;
    return () => {
      const token = session?.access_token;
      const apiUrl = readCloudConfig().apiUrl;
      return {
        ...(token ? { "x-cloud-bearer": token } : {}),
        ...(apiUrl ? { "x-cloud-api-url": apiUrl } : {}),
      };
    };
  }, [
    cloudEnabled,
    projectSyncEnabled,
    syncFeatureEnabled,
    session?.access_token,
  ]);
  // Auto-Layout only needs a valid login (the snapshot is self-contained; the
  // service is stateless) — NOT project sync. Separate from `cloudHeaders` so a
  // user with sync off can still run auto-place/auto-route.
  const autoLayoutCloudHeaders = useMemo(() => {
    if (!cloudEnabled || !session) return undefined;
    return () => {
      const token = session.access_token;
      const apiUrl = readCloudConfig().apiUrl;
      return {
        ...(token ? { "x-cloud-bearer": token } : {}),
        ...(apiUrl ? { "x-cloud-api-url": apiUrl } : {}),
      };
    };
  }, [cloudEnabled, session]);
  // TWO gates, deliberately separate.
  //
  // `autoLayoutEnabled` decides whether the feature is VISIBLE: the flag is on and the
  // desktop knows where the cloud is. `autoLayoutSignedIn` decides whether it can RUN.
  // Collapsing them (as this did) means a signed-out user sees no Auto Layout button at
  // all and concludes OpenPCB has no such feature; now they see it, and the dialog asks
  // them to sign in without issuing a request.
  //
  // The tier check is gone. Auto Layout requires an authenticated OpenPCB Cloud session,
  // not a Pro subscription — the service dropped its Pro gate, and entitlement is separate
  // product policy from authentication. Copilot's tier rules are untouched.
  const autoLayoutEnabled = cloudEnabled && autoLayoutFeatureEnabled;
  const autoLayoutSignedIn = Boolean(session);
  const { state, actions } = useDesignerWorkspace({
    backendURL,
    moduleId,
    initialDesignId: designId,
    cloudHeaders,
    onNotify: addToast,
  });
  const commentSurface = state.activeView === "pcb" ? "pcb" : "schematic";
  // Comment cloud sync rides the project-sync headers but is independently
  // gated; when off, comments still persist locally (they just don't sync).
  const commentsCloudHeaders = commentsFeatureEnabled
    ? cloudHeaders
    : undefined;
  const comments = useDesignerComments({
    backendURL,
    moduleId,
    designId: state.selectedDesignId,
    surface: commentSurface,
    currentUserEmail: user?.email ?? null,
    cloudHeaders: commentsCloudHeaders,
  });
  const [kicadImportOpen, setKicadImportOpen] = useState(false);

  const cloudBadgeApi = useMemo(
    () => createDesignerApi({ backendURL, moduleId, cloudHeaders }),
    [backendURL, moduleId, cloudHeaders],
  );
  const [cloudBrowserOpen, setCloudBrowserOpen] = useState(false);

  useEffect(() => {
    if (
      !state.selectedDesignId ||
      !cloudEnabled ||
      !session ||
      !commentsFeatureEnabled
    )
      return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    void cloudBadgeApi
      .getCloudLink(state.selectedDesignId)
      .then(({ link }) => {
        if (cancelled || !link?.cloudDesignId) return;
        const sb = getSupabase();
        if (!sb) return;
        channel = sb.channel(`design:${link.cloudDesignId}`);
        channel
          .on("broadcast", { event: "comment" }, () => {
            void comments.refresh();
          })
          .subscribe();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (channel) {
        void channel.unsubscribe();
        const sb = getSupabase();
        if (sb) void sb.removeChannel(channel);
      }
    };
  }, [
    cloudBadgeApi,
    cloudEnabled,
    commentsFeatureEnabled,
    comments,
    session,
    state.selectedDesignId,
  ]);

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

  // Mirror the focused tab to the backend so external MCP clients can default
  // to "the design the user is looking at".
  useActiveDesignSync(cloudBadgeApi, activeDesignId);

  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT);
  // One tabbed right dock replaces the three stacked docks; open/width/tab are
  // persisted (migrating the legacy chat/inspector/drc keys on first read).
  const [initialDockPrefs] = useState(readDockPrefs);
  const [dockOpen, setDockOpen] = useState(initialDockPrefs.open);
  const [dockWidth, setDockWidth] = useState(initialDockPrefs.width);
  const [dockTab, setDockTab] = useState<DockTab>(initialDockPrefs.tab);
  const [zoomPercent, setZoomPercent] = useState(20);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Live in-progress-trace DRC conflict count while routing; `null` when idle so
  // the PCB status-bar chip falls back to the full-board batch count.
  const [pcbLiveDrc, setPcbLiveDrc] = useState<number | null>(null);
  const [pcbSelectionCount, setPcbSelectionCount] = useState(0);
  // Batch-DRC summary (errors + warnings) for the status bars + dock chip.
  const drcSummary = useDrcStore((s) => s.report?.summary);
  // DRC dock open-state lives in the shared store (toggled from the PCB toolbar
  // inside PcbCanvas + the status-bar chip here). Session-only, default closed.
  const drcPanelOpen = useDrcStore((s) => s.panelOpen);
  const setDrcPanelOpen = useDrcStore((s) => s.setPanelOpen);
  const [schematicSelectionRequest, setSchematicSelectionRequest] = useState<{
    partIds?: string[];
    wireIds?: string[];
    labelIds?: string[];
    nonce: number;
  } | null>(null);
  const [pcbSelectionRequest, setPcbSelectionRequest] = useState<{
    placementIds: string[];
    references?: string[];
    nonce: number;
  } | null>(null);
  const [pcbLayersSlot, setPcbLayersSlot] = useState<HTMLDivElement | null>(
    null,
  );
  // Docked PCB chrome: PcbCanvas portals its toolbar / parameter row / layer
  // strip / properties panel into these slots (the pcbLayersSlot pattern).
  const [pcbToolbarSlot, setPcbToolbarSlot] = useState<HTMLDivElement | null>(
    null,
  );
  const [pcbParamRowSlot, setPcbParamRowSlot] = useState<HTMLDivElement | null>(
    null,
  );
  const [pcbLayerStripSlot, setPcbLayerStripSlot] =
    useState<HTMLDivElement | null>(null);
  const [pcbPropertiesSlot, setPcbPropertiesSlot] =
    useState<HTMLDivElement | null>(null);
  const [pcbComponentsSlot, setPcbComponentsSlot] =
    useState<HTMLDivElement | null>(null);
  const [pcbLayersHeaderSlot, setPcbLayersHeaderSlot] =
    useState<HTMLDivElement | null>(null);
  // Batch-ERC summary for the schematic status bar + dock badge. ERC is not
  // persisted server-side; the dock view runs it on open.
  const ercReportRaw = useErcStore((s) => s.report);
  const clearErc = useErcStore((s) => s.clear);
  // Never let another design's report drive this design's badge/status chip —
  // the store is cleared on design change, but the dock view's own re-run
  // effect races that clear by one commit.
  const ercReport =
    ercReportRaw && ercReportRaw.designId === state.selectedDesignId
      ? ercReportRaw
      : null;
  const ercCount = ercIssueCount(ercReport);
  // Status-bar strings published by PcbCanvas (tool hint + selection summary).
  const [pcbHint, setPcbHint] = useState("");
  // Status-bar hint published by SchematicCanvas.
  const [schemHint, setSchemHint] = useState("");
  const [pcbSelectionSummary, setPcbSelectionSummary] =
    useState("No selection");
  const [pcbComponentCount, setPcbComponentCount] = useState(0);
  const [threeDSlot, setThreeDSlot] = useState<HTMLDivElement | null>(null);
  const [pcbActiveLayer, setPcbActiveLayer] = useState<PcbLayerId | null>(null);
  const pcbViewSide = usePcbViewStore((s) => s.viewState.viewSide);
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

  // Schematic status-bar selection segment (design D2 §9): human-readable
  // designators, never raw entity ids.
  const selectionSummary = useMemo(() => {
    const projection = state.projection;
    if (state.selectedPartIds.size > 1) {
      return `${state.selectedPartIds.size} parts selected`;
    }
    if (state.selectedPinId && projection) {
      for (const part of projection.parts) {
        const pin = part.pins.find((p) => p.id === state.selectedPinId);
        if (pin) return `${part.reference}.${pin.number ?? pin.name}`;
      }
    }
    if (state.selectedPartId) {
      const part = projection?.parts.find(
        (p) => p.id === state.selectedPartId,
      );
      if (part) {
        return part.value
          ? `${part.reference} · ${part.value}`
          : part.reference;
      }
    }
    if (state.selectedLabelId) {
      const label = projection?.labels.find(
        (l) => l.id === state.selectedLabelId,
      );
      if (label) return label.text;
    }
    if (state.selectedWireId) {
      const wireId = state.selectedWireId;
      const net = projection?.nets.find((n) => n.wireIds.includes(wireId));
      return net ? `Wire · ${net.name}` : "Wire";
    }
    return "No selection";
  }, [
    state.projection,
    state.selectedLabelId,
    state.selectedPartId,
    state.selectedPartIds,
    state.selectedPinId,
    state.selectedWireId,
  ]);

  // Drives the toolbar's "Zoom to selection" enablement. Mirrors the four
  // selection slots the canvas publishes back to the shell.
  const hasSchematicSelection =
    state.selectedPartIds.size > 0 ||
    state.selectedPartId !== null ||
    state.selectedLabelId !== null ||
    state.selectedWireId !== null;

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

  const handleBomShowSchematic = useCallback(
    (partIds: string[]) => {
      if (partIds.length === 0) return;
      setSchematicSelectionRequest((current) => ({
        partIds,
        nonce: (current?.nonce ?? 0) + 1,
      }));
      actions.setActiveView("schem");
      const parts =
        state.projection?.parts.filter((part) => partIds.includes(part.id)) ??
        [];
      if (parts.length > 0) {
        const xs = parts.map((part) => part.positionNm.x / 1_000_000);
        const ys = parts.map((part) => part.positionNm.y / 1_000_000);
        window.requestAnimationFrame(() => {
          canvasRef.current?.frameToBoundsMm({
            minX: Math.min(...xs) - 5,
            minY: Math.min(...ys) - 5,
            maxX: Math.max(...xs) + 5,
            maxY: Math.max(...ys) + 5,
          });
        });
      }
    },
    [actions, state.projection?.parts],
  );

  // Clicking a row in the outline highlights it on the schematic canvas (the
  // canvas owns its own selection state — sync via an imperative request).
  const handleOutlineSelect = useCallback(
    (sel: { partIds?: string[]; wireIds?: string[]; labelIds?: string[] }) => {
      setSchematicSelectionRequest((current) => ({
        ...sel,
        nonce: (current?.nonce ?? 0) + 1,
      }));
    },
    [],
  );

  const handleBomShowPcb = useCallback(
    (placementIds: string[]) => {
      if (placementIds.length === 0) {
        addToast("No PCB placement found for this BOM line.", "warning");
        return;
      }
      setPcbSelectionRequest((current) => ({
        placementIds,
        nonce: (current?.nonce ?? 0) + 1,
      }));
      actions.setActiveView("pcb");
    },
    [actions, addToast],
  );

  const handleCrossProbePcb = useCallback(
    (part: DesignerPlacedPart) => {
      // Resolve the PCB placement by reference designator inside PcbCanvas once
      // its projection loads; if the part isn't placed yet, the view still
      // switches with an empty selection.
      setPcbSelectionRequest((current) => ({
        placementIds: [],
        references: [part.reference],
        nonce: (current?.nonce ?? 0) + 1,
      }));
      actions.setActiveView("pcb");
    },
    [actions],
  );

  const noTabsOpen = openDesignIds.length === 0;
  const activeDesign = useMemo(
    () =>
      state.designs.find((design) => design.id === state.selectedDesignId) ??
      null,
    [state.designs, state.selectedDesignId],
  );

  const drcIssueCount = drcSummary
    ? drcSummary.errors + drcSummary.warnings
    : 0;

  // Schematic part id → value. The PCB projection carries no value field, so the
  // PCB Components list / Properties "Value" row read it from here (the
  // schematic projection loads for the design regardless of the active view).
  const partValues = useMemo(() => {
    const map = new Map<string, string>();
    for (const part of state.projection?.parts ?? []) {
      if (part.value) map.set(part.id, part.value);
    }
    return map;
  }, [state.projection?.parts]);

  // Window title context: "OpenPCB — <design>".
  const setWindowSubtitle = useWindowTitleStore((s) => s.setSubtitle);
  useEffect(() => {
    setWindowSubtitle(activeDesign?.name ?? null);
    return () => setWindowSubtitle(null);
  }, [activeDesign?.name, setWindowSubtitle]);

  // Home's "Import KiCad…" navigates here with `action=import-kicad`. The nav
  // store hands out a fresh route object whenever params are passed, so keying
  // on its identity opens the wizard once per navigation.
  useEffect(() => {
    if (params?.action === "import-kicad") setKicadImportOpen(true);
  }, [params]);

  // Which tabs this view offers. BOM and the full-screen DRC view get no dock.
  const dockTabs = useMemo<ReadonlyArray<DockTabItem<DockTab>>>(() => {
    if (noTabsOpen) return [];
    switch (state.activeView) {
      case "pcb":
        return [
          { id: "properties", label: "Properties" },
          {
            id: "drc",
            label: "DRC",
            badge: drcIssueCount > 0 ? drcIssueCount : undefined,
            badgeClassName: drcIssueCount > 0 ? "text-status-danger" : undefined,
          },
          { id: "assistant", label: "Assistant" },
        ];
      case "schem":
        return [
          { id: "properties", label: "Properties" },
          {
            id: "erc",
            label: "ERC",
            // Only badge once a report exists — "0" before the first run would
            // read as "checked, clean".
            badge: ercReport && ercCount > 0 ? ercCount : undefined,
            badgeClassName: ercCount > 0 ? "text-status-danger" : undefined,
          },
          { id: "assistant", label: "Assistant" },
        ];
      case "3d":
        return [{ id: "assistant", label: "Assistant" }];
      default:
        return [];
    }
  }, [drcIssueCount, ercCount, ercReport, noTabsOpen, state.activeView]);

  // The persisted tab may not exist in this view (e.g. DRC while on 3D).
  const activeDockTab: DockTab =
    dockTabs.find((tab) => tab.id === dockTab)?.id ??
    dockTabs[0]?.id ??
    "properties";
  const dockVisible = dockOpen && dockTabs.length > 0;

  // The DRC dock request lives in the shared DRC store (PCB toolbar button,
  // status-bar counter, cross-view jumps). Mirror it onto the dock in both
  // directions, edge-triggered so the two never ping-pong.
  const drcRequestPrevRef = useRef(drcPanelOpen);
  useEffect(() => {
    if (drcRequestPrevRef.current === drcPanelOpen) return;
    drcRequestPrevRef.current = drcPanelOpen;
    if (drcPanelOpen) {
      setDockOpen(true);
      setDockTab("drc");
    } else if (dockTab === "drc") {
      setDockTab("properties");
    }
  }, [dockTab, drcPanelOpen]);

  const drcDockShown =
    dockVisible && activeDockTab === "drc" && state.activeView === "pcb";
  // Seeded false so a dock that restores onto the DRC tab pushes the store
  // open on mount (keeping the toolbar button's pressed state honest).
  const drcShownPrevRef = useRef(false);
  useEffect(() => {
    if (drcShownPrevRef.current === drcDockShown) return;
    drcShownPrevRef.current = drcDockShown;
    drcRequestPrevRef.current = drcDockShown;
    setDrcPanelOpen(drcDockShown);
  }, [drcDockShown, setDrcPanelOpen]);

  const ercDockShown =
    dockVisible && activeDockTab === "erc" && state.activeView === "schem";

  /** Schematic toolbar ERC button + status-bar chip: toggle the dock's ERC tab. */
  const handleToggleErcDock = useCallback(() => {
    if (ercDockShown) {
      setDockOpen(false);
      return;
    }
    setDockOpen(true);
    setDockTab("erc");
  }, [ercDockShown]);

  // ERC is computed on demand and never persisted, so a design switch must not
  // leave the previous design's violations on screen.
  useEffect(() => {
    clearErc();
  }, [clearErc, state.selectedDesignId]);

  // Selecting on the PCB canvas surfaces the Properties tab. A closed dock is
  // opened (the retired floating inspector appeared unconditionally, and free
  // holes/pads/text have no other editor), but an Assistant conversation is
  // never interrupted — unmounting the chat would drop its draft and run state.
  const pcbSelectionPrevRef = useRef(pcbSelectionCount);
  useEffect(() => {
    const previous = pcbSelectionPrevRef.current;
    pcbSelectionPrevRef.current = pcbSelectionCount;
    if (previous !== 0 || pcbSelectionCount === 0) return;
    if (!dockOpen) {
      setDockOpen(true);
      setDockTab("properties");
    } else if (dockTab !== "assistant") {
      setDockTab("properties");
    }
  }, [dockOpen, dockTab, pcbSelectionCount]);

  useEffect(() => {
    writeDockPrefs({ open: dockOpen, width: dockWidth, tab: dockTab });
  }, [dockOpen, dockWidth, dockTab]);

  /** Open the right dock on the Assistant tab (⌘/Ctrl+I and the header button). */
  const openAssistantDock = useCallback(() => {
    setDockOpen(true);
    setDockTab("assistant");
  }, []);

  // Cmd/Ctrl+I opens the dock on Assistant (was: toggle chat dock);
  // Cmd/Ctrl+. toggles the dock (was: toggle inspector dock).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target)) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "i") {
        event.preventDefault();
        openAssistantDock();
      } else if (event.key === ".") {
        event.preventDefault();
        setDockOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [openAssistantDock]);

  const startDockResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = dockWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      setDockWidth(
        clamp(startWidth + delta, MIN_DOCK_WIDTH, MAX_DOCK_WIDTH),
      );
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

  // Changes from outside this workspace — Claude Code over MCP, the in-app
  // assistant, another window's undo — stream in here (see useDesignerEvents).
  useDesignerEvents({
    backendUrl: backendURL,
    selectedDesignId: state.selectedDesignId,
    knownRevision: actions.getKnownRevision,
    onReaction: (reaction) => {
      if (reaction.focusDesignId) openTab(reaction.focusDesignId);
      if (reaction.selectedRevision !== null) {
        actions.notifyExternalRevisionBump(reaction.selectedRevision);
      }
      void (async () => {
        // Deleted designs drop out of the list; the pruneMissing effect then
        // closes their tabs.
        if (reaction.refreshDesigns || reaction.closeDesignIds.length > 0) {
          await actions.refreshDesigns();
        }
        if (reaction.refreshSelected) {
          await Promise.all([
            actions.refreshProjection(),
            actions.refreshHistory(),
          ]);
        }
      })().catch(() => undefined);
    },
  });

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
        selectionRequest={schematicSelectionRequest}
        wireSourcePinId={state.wireSourcePinId}
        labelDraftText={state.labelDraftText}
        // The schematic grid overlay + grid snap have never been switchable
        // from the shell; keep the constant the dead state used to supply.
        gridVisible={false}
        draggingComponentId={state.draggingComponentId}
        dragPlacementLoading={state.dragPlacementLoading}
        dragPlacementDetail={state.dragPlacementDetail}
        dragGhostNm={state.dragGhostNm}
        actions={actions}
        commentThreads={comments.threads}
        activeCommentThreadId={comments.activeThreadId}
        commentMode={comments.commentMode}
        currentUserEmail={user?.email ?? null}
        onCreateComment={(anchor, body) =>
          void comments.createThread(anchor, body)
        }
        onSelectCommentThread={(threadId) => void comments.loadThread(threadId)}
        onCloseCommentThread={() => comments.setActiveThreadId(null)}
        onAddCommentMessage={async (thread, body, file) => {
          await comments.addMessage(thread, body, file);
        }}
        onSetCommentStatus={async (thread, status) => {
          await comments.setStatus(thread, status);
        }}
        onSetCommentTodoStatus={async (thread, todoStatus) => {
          await comments.setTodoStatus(thread, todoStatus);
        }}
        onToggleCommentReaction={async (thread, messageId, emoji) => {
          await comments.toggleReaction(thread, messageId, emoji);
        }}
        onMoveComment={(thread, pointNm) =>
          void comments.setAnchor(thread, pointNm)
        }
        commentAttachmentUrl={comments.attachmentUrl}
        onToggleCommentMode={() =>
          comments.setCommentMode(!comments.commentMode)
        }
        onCursorChange={setSchematicCursorPoint}
        onHintChange={setSchemHint}
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
    <div className="flex h-full w-full flex-col bg-surface-app">
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
            {cloudEnabled && session ? (
              <>
                {session && designBrowserFeatureEnabled && (
                  <button
                    type="button"
                    onClick={() => setCloudBrowserOpen(true)}
                    className="h-[20px] cursor-pointer rounded-control border border-border-control px-2 text-2xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-strong"
                    title="Browse designs from cloud"
                  >
                    Open from Cloud
                  </button>
                )}
                {syncFeatureEnabled && (
                  <CloudSyncBadge
                    designId={activeDesignId}
                    api={cloudBadgeApi}
                    onNotify={addToast}
                  />
                )}
                {presenceFeatureEnabled && (
                  <CloudPresenceIndicator
                    designId={activeDesignId}
                    api={cloudBadgeApi}
                  />
                )}
              </>
            ) : (
              // No cloud configured, or not signed in — say so once, plainly,
              // instead of leaving the slot empty.
              <span
                title="Not signed in — local only"
                className="inline-flex h-6 items-center gap-1.5 px-2 text-xs text-text-tertiary"
              >
                <HardDrive aria-hidden="true" className="h-3.5 w-3.5" />
                Local
              </span>
            )}
            <span aria-hidden="true" className="h-4 w-px bg-divider" />
            <button
              type="button"
              onClick={openAssistantDock}
              disabled={dockTabs.length === 0}
              title="Open the assistant (⌘/Ctrl+I)"
              className="inline-flex h-6 cursor-pointer items-center gap-1.5 px-2 text-xs text-text-tertiary transition-colors hover:text-text-strong disabled:cursor-default disabled:opacity-50 disabled:hover:text-text-tertiary"
            >
              <Bot aria-hidden="true" className="h-3.5 w-3.5" />
              Assistant
            </button>
            <IconButton
              label="Toggle side panel"
              variant="ghost"
              size="sm"
              active={dockVisible}
              disabled={dockTabs.length === 0}
              onClick={() => setDockOpen((value) => !value)}
            >
              <PanelRight />
            </IconButton>
          </>
        }
      />

      {designBrowserFeatureEnabled && (
        <CloudDesignBrowser
          open={cloudBrowserOpen}
          onClose={() => setCloudBrowserOpen(false)}
          api={cloudBadgeApi}
          onNotify={addToast}
        />
      )}

      {state.error ? (
        <div className="shrink-0 border-b border-border bg-status-danger-soft px-3 py-1 text-xs text-status-danger">
          {state.error}
        </div>
      ) : null}

      {!noTabsOpen && state.activeView === "pcb" ? (
        <>
          {/* PcbCanvas portals its docked toolbar / parameter row here. Both
              collapse to zero height while empty. */}
          <div ref={setPcbToolbarSlot} className="shrink-0" />
          <div ref={setPcbParamRowSlot} className="shrink-0" />
        </>
      ) : null}

      {/* The schematic toolbar is docked in the same row the PCB toolbar slot
          occupies. */}
      {!noTabsOpen && state.activeView === "schem" && state.projection ? (
        <SchematicToolbar
          canUndo={state.canUndo}
          canRedo={state.canRedo}
          onUndo={() => void actions.undo()}
          onRedo={() => void actions.redo()}
          onFit={() => canvasRef.current?.fit()}
          onZoomToSelection={() => canvasRef.current?.frameSelection()}
          canZoomToSelection={hasSchematicSelection}
          onOpenErc={handleToggleErcDock}
          ercCount={ercReport ? ercCount : undefined}
          ercPanelOpen={ercDockShown}
          onPlaceComponent={openComponentPalette}
          onPlaceGnd={() => canvasRef.current?.armPrimitive("gnd")}
          onPlacePwr={() => canvasRef.current?.armPrimitive("pwr")}
          onPlaceNetPortal={() => canvasRef.current?.armPrimitive("net_portal")}
          commentMode={comments.commentMode}
          onToggleCommentMode={() =>
            comments.setCommentMode(!comments.commentMode)
          }
        />
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        {state.activeView !== "bom" && state.activeView !== "drc" ? (
          <>
            <div style={{ width: leftWidth }} className="shrink-0">
              <DesignerSidebar
                state={state}
                actions={actions}
                activeView={state.activeView}
                pcbLayersSlotRef={setPcbLayersSlot}
                pcbLayersHeaderSlotRef={setPcbLayersHeaderSlot}
                pcbComponentsSlotRef={setPcbComponentsSlot}
                pcbComponentCount={pcbComponentCount}
                threeDSlotRef={setThreeDSlot}
                onPlaceComponent={openComponentPalette}
                onAddNetLabel={() =>
                  canvasRef.current?.armPrimitive("net_portal")
                }
                onBrowseLibrary={() => navigateToModule("library")}
                onFrameBoundsMm={(bounds) =>
                  canvasRef.current?.frameToBoundsMm(bounds)
                }
                onSelectOnCanvas={handleOutlineSelect}
              />
            </div>

            <div
              className="group relative w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-selection"
              onPointerDown={startResize}
              role="separator"
              aria-orientation="vertical"
            >
              <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
            </div>
          </>
        ) : null}

        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {noTabsOpen ? (
            <DesignerEmptyState
              designs={state.designs}
              creatingDesign={state.creatingDesign}
              onCreate={() => void handleCreateDesign()}
              onOpen={handleOpenFromEmptyState}
            />
          ) : state.activeView === "schem" ? (
            <>
              {canvasContent()}
              {state.projection ? (
                <CanvasZoomCluster
                  onZoomIn={() => canvasRef.current?.zoomIn()}
                  onZoomOut={() => canvasRef.current?.zoomOut()}
                  onFit={() => canvasRef.current?.fit()}
                />
              ) : null}
            </>
          ) : state.activeView === "pcb" ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="relative min-h-0 flex-1">
                <PcbCanvas
                  backendURL={backendURL}
                  moduleId={moduleId}
                  designId={state.selectedDesignId}
                  gridVisible={false}
                  cloudHeaders={autoLayoutCloudHeaders}
                  autoLayoutEnabled={autoLayoutEnabled}
                  autoLayoutSignedIn={autoLayoutSignedIn}
                  dispatchCommand={actions.dispatchCommand}
                  notifyExternalRevisionBump={
                    actions.notifyExternalRevisionBump
                  }
                  onDrcCountChange={setPcbLiveDrc}
                  onSelectionCountChange={setPcbSelectionCount}
                  commentThreads={comments.threads}
                  activeCommentThreadId={comments.activeThreadId}
                  commentMode={comments.commentMode}
                  currentUserEmail={user?.email ?? null}
                  onCreateComment={(anchor, body) =>
                    void comments.createThread(anchor, body)
                  }
                  onSelectCommentThread={(threadId) =>
                    void comments.loadThread(threadId)
                  }
                  onCloseCommentThread={() => comments.setActiveThreadId(null)}
                  onToggleCommentMode={() =>
                    comments.setCommentMode(!comments.commentMode)
                  }
                  onAddCommentMessage={async (thread, body, file) => {
                    await comments.addMessage(thread, body, file);
                  }}
                  onSetCommentStatus={async (thread, status) => {
                    await comments.setStatus(thread, status);
                  }}
                  onSetCommentTodoStatus={async (thread, todoStatus) => {
                    await comments.setTodoStatus(thread, todoStatus);
                  }}
                  onToggleCommentReaction={async (thread, messageId, emoji) => {
                    await comments.toggleReaction(thread, messageId, emoji);
                  }}
                  onMoveComment={(thread, pointNm) =>
                    void comments.setAnchor(thread, pointNm)
                  }
                  commentAttachmentUrl={comments.attachmentUrl}
                  layersPanelTarget={pcbLayersSlot}
                  layersHeaderTarget={pcbLayersHeaderSlot}
                  componentsPanelTarget={pcbComponentsSlot}
                  partValues={partValues}
                  toolbarTarget={pcbToolbarSlot}
                  paramRowTarget={pcbParamRowSlot}
                  layerStripTarget={pcbLayerStripSlot}
                  propertiesTarget={pcbPropertiesSlot}
                  onCursorChange={setPcbCursorPoint}
                  onActiveLayerChange={setPcbActiveLayer}
                  onHintChange={setPcbHint}
                  onSelectionSummaryChange={setPcbSelectionSummary}
                  onPlacementCountChange={setPcbComponentCount}
                  selectionRequest={pcbSelectionRequest}
                  initialViewport={
                    state.selectedDesignId
                      ? (viewportRef.current.get(
                          `pcb:${state.selectedDesignId}`,
                        ) ?? null)
                      : null
                  }
                  onViewportChange={onPcbViewportChange}
                />
              </div>
              {/* PcbCanvas portals the layer tab strip here. */}
              <div ref={setPcbLayerStripSlot} className="shrink-0" />
            </div>
          ) : state.activeView === "3d" ? (
            <Board3DCanvas
              backendURL={backendURL}
              moduleId={moduleId}
              selectedDesignId={state.selectedDesignId}
              error={state.error}
              controlsTarget={threeDSlot}
            />
          ) : state.activeView === "bom" ? (
            <DesignerBomView
              backendURL={backendURL}
              moduleId={moduleId}
              designId={state.selectedDesignId}
              revision={state.projection?.revision ?? null}
              onShowSchematic={handleBomShowSchematic}
              onShowPcb={handleBomShowPcb}
            />
          ) : state.activeView === "drc" ? (
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <DesignerDrcView
                backendURL={backendURL}
                moduleId={moduleId}
                designId={state.selectedDesignId}
                revision={state.projection?.revision ?? null}
                onShowViolation={() => actions.setActiveView("pcb")}
              />
            </div>
          ) : (
            <DesignerPlaceholderView view={state.activeView} />
          )}
        </div>

        {dockVisible ? (
          <DesignerRightDock
            tabs={dockTabs}
            activeTab={activeDockTab}
            onTabChange={setDockTab}
            width={clampDockWidth(dockWidth)}
            onResizeStart={startDockResize}
          >
            {activeDockTab === "properties" && state.activeView === "pcb" ? (
              // PcbCanvas portals PcbPropertiesPanel into this slot.
              <div
                ref={setPcbPropertiesSlot}
                className="min-h-0 flex-1 overflow-y-auto"
              />
            ) : null}
            {activeDockTab === "properties" &&
            state.activeView === "schem" &&
            state.projection ? (
              <SelectionInspectorMount
                projection={state.projection}
                state={state}
                resolvePlacement={actions.resolvePlacement}
                dispatchCommand={actions.dispatchCommand}
                setError={actions.setError}
                onCrossProbePcb={handleCrossProbePcb}
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
            {activeDockTab === "erc" && state.activeView === "schem" ? (
              <DesignerErcView
                backendURL={backendURL}
                moduleId={moduleId}
                designId={state.selectedDesignId}
                projection={state.projection ?? null}
                onSelectOnCanvas={handleOutlineSelect}
                onFrameBoundsMm={(bounds) =>
                  canvasRef.current?.frameToBoundsMm(bounds)
                }
                onClose={() => setDockOpen(false)}
              />
            ) : null}
            {activeDockTab === "drc" ? (
              <DesignerDrcView
                backendURL={backendURL}
                moduleId={moduleId}
                designId={state.selectedDesignId}
                revision={state.projection?.revision ?? null}
                onShowViolation={() => {
                  /* already on PCB — centering flows through the DRC store */
                }}
                onClose={() => setDockOpen(false)}
              />
            ) : null}
            {activeDockTab === "assistant" ? (
              <DesignerChatDock
                backendURL={backendURL}
                designId={state.selectedDesignId}
                designName={activeDesign?.name ?? null}
                designRevision={activeDesign?.revision ?? null}
                onClose={() => setDockOpen(false)}
                onOpenFull={(chatId) =>
                  navigateToModule("assistant", undefined, { chatId })
                }
                onDesignChanged={handleAssistantDesignChanged}
              />
            ) : null}
          </DesignerRightDock>
        ) : null}
      </div>

      {!noTabsOpen && state.activeView === "pcb" ? (
        <DesignerStatusBar
          showCursor
          zoom={zoomPercent}
          activeLayer={pcbActiveLayer}
          hint={pcbHint}
          selection={pcbSelectionSummary}
          drcCount={
            pcbLiveDrc ??
            (drcSummary ? drcSummary.errors + drcSummary.warnings : 0)
          }
          onDrcClick={() => setDrcPanelOpen(true)}
          viewSide={pcbViewSide}
        />
      ) : null}
      {!noTabsOpen && state.activeView === "drc" ? (
        <DesignerStatusBar
          zoom={zoomPercent}
          hint=""
          selection="—"
          drcCount={drcSummary ? drcSummary.errors + drcSummary.warnings : 0}
          onDrcClick={() => {
            actions.setActiveView("pcb");
            setDrcPanelOpen(true);
          }}
        />
      ) : null}
      {!noTabsOpen && state.activeView === "schem" ? (
        <DesignerStatusBar
          showCursor
          cursorSource="schematic"
          zoom={zoomPercent}
          hint={schemHint}
          selection={selectionSummary}
          drcCount={ercReport ? ercCount : undefined}
          drcLabel="ERC"
          drcTitle="Electrical rule violations"
          onDrcClick={handleToggleErcDock}
        />
      ) : null}

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
      {/* Radix tooltips throw without a provider; the shared IconButton wraps
          itself in one, so the whole designer needs this in scope. */}
      <TooltipProvider delayDuration={300}>
        <DesignerSpaceInner {...props} />
      </TooltipProvider>
    </ToastProvider>
  );
}
