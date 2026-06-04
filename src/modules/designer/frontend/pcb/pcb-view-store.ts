import { create } from "zustand";
import type {
  DesignerCommand,
  DesignerDispatchResult,
  DrcRuleClass,
  PcbCopperLayerId,
  PcbDisplayMode,
  PcbLayerId,
  PcbLayerPreset,
  PcbViewSide,
  PcbViewState,
} from "../../../../sdks";
import {
  PCB_LAYER_PRESETS,
  detectLayerPreset,
} from "../../../../shared/frontend/canvas/layers";

/**
 * Unified PCB view store. Replaces the fragmented localStorage hooks that
 * previously held viewSide / displayMode / copperFillLayers. The store is
 * the single source of truth for the panel + scene; mutations dispatch a
 * debounced `pcb_set_view_state` command so the backend `board_settings`
 * row stays in sync (per-design durability).
 *
 *  - The store carries one `viewState` object plus ephemeral hover/cursor
 *    fields. Backend hydrate happens through `hydrateFromProjection`.
 *  - Mutation actions optimistically update local state and schedule a
 *    debounced backend write. The flush window is small (200ms) so single
 *    clicks land near-instantly while slider drags coalesce.
 *  - Active layer + visibleLayers stay on `PcbBoardSettings` directly (not
 *    in viewState) because they affect routing/connectivity, not just
 *    display. The store exposes mirrors so the panel can read them in one
 *    place; setters fall through to dedicated commands.
 */

const DEFAULT_VIEW_STATE: PcbViewState = {
  displayMode: "normal",
  viewSide: "top",
  copperFillLayers: [],
  copperFillPourNetIds: {},
  perLayerOpacity: {},
  layerPreset: "custom",
  ratsnestVisible: true,
  alignmentGuidesVisible: true,
  drcIgnoredRuleClasses: [],
  drcWaivedViolationIds: [],
};

const DEBOUNCE_MS = 200;

type CommandDispatcher = (
  command: DesignerCommand,
) => Promise<DesignerDispatchResult>;

interface PcbViewStoreState {
  /** Loaded design id; null when no design is active. */
  designId: string | null;
  /** Persisted display state mirrored from `board_settings.viewState`. */
  viewState: PcbViewState;
  /** Active routing layer (mirror from `board_settings.activeLayer`). */
  activeLayer: PcbLayerId | null;
  /** Visible layer list (mirror from `board_settings.visibleLayers`). */
  visibleLayers: PcbLayerId[];
  /**
   * Row-level solo target. Distinct from `viewState.displayMode === "solo"`
   * (which is the global non-active dimming). Solo here means "show ONLY
   * this layer + the always-on chrome layers". Alt+click a row to enter;
   * alt+click the same row again to exit.
   */
  soloLayer: PcbLayerId | null;
  /** visibleLayers snapshot taken when solo entered; restored on exit. */
  preSoloVisible: PcbLayerId[] | null;
  /** activeLayer snapshot taken when solo entered. */
  preSoloActive: PcbLayerId | null;
  /**
   * Per primitive-kind selection filter. When false, that kind is excluded
   * from both click selection AND marquee selection. Ephemeral (not
   * persisted) — KiCad treats this as a per-session interaction setting.
   */
  selectionFilter: {
    traces: boolean;
    vias: boolean;
    pads: boolean;
    placements: boolean;
  };
  /** Whether the floating selection-filter panel is visible (F toggles). */
  selectionFilterPanelOpen: boolean;
  /** Hover cursor world position (mm). Ephemeral. */
  cursorMm: { x: number; y: number } | null;
}

interface PcbViewStoreActions {
  /** Replace store from a freshly loaded projection. Idempotent. */
  hydrateFromProjection(input: {
    designId: string;
    viewState: PcbViewState | undefined;
    activeLayer: PcbLayerId;
    visibleLayers: PcbLayerId[];
  }): void;
  /** Wire the command dispatcher used by every persisting setter. */
  setDispatcher(dispatch: CommandDispatcher | null): void;
  /** Flush any pending debounced writes (e.g. on unmount or design switch). */
  flush(): Promise<void>;

