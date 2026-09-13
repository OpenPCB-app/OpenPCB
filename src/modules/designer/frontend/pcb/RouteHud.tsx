import { useEffect, useRef, type ReactElement } from "react";
import { RotateCcw } from "lucide-react";
import { PcbParamRow } from "./PcbTopToolbar";
import type { RouteHudModel } from "./tools/route-hud-model";

interface RouteHudStatusProps {
  /** Null while the route tool is idle (no active session). */
  model: RouteHudModel | null;
  /** Inline custom-width editor (opened by Alt+W or clicking the width). */
  widthInputOpen: boolean;
  onOpenWidthInput: () => void;
  onWidthInputSubmit: (widthMm: number) => void;
  onWidthInputClose: () => void;
  /** Shown when widthSource !== "netclass" — one click back to the class. */
  onResetWidthToNetClass: () => void;
}

interface RouteHudRowsProps {
  model: RouteHudModel | null;
  /** Non-null after a finish attempt was blocked by the DRC commit gate. */
  blockedConflictCount: number | null;
  /** Session-scoped override: commit despite DRC conflicts. */
  allowDrcViolations: boolean;
  onToggleAllowDrcViolations: () => void;
  /** Active auto-finish proposal (dimmed path awaiting explicit accept). */
  autoFinishProposal?: { lengthMm: number; targetName: string | null } | null;
  onAcceptAutoFinish?: () => void;
  onDismissAutoFinish?: () => void;
  /** Transient auto-finish failure notice ("No clean path — route manually"). */
  autoFinishNotice?: string | null;
  /** Transient route refusal ("Via blocked by keepout ..."); nothing changed. */
  routeNotice?: string | null;
}

function formatMm(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(2);
}

const INLINE_BUTTON =
  "rounded-control border border-border-control px-1.5 text-2xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-strong";

/**
 * Live route status shown at the right end of the parameter row. Always
 * answers: which net, what width and WHY (source badge), how long so far, and
 * whether the ghost is DRC-clean. Idle shows the entry prompt.
 */
