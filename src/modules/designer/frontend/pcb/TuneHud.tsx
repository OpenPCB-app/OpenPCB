import { useEffect, useRef, type ReactElement } from "react";
import { PcbParamRow } from "./PcbTopToolbar";
import type { TuneHudModel } from "./tools/tune-hud-model";

interface TuneHudProps {
  /** Null while the Tune tool is idle (no trace picked yet). */
  model: TuneHudModel | null;
  /**
   * Commit-gate refusal (live-parity contract 07 §8) — the reshape was blocked
   * by the live gate, or by the server after it. Null when the last commit was
   * clean.
   */
  notice?: string | null;
  /** Shared with the route tool's DRC override; `report` instead of `refuse`. */
  allowDrcViolations?: boolean;
  onToggleAllowDrcViolations?: () => void;
  /** Inline typed-target editor (the anti-KiCad-v8 in-tool override). */
  targetInputOpen: boolean;
  onOpenTargetInput: () => void;
  onTargetInputSubmit: (targetMm: number) => void;
  onTargetInputClose: () => void;
  onClearTargetOverride: () => void;
}

const BAND_CLASS: Record<NonNullable<TuneHudModel["band"]>, string> = {
  short: "font-medium text-status-warning",
  ok: "font-medium text-status-success",
  long: "font-medium text-status-danger",
};

/**
 * Parameter-row content for the length-Tune tool: which net, current vs target
 * length with tolerance-band colour, serpentine parameters, and the key map.
 */
export function TuneHud({
  model,
  notice = null,
  allowDrcViolations = false,
  onToggleAllowDrcViolations,
  targetInputOpen,
  onOpenTargetInput,
  onTargetInputSubmit,
  onTargetInputClose,
  onClearTargetOverride,
}: TuneHudProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (targetInputOpen) inputRef.current?.select();
  }, [targetInputOpen]);

  if (!model) {
    return (
      <PcbParamRow>
        <span className="shrink-0 font-sans font-medium text-text-strong">
          Tune
        </span>
        <span
          role="status"
          aria-label="Tune tool"
          className="truncate font-sans text-text-tertiary"
        >
          Tune — click a routed trace to add serpentine length · Esc exit
        </span>
      </PcbParamRow>
    );
  }

  return (
    <>
      <PcbParamRow>
        <span className="shrink-0 font-sans font-medium text-text-strong">
          Tune
        </span>
        <span
          role="region"
          aria-label="Tune status"
          className="flex min-w-0 flex-1 items-center gap-2.5"
        >
          <span className="font-medium text-text-strong">
            {model.netName ?? "no net"}
          </span>
          <span
            className={model.band ? BAND_CLASS[model.band] : "text-text-tertiary"}
          >
            {model.currentMm.toFixed(2)}
            {model.targetMm !== null ? ` / ${model.targetMm.toFixed(2)}` : ""} mm
          </span>
          {model.band ? (
            <span className="text-text-disabled">
              {model.band === "ok"
                ? "in tolerance"
                : model.band === "short"
                  ? `${Math.abs(model.deltaMm ?? 0).toFixed(2)} mm short`
                  : `${Math.abs(model.deltaMm ?? 0).toFixed(2)} mm over`}
            </span>
          ) : null}
          {targetInputOpen ? (
            <input
              ref={inputRef}
              type="number"
              step={0.1}
              min={0.1}
              defaultValue={model.targetMm ?? undefined}
              aria-label="Target length (mm)"
              className="h-[20px] w-20 rounded-control border border-border-control bg-surface-input px-1 text-2xs text-text-strong outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const next = Number(e.currentTarget.value);
                  if (Number.isFinite(next) && next > 0) {
                    onTargetInputSubmit(next);
                  }
                  onTargetInputClose();
                  e.stopPropagation();
                }
                if (e.key === "Escape") {
                  onTargetInputClose();
                  e.stopPropagation();
                }
              }}
              onBlur={onTargetInputClose}
            />
          ) : (
            <button
              type="button"
              className="rounded-control px-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-strong"
              title="Type a target length (overrides the group rule)"
              onClick={onOpenTargetInput}
            >
              {model.targetSource === "override"
                ? "target: typed"
                : model.targetSource === "group"
                  ? `target: '${model.groupName}'`
                  : "set target…"}
            </button>
          )}
          {model.targetSource === "override" ? (
            <button
              type="button"
              className="rounded-control px-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-strong"
              title="Clear the typed target"
              onClick={onClearTargetOverride}
            >
              ×
            </button>
          ) : null}
          <span className="text-text-tertiary">
            A {model.amplitudeMm.toFixed(2)} · pitch {model.spacingMm.toFixed(2)}
          </span>
          {model.meanderStatus === "too-short" ? (
            <span className="text-status-warning">
              span too small for target — extend the sweep or raise amplitude
            </span>
          ) : null}
          {model.meanderStatus === "span-too-small" ? (
            <span className="text-status-warning">
              sweep along the trace to place serpentines
            </span>
          ) : null}
          {model.meanderStatus === "target-met" ? (
            <span className="text-status-success">
              already at target — nothing to add
            </span>
          ) : null}
          {model.meanderStatus === "blocked" ? (
            <span className="text-status-warning">
              keep-outs block serpentines here — sweep another span or lower
              amplitude
            </span>
          ) : null}
        </span>
      </PcbParamRow>
      {notice ? (
        <PcbParamRow className="text-status-danger">
          <span role="alert">{notice}</span>
          {onToggleAllowDrcViolations && !allowDrcViolations ? (
            <button
              type="button"
              className="cursor-pointer rounded-control px-1 underline decoration-dotted"
              onClick={onToggleAllowDrcViolations}
            >
              allow violations
            </button>
          ) : null}
        </PcbParamRow>
      ) : null}
      <PcbParamRow className="text-text-disabled">
        <span>
          <kbd className="font-sans">drag</kbd> paint span
        </span>
        <span>
          <kbd className="font-sans">click</kbd> freeze
        </span>
        <span>
          <kbd className="font-sans">+/-</kbd> amplitude
        </span>
        <span>
          <kbd className="font-sans">,/.</kbd> pitch
        </span>
        <span className={model.canApply ? "" : "opacity-40"}>
          <kbd className="font-sans">Enter</kbd> apply
        </span>
        <span>
          <kbd className="font-sans">Esc</kbd> cancel
        </span>
      </PcbParamRow>
    </>
  );
}