  setViewSide(side: PcbViewSide): void;
  toggleViewSide(): void;
  setDisplayMode(mode: PcbDisplayMode): void;
  cycleDisplayMode(): void;
  setRatsnestVisible(visible: boolean): void;
  toggleRatsnestVisible(): void;
  setAlignmentGuidesVisible(visible: boolean): void;
  toggleAlignmentGuidesVisible(): void;
  setCopperFillLayers(layers: ReadonlyArray<PcbCopperLayerId>): void;
  toggleCopperFillLayer(layer: PcbCopperLayerId): void;
  setCopperFillPourNet(layer: PcbCopperLayerId, netId: string | null): void;
  setLayerOpacity(layer: PcbLayerId, opacity: number): void;
  setLayerPreset(preset: PcbLayerPreset): void;
  /**
   * Toggle row-level solo for a layer. Alt+click handler. When entering,
   * snapshots current visibleLayers + activeLayer; visible set is replaced
   * with [layer + chrome] and the layer becomes active if activatable.
   * Calling on the same layer again restores the snapshot.
   */
  toggleSoloLayer(layer: PcbLayerId, isActivatable: boolean): void;
  /** Exit solo mode without toggling (called when user changes visibility manually). */
  exitSolo(): void;
  setSelectionFilter(
    kind: "traces" | "vias" | "pads" | "placements",
    enabled: boolean,
  ): void;
  toggleSelectionFilterPanel(): void;
  setCursorMm(point: { x: number; y: number } | null): void;
  /** Ignore / un-ignore a whole DRC rule-class (persisted on viewState). */
  setDrcRuleClassIgnored(ruleClass: DrcRuleClass, ignored: boolean): void;
  /** Toggle a single DRC violation's waiver by its stable id (persisted). */
  toggleDrcWaived(violationId: string): void;
}

type Store = PcbViewStoreState & PcbViewStoreActions;

// Dispatcher + debounce timer live outside the React store so swapping the
// designId doesn't require remounting. The store closes over them via
// setDispatcher / flush.
let dispatcherRef: CommandDispatcher | null = null;
let pendingPatch: Partial<PcbViewState> = {};
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPromise: Promise<void> | null = null;

// Tracks which viewState fields have an unflushed local change. While a
// field is pending, `hydrateFromProjection` keeps the local value so we
// don't clobber the user's optimistic edit with a stale projection read
// that arrived before the debounced `pcb_set_view_state` flushed.
const pendingFields = new Set<keyof PcbViewState>();

function scheduleFlush(): Promise<void> {
  if (pendingPromise) return pendingPromise;
  pendingPromise = new Promise((resolve) => {
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      const patch = pendingPatch;
      pendingPatch = {};
      const fieldsBeingFlushed = new Set(pendingFields);
      pendingPromise = null;
      const dispatch = dispatcherRef;
      if (!dispatch || Object.keys(patch).length === 0) {
        for (const f of fieldsBeingFlushed) pendingFields.delete(f);
        resolve();
        return;
      }
      void dispatch({ type: "pcb_set_view_state", patch }).then(
        () => {
          for (const f of fieldsBeingFlushed) pendingFields.delete(f);
          resolve();
        },
        () => {
          for (const f of fieldsBeingFlushed) pendingFields.delete(f);
          resolve();
        },
      );
    }, DEBOUNCE_MS);
  });
  return pendingPromise;
}

function persistPatch(patch: Partial<PcbViewState>): void {
  pendingPatch = { ...pendingPatch, ...patch };
  for (const field of Object.keys(patch) as Array<keyof PcbViewState>) {
    pendingFields.add(field);
  }
  void scheduleFlush();
}

