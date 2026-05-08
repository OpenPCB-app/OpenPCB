import { useCallback, useMemo, useRef, useState } from "react";
import type { BoundsMm, PointMm } from "../../../../shared/rendering/types";
import { computeAabbFromPoints, isAabbNonEmpty } from "./rubber-band";
import {
  type MarqueeMode,
  type MarqueeSession,
  colorForMode,
  modeFromDirection,
} from "./marquee-types";

export interface MarqueeSelectionConfig<TSelection> {
  /** Gate the marquee (e.g. only in select tool mode). */
  readonly enabled: boolean;
  readonly cloneSelection: (s: TSelection) => TSelection;
  readonly emptySelection: () => TSelection;
  /**
   * Compute the next selection given the finished rect + mode. Caller iterates
   * its own entities and tests them against the rect with the appropriate
   * window/crossing predicate per entity type.
   */
  readonly applyMarqueeHits: (input: {
    rect: BoundsMm;
    mode: MarqueeMode;
    baseSelection: TSelection;
  }) => TSelection;
  readonly setSelection: (next: TSelection) => void;
  /** Snapshot current selection for additive base. */
  readonly getSelection: () => TSelection;
}

export interface MarqueeSelectionApi<TSelection> {
  readonly marqueeSession: MarqueeSession<TSelection> | null;
  readonly beginMarquee: (startMm: PointMm, additive: boolean) => void;
  readonly updateMarqueeCursor: (currentMm: PointMm) => void;
  readonly finishMarquee: () => void;
  readonly cancelMarquee: () => void;
  readonly overlayProps: {
    a: PointMm | null;
    b: PointMm | null;
    color: string;
  };
}

/**
 * Generic marquee/rubber-band selection state machine. Both Schematic and PCB
 * canvases use this hook for identical UX:
 *
 *  - Drag L→R (start.x ≤ current.x) → "window" mode (full enclosure, blue).
 *  - Drag R→L → "crossing" mode (any overlap, green).
 *  - Shift held at pointerDown → additive merge with prior selection.
 *  - Click without drag (zero-size rect) → clears selection (or no-op if shift).
 *  - Escape → cancelMarquee restores the prior selection.
 */
export function useMarqueeSelection<TSelection>(
  config: MarqueeSelectionConfig<TSelection>,
): MarqueeSelectionApi<TSelection> {
  const [session, setSession] = useState<MarqueeSession<TSelection> | null>(
    null,
  );
  // Refs so the callbacks below stay stable while still picking up the latest
  // config (caller-owned applyMarqueeHits/setSelection/getSelection capture
  // fresh state via closure on every render).
  const configRef = useRef(config);
  configRef.current = config;

  const beginMarquee = useCallback(
    (startMm: PointMm, additive: boolean): void => {
      const cfg = configRef.current;
      if (!cfg.enabled) return;
      setSession({
        startMm,
        currentMm: startMm,
        additive,
        baseSelection: cfg.cloneSelection(cfg.getSelection()),
        mode: "window",
      });
    },
    [],
  );

  const updateMarqueeCursor = useCallback((currentMm: PointMm): void => {
    setSession((prev) => {
      if (!prev) return prev;
      const mode = modeFromDirection(prev.startMm, currentMm);
      if (
        prev.currentMm.x === currentMm.x &&
        prev.currentMm.y === currentMm.y &&
        prev.mode === mode
      ) {
        return prev;
      }
      return { ...prev, currentMm, mode };
    });
  }, []);

  const finishMarquee = useCallback((): void => {
    setSession((prev) => {
      if (!prev) return prev;
      const cfg = configRef.current;
      const rect = computeAabbFromPoints(prev.startMm, prev.currentMm);
      if (isAabbNonEmpty(rect)) {
        const base = prev.additive
          ? cfg.cloneSelection(prev.baseSelection)
          : cfg.emptySelection();
        const next = cfg.applyMarqueeHits({
          rect,
          mode: prev.mode,
          baseSelection: base,
        });
        cfg.setSelection(next);
      } else {
        // Click-without-drag: non-additive clears selection; additive no-op.
        if (!prev.additive) cfg.setSelection(cfg.emptySelection());
      }
      return null;
    });
  }, []);

  const cancelMarquee = useCallback((): void => {
    setSession((prev) => {
      if (!prev) return prev;
      const cfg = configRef.current;
      cfg.setSelection(cfg.cloneSelection(prev.baseSelection));
      return null;
    });
  }, []);

  const overlayProps = useMemo(
    () => ({
      a: session?.startMm ?? null,
      b: session?.currentMm ?? null,
      color: colorForMode(session?.mode ?? "window"),
    }),
    [session],
  );

  return {
    marqueeSession: session,
    beginMarquee,
    updateMarqueeCursor,
    finishMarquee,
    cancelMarquee,
    overlayProps,
  };
}
