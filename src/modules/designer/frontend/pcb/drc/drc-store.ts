import { create } from "zustand";
import type { DrcReport } from "../../../../../sdks";

/**
 * Transient batch-DRC report store. The report is recomputed on demand ("Run
 * DRC"); it is NOT persisted (the engine recomputes from the projection each
 * run). Waivers / ignored rule-classes live on the persisted `PcbViewState`
 * (see `usePcbViewStore`), so they survive reload and feed the server-side
 * engine on the next run.
 */
interface DrcStoreState {
  report: DrcReport | null;
  running: boolean;
  error: string | null;
  /** Currently focused violation id (panel ↔ canvas marker highlight). */
  selectedId: string | null;
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
}

interface DrcStoreActions {
  /** Run DRC via the supplied runner (wired to `api.runDrc`, which persists). */
  run(runner: () => Promise<DrcReport | null>): Promise<void>;
  /** Quietly set the report (e.g. hydrate from the persisted GET on open). */
  setReport(report: DrcReport | null): void;
  select(id: string | null): void;
  /** Ask the PCB canvas to center on a board-space point (mm). */
  requestCenter(point: { x: number; y: number }): void;
  /** Canvas calls this once it has centered on the given request seq. */
  markCentered(seq: number): void;
  clear(): void;
}

export const useDrcStore = create<DrcStoreState & DrcStoreActions>(
  (set, get) => ({
    report: null,
    running: false,
    error: null,
    selectedId: null,
    lastRunAt: null,
    centerRequest: null,
    centeredSeq: 0,

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

    requestCenter(point) {
      const seq = (get().centerRequest?.seq ?? 0) + 1;
      set({ centerRequest: { x: point.x, y: point.y, seq } });
    },

    markCentered(seq) {
      set({ centeredSeq: seq });
    },

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