export const usePcbViewStore = create<Store>((set, get) => ({
  designId: null,
  viewState: DEFAULT_VIEW_STATE,
  activeLayer: null,
  visibleLayers: [],
  soloLayer: null,
  preSoloVisible: null,
  preSoloActive: null,
  selectionFilter: {
    traces: true,
    vias: true,
    pads: true,
    placements: true,
  },
  selectionFilterPanelOpen: false,
  cursorMm: null,

  hydrateFromProjection({ designId, viewState, activeLayer, visibleLayers }) {
    const incoming = viewState ?? DEFAULT_VIEW_STATE;
    // Preserve any field with an unflushed local change so the user's
    // optimistic edit isn't reverted by a projection refresh that
    // happened to land between local mutation and debounced persistence.
    const current = get().viewState;
    const merged: PcbViewState = { ...incoming };
    for (const field of pendingFields) {
      (merged as unknown as Record<string, unknown>)[field] = (
        current as unknown as Record<string, unknown>
      )[field];
    }
    set({
      designId,
      viewState: merged,
      activeLayer,
      visibleLayers: [...visibleLayers],
    });
  },

  setDispatcher(dispatch) {
    dispatcherRef = dispatch;
  },

  async flush() {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    const patch = pendingPatch;
    pendingPatch = {};
    pendingPromise = null;
    const fieldsBeingFlushed = new Set(pendingFields);
    for (const f of fieldsBeingFlushed) pendingFields.delete(f);
    const dispatch = dispatcherRef;
    if (!dispatch || Object.keys(patch).length === 0) return;
    await dispatch({ type: "pcb_set_view_state", patch });
  },

  setViewSide(side) {
    if (get().viewState.viewSide === side) return;
    set((s) => ({ viewState: { ...s.viewState, viewSide: side } }));
    persistPatch({ viewSide: side });
  },

  toggleViewSide() {
    const current = get().viewState.viewSide;
    get().setViewSide(current === "top" ? "bottom" : "top");
  },

  setDisplayMode(mode) {
    if (get().viewState.displayMode === mode) return;
    set((s) => ({ viewState: { ...s.viewState, displayMode: mode } }));
    persistPatch({ displayMode: mode });
  },

  cycleDisplayMode() {
    const mode = get().viewState.displayMode;
    const next: PcbDisplayMode =
      mode === "normal" ? "dim" : mode === "dim" ? "solo" : "normal";
    get().setDisplayMode(next);
  },

  setRatsnestVisible(visible) {
    if (get().viewState.ratsnestVisible === visible) return;
    set((s) => ({ viewState: { ...s.viewState, ratsnestVisible: visible } }));
    persistPatch({ ratsnestVisible: visible });
  },

  toggleRatsnestVisible() {
    get().setRatsnestVisible(!get().viewState.ratsnestVisible);
  },

  setAlignmentGuidesVisible(visible) {
    if ((get().viewState.alignmentGuidesVisible ?? true) === visible) return;
    set((s) => ({
      viewState: { ...s.viewState, alignmentGuidesVisible: visible },
    }));
    persistPatch({ alignmentGuidesVisible: visible });
  },

  toggleAlignmentGuidesVisible() {
    get().setAlignmentGuidesVisible(
      !(get().viewState.alignmentGuidesVisible ?? true),
    );
  },

  setCopperFillLayers(layers) {
    const seen = new Set<PcbCopperLayerId>();
    const next: PcbCopperLayerId[] = [];
    for (const id of layers) {
      if (!seen.has(id)) {
        seen.add(id);
        next.push(id);
      }
    }
    set((s) => ({ viewState: { ...s.viewState, copperFillLayers: next } }));
    persistPatch({ copperFillLayers: next });
  },

  toggleCopperFillLayer(layer) {
    const current = new Set(get().viewState.copperFillLayers);
    if (current.has(layer)) current.delete(layer);
    else current.add(layer);
    get().setCopperFillLayers([...current]);
  },

  setCopperFillPourNet(layer, netId) {
    const nextMap = {
      ...get().viewState.copperFillPourNetIds,
      [layer]: netId,
    };
    set((s) => ({
      viewState: { ...s.viewState, copperFillPourNetIds: nextMap },
    }));
    persistPatch({ copperFillPourNetIds: { [layer]: netId } });
  },

  setLayerOpacity(layer, opacity) {
    const clamped = Math.max(0, Math.min(1, opacity));
    const nextMap = {
      ...get().viewState.perLayerOpacity,
      [layer]: clamped,
    };
    set((s) => ({
      viewState: { ...s.viewState, perLayerOpacity: nextMap },
    }));
    persistPatch({ perLayerOpacity: { [layer]: clamped } });
  },

  setLayerPreset(preset) {
    if (preset === "custom") {
      // Don't apply custom; it's a sentinel for "user-modified".
      set((s) => ({ viewState: { ...s.viewState, layerPreset: preset } }));
      persistPatch({ layerPreset: preset });
      return;
    }
    const spec = PCB_LAYER_PRESETS.find((p) => p.id === preset);
    if (!spec) return;
    const nextViewSide = spec.viewSide ?? get().viewState.viewSide;
    set((s) => ({
      viewState: {
        ...s.viewState,
        layerPreset: preset,
        viewSide: nextViewSide,
      },
      visibleLayers: [...spec.visibleLayers],
      activeLayer: spec.activeLayer ?? s.activeLayer,
    }));
    // Persist the view-state portion through the debounced channel.
    persistPatch({ layerPreset: preset, viewSide: nextViewSide });
    // visibleLayers + activeLayer dispatch is handled by the caller
    // (`PcbCanvas.onSelectLayerPreset` goes through the workspace methods
    // so projection + focusedLayer state both refresh). This setter only
    // updates the view-state portion (preset id + viewSide).
  },

  toggleSoloLayer(layer, isActivatable) {
    const state = get();
    // Toggling on the same row exits solo and restores the snapshot.
    if (state.soloLayer === layer && state.preSoloVisible) {
      const restoredVisible = state.preSoloVisible;
      const restoredActive = state.preSoloActive ?? state.activeLayer;
      set({
        soloLayer: null,
        preSoloVisible: null,
        preSoloActive: null,
        visibleLayers: [...restoredVisible],
        activeLayer: restoredActive,
      });
      return;
    }
    // Enter (or switch) solo. Snapshot the current set so a future toggle
    // restores the user's full visibility cleanly. The solo target plus
    // mandatory chrome (Edge.Cuts, Drill, Metadata) form the new visible
    // set so the user can still see the board outline + drills.
    const preSoloVisible =
      state.soloLayer === null
        ? [...state.visibleLayers]
        : state.preSoloVisible;
    const preSoloActive =
      state.soloLayer === null ? state.activeLayer : state.preSoloActive;
    const chrome: PcbLayerId[] = ["Edge.Cuts", "Drill", "Metadata"];
    const nextVisible: PcbLayerId[] = [
      layer,
      ...chrome.filter((c) => c !== layer),
    ];
    const nextActive: PcbLayerId | null = isActivatable
      ? layer
      : state.activeLayer;
    set({
      soloLayer: layer,
      preSoloVisible,
      preSoloActive,
      visibleLayers: nextVisible,
      activeLayer: nextActive,
    });
  },

  exitSolo() {
    const state = get();
    if (state.soloLayer === null) return;
    set({ soloLayer: null, preSoloVisible: null, preSoloActive: null });
  },

  setSelectionFilter(kind, enabled) {
    set((s) => ({
      selectionFilter: { ...s.selectionFilter, [kind]: enabled },
    }));
  },

  toggleSelectionFilterPanel() {
    set((s) => ({ selectionFilterPanelOpen: !s.selectionFilterPanelOpen }));
  },

  setCursorMm(point) {
    set({ cursorMm: point });
  },

  setDrcRuleClassIgnored(ruleClass, ignored) {
    const current = get().viewState.drcIgnoredRuleClasses ?? [];
    const next = ignored
      ? [...new Set([...current, ruleClass])]
      : current.filter((c) => c !== ruleClass);
    set((s) => ({
      viewState: { ...s.viewState, drcIgnoredRuleClasses: next },
    }));
    persistPatch({ drcIgnoredRuleClasses: next });
  },

  toggleDrcWaived(violationId) {
    const current = get().viewState.drcWaivedViolationIds ?? [];
    const next = current.includes(violationId)
      ? current.filter((id) => id !== violationId)
      : [...current, violationId];
    set((s) => ({
      viewState: { ...s.viewState, drcWaivedViolationIds: next },
    }));
    persistPatch({ drcWaivedViolationIds: next });
  },
}));

/**
 * Recompute `layerPreset` after an external change to `visibleLayers` (e.g.
 * from the panel's per-row eye toggle dispatch). Keeps the chip in sync.
 */
export function syncLayerPresetFromVisible(): void {
  const { visibleLayers, viewState } = usePcbViewStore.getState();
  const detected = detectLayerPreset(visibleLayers);
  if (detected !== viewState.layerPreset) {
    usePcbViewStore.setState((s) => ({
      viewState: { ...s.viewState, layerPreset: detected },
    }));
    persistPatch({ layerPreset: detected });
  }
}
