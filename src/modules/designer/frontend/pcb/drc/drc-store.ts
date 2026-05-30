import { create } from "zustand";
import type { DrcReport } from "../../../../../sdks";

/**
 * Transient batch-DRC report store. The report is recomputed on demand ("Run
 * DRC"); it is NOT persisted (the engine recomputes from the projection each
 * run). Waivers / ignored rule-classes live on the persisted `PcbViewState`
 * (see `usePcbViewStore`), so they survive reload and feed the server-side
 * engine on the next run.
 *
 * `panelOpen` is transient UI for the PCB-tab DRC dock (toggled by the toolbar
 * button + status-bar chip). It lives here — not prop-drilled — because the
 * toggle is driven from both inside `PcbCanvas` (toolbar) and `Space` (dock /
 * status bar). It is session-only (not persisted) and is deliberately left out
 * of `clear()` so the open/closed preference survives a design switch.
 */
interface DrcStoreState {
  report: DrcReport | null;
  running: boolean;
  error: string | null;
  /** Currently focused violation id (panel ↔ canvas marker highlight). */
  selectedId: string | null;
  /** Hovered violation id (canvas marker hover ↔ trace highlight + tooltip). */
  hoveredId: string | null;
  lastRunAt: number | null;
  /**
   * Cross-tab request to center the PCB camera on a point (mm). The DRC tab
   * sets this on row-click; `DrcCenterOnRequest` (inside the PCB canvas)
   * consumes it. `seq` lets the consumer detect repeated requests for the
   * same point.
   */
  centerRequest: { x: number; y: number; seq: number } | null;
  /**
   * Highest `centerRequest.seq` the PCB canvas has already centered on. Held in
   * the store (not a component ref) so switching away from and back to the PCB
   * tab — which remounts the canvas — does not re-center on a stale request.
   */
  centeredSeq: number;
  /** Whether the in-PCB-tab DRC dock is open. Transient UI; not persisted. */
  panelOpen: boolean;
  /**
   * Whether DRC violation markers are drawn on the canvas. Lets the user
   * declutter (e.g. while routing, before DRC matters). Transient UI; default
   * shown, resets to shown on reload so errors are never silently hidden.
   */
  markersVisible: boolean;
}

interface DrcStoreActions {
  /** Run DRC via the supplied runner (wired to `api.runDrc`, which persists). */
  run(runner: () => Promise<DrcReport | null>): Promise<void>;
  /** Quietly set the report (e.g. hydrate from the persisted GET on open). */
  setReport(report: DrcReport | null): void;
  select(id: string | null): void;
  /** Set the hovered violation (canvas marker hover). */
  setHovered(id: string | null): void;
  /** Ask the PCB canvas to center on a board-space point (mm). */
  requestCenter(point: { x: number; y: number }): void;
  /** Canvas calls this once it has centered on the given request seq. */
  markCentered(seq: number): void;
  /** Open/close the in-PCB-tab DRC dock. */
  setPanelOpen(open: boolean): void;
  togglePanel(): void;
  /** Show/hide DRC violation markers on the canvas. */
  setMarkersVisible(visible: boolean): void;
  toggleMarkersVisible(): void;
  clear(): void;
}

export const useDrcStore = create<DrcStoreState & DrcStoreActions>(
  (set, get) => ({
    report: null,
    running: false,
    error: null,
    selectedId: null,
    hoveredId: null,
    lastRunAt: null,
    centerRequest: null,
    centeredSeq: 0,
    panelOpen: false,
    markersVisible: true,

    async run(runner) {
      if (get().running) return;
      set({ running: true, error: null });
      try {
        const report = await runner();
        set({ report, running: false, lastRunAt: Date.now() });
      } catch (err) {
        set({
          running: false,
          error: err instanceof Error ? err.message : "DRC failed",
        });
      }
    },

    setReport(report) {
      set({ report });
    },

    select(id) {
      set({ selectedId: id });
    },

    setHovered(id) {
      set({ hoveredId: id });
    },

    requestCenter(point) {
      const seq = (get().centerRequest?.seq ?? 0) + 1;
      set({ centerRequest: { x: point.x, y: point.y, seq } });
    },

    markCentered(seq) {
      set({ centeredSeq: seq });
    },

    setPanelOpen(open) {
      set({ panelOpen: open });
    },

    togglePanel() {
      set((s) => ({ panelOpen: !s.panelOpen }));
    },

    setMarkersVisible(visible) {
      set({ markersVisible: visible });
    },

    toggleMarkersVisible() {
      set((s) => ({ markersVisible: !s.markersVisible }));
    },

    // Note: `panelOpen` is intentionally NOT reset here — the dock's open/closed
    // state should survive a design switch (clear() runs on design change).
    clear() {
      set({
        report: null,
        running: false,
        error: null,
        selectedId: null,
        centerRequest: null,
        centeredSeq: 0,
      });
    },
  }),
);