export function RouteHudStatus({
  model,
  widthInputOpen,
  onOpenWidthInput,
  onWidthInputSubmit,
  onWidthInputClose,
  onResetWidthToNetClass,
}: RouteHudStatusProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (widthInputOpen) inputRef.current?.select();
  }, [widthInputOpen]);

  if (!model) {
    return (
      <span
        role="status"
        aria-label="Route tool"
        className="truncate font-sans text-text-tertiary"
      >
        Route — click a pad to start · Esc exit
      </span>
    );
  }

  const clean = model.drcConflictCount === 0;
  const widthBadge =
    model.widthSource === "netclass"
      ? `netclass${model.netClassName ? ` '${model.netClassName}'` : ""}`
      : model.widthSource;

  return (
    <span
      role="region"
      aria-label="Route status"
      className="flex shrink-0 items-center gap-2.5"
    >
      <span className="text-text-caps">Net</span>
      <span className="font-medium text-text-strong">
        {model.netName ?? "no net"}
      </span>
      {widthInputOpen ? (
        <input
          ref={inputRef}
          type="number"
          step={0.05}
          min={0.01}
          defaultValue={model.widthMm}
          aria-label="Trace width (mm)"
          className="h-[20px] w-16 rounded-control border border-border-control bg-surface-input px-1 text-2xs text-text-strong outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const next = Number(e.currentTarget.value);
              if (Number.isFinite(next) && next > 0) {
                onWidthInputSubmit(next);
              }
              onWidthInputClose();
            }
            if (e.key === "Escape") onWidthInputClose();
          }}
          onBlur={onWidthInputClose}
        />
      ) : (
        <button
          type="button"
          className="flex items-center gap-1 rounded-control px-1 transition-colors hover:bg-surface-hover hover:text-text-strong"
          title="Set custom width (Alt+W)"
          onClick={onOpenWidthInput}
        >
          {formatMm(model.widthMm)} mm
          <span className="text-text-disabled">· {widthBadge}</span>
        </button>
      )}
      {model.widthSource !== "netclass" ? (
        <button
          type="button"
          aria-label="Reset width to net class"
          title="Reset width to net class"
          className="rounded-control p-0.5 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-strong"
          onClick={onResetWidthToNetClass}
        >
          <RotateCcw size={11} />
        </button>
      ) : null}
      {model.viaDiameterMm !== null && model.viaDrillMm !== null ? (
        <span className="text-text-tertiary">
          via {formatMm(model.viaDiameterMm)}/{formatMm(model.viaDrillMm)}
          {model.viaOverridden ? "*" : ""}
        </span>
      ) : null}
      {model.lengthTarget ? (
        <span
          title={`Length match '${model.lengthTarget.groupName}' — net total vs target ±${model.lengthTarget.toleranceMm.toFixed(2)} mm${
            model.lengthTarget.pathDefined
              ? ""
              : " (approximate: the net has no single routed path yet)"
          }`}
          className={
            Math.abs(model.lengthTarget.totalMm - model.lengthTarget.targetMm) <=
            model.lengthTarget.toleranceMm
              ? "font-medium text-status-success"
              : "font-medium text-status-warning"
          }
        >
          {model.lengthTarget.pathDefined ? "" : "≈"}
          {model.lengthTarget.totalMm.toFixed(1)} /{" "}
          {model.lengthTarget.targetMm.toFixed(1)} mm
        </span>
      ) : (
        <span className="text-text-tertiary">
          {model.lengthMm.toFixed(1)} mm
        </span>
      )}
      {model.detourActive ? (
        <span
          title="Ghost is bending around an obstacle (walkaround)"
          className="rounded-control border border-border-control px-1.5 text-2xs font-medium text-status-info"
        >
          detour
        </span>
      ) : null}
      <span
        className={
          clean
            ? "font-medium text-status-success"
            : "font-medium text-status-danger"
        }
      >
        {clean
          ? "clear"
          : `${model.drcConflictCount} conflict${model.drcConflictCount === 1 ? "" : "s"}`}
      </span>
      {model.drcWarningCount > 0 ? (
        <span
          title="Reported by DRC but never blocking (contract 07 §6)"
          className="text-text-tertiary"
        >
          {model.drcWarningCount} warning
          {model.drcWarningCount === 1 ? "" : "s"}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Secondary 28px parameter rows: the auto-finish proposal, the DRC commit-gate
 * warning / override banner, and the key-hint row. Rendered under the route
 * parameter row inside the same portal.
 */
export function RouteHudRows({
  model,
  blockedConflictCount,
  allowDrcViolations,
  onToggleAllowDrcViolations,
  autoFinishProposal = null,
  onAcceptAutoFinish,
  onDismissAutoFinish,
  autoFinishNotice = null,
  routeNotice = null,
}: RouteHudRowsProps): ReactElement | null {
  const hints = model?.hints ?? [];
  const hasRows =
    autoFinishProposal !== null ||
    autoFinishNotice !== null ||
    routeNotice !== null ||
    (blockedConflictCount !== null && !allowDrcViolations) ||
    allowDrcViolations ||
    hints.length > 0;
  if (!hasRows) return null;

  return (
    <>
      {autoFinishProposal ? (
        <PcbParamRow className="text-status-info">
          <span role="status">
            Proposed path
            {autoFinishProposal.targetName
              ? ` to ${autoFinishProposal.targetName}`
              : ""}{" "}
            ({autoFinishProposal.lengthMm.toFixed(1)} mm) —
          </span>
          <button
            type="button"
            className={INLINE_BUTTON}
            onClick={onAcceptAutoFinish}
          >
            Enter accept
          </button>
          <button
            type="button"
            className={INLINE_BUTTON}
            onClick={onDismissAutoFinish}
          >
            Esc dismiss
          </button>
        </PcbParamRow>
      ) : null}
      {autoFinishNotice ? (
        <PcbParamRow className="text-status-warning">
          <span role="status">{autoFinishNotice}</span>
        </PcbParamRow>
      ) : null}
      {blockedConflictCount !== null && !allowDrcViolations ? (
        <PcbParamRow className="text-status-danger">
          <span role="alert">
            Commit blocked: {blockedConflictCount} DRC conflict
            {blockedConflictCount === 1 ? "" : "s"} — fix the route or
          </span>
          <button
            type="button"
            className={INLINE_BUTTON}
            onClick={onToggleAllowDrcViolations}
          >
            allow violations
          </button>
        </PcbParamRow>
      ) : null}
      {routeNotice ? (
        <PcbParamRow className="text-status-danger">
          <span role="alert">{routeNotice}</span>
        </PcbParamRow>
      ) : null}
      {allowDrcViolations ? (
        <PcbParamRow className="text-status-warning">
          <span>DRC override ON — commits may violate design rules</span>
          <button
            type="button"
            className={INLINE_BUTTON}
            onClick={onToggleAllowDrcViolations}
          >
            re-enable gate
          </button>
        </PcbParamRow>
      ) : null}
      {hints.length > 0 ? (
        <PcbParamRow className="text-text-disabled">
          {hints.map((h) => (
            <span key={h.keys} className="shrink-0">
              <kbd className="font-sans">{h.keys}</kbd> {h.label}
            </span>
          ))}
        </PcbParamRow>
      ) : null}
    </>
  );
}
