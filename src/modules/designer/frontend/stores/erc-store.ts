import { create } from "zustand";
import type { ErcReport } from "../../../../sdks";

/**
 * Transient ERC report store, modelled on `pcb/drc/drc-store` minus the
 * canvas-marker bookkeeping (centre requests, hover, waivers) — the schematic
 * has no ERC markers, only a dock list.
 *
 * The backend computes ERC on demand from the schematic projection and
 * persists nothing, so there is no hydrate-on-open path: the view runs it when
 * the tab first opens for a design, and `clear()` runs on design change.
 *
 * Violations carry no id, so the focused row is addressed by index into
 * `report.violations`.
 */
interface ErcStoreState {
  report: ErcReport | null;
  running: boolean;
  error: string | null;
  /** Kept as history while a replacement run is pending or unavailable. */
  reportIsPrevious: boolean;
  /** Index into `report.violations`, or null when nothing is focused. */
  selectedIndex: number | null;
}

interface ErcStoreActions {
  /** Run ERC via the supplied runner (wired to `api.runErc`). */
  run(runner: () => Promise<ErcReport | null>, designId?: string): Promise<void>;
  setReport(report: ErcReport | null): void;
  select(index: number | null): void;
  clear(): void;
}

/** Errors + warnings — the number the dock badge and status bar show. */
export function ercIssueCount(report: ErcReport | null): number {
  if (!report) return 0;
  return report.summary.errors + report.summary.warnings;
}

export const useErcStore = create<ErcStoreState & ErcStoreActions>(
  (set, get) => {
    // Clearing or replacing a report invalidates requests for the previous view.
    let generation = 0;
    return {
      report: null,
      running: false,
      error: null,
      reportIsPrevious: false,
      selectedIndex: null,

      async run(runner, designId) {
        if (get().running) return;
        const requestGeneration = ++generation;
        set({
          running: true,
          error: null,
          reportIsPrevious: get().report !== null,
        });
        try {
          const report = await runner();
          if (requestGeneration !== generation) return;
          if (!report) throw new Error("ERC report unavailable");
          if (designId && report.designId !== designId) {
            throw new Error("ERC report does not match the requested design");
          }
          set({
            report,
            running: false,
            reportIsPrevious: false,
            selectedIndex: null,
          });
        } catch (err) {
          if (requestGeneration !== generation) return;
          set({
            running: false,
            error: err instanceof Error ? err.message : "ERC failed",
          });
        }
      },

      setReport(report) {
        generation += 1;
        set({
          report,
          running: false,
          error: null,
          reportIsPrevious: false,
          selectedIndex: null,
        });
      },

      select(index) {
        set({ selectedIndex: index });
      },

      clear() {
        generation += 1;
        set({
          report: null,
          running: false,
          error: null,
          reportIsPrevious: false,
          selectedIndex: null,
        });
      },
    };
  },
);
