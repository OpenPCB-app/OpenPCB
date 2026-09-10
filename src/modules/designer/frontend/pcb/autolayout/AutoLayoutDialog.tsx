import { useEffect, useMemo, useState, type ReactElement } from "react";
import { AlertTriangle, X } from "lucide-react";

import type { AutoLayoutConfig, PcbPlacedPart } from "../../../../../sdks/designer";
import type { CloudHeadersProvider } from "../../api";
import { AutoLayoutProgress } from "./AutoLayoutProgress";
import { AutoLayoutResults } from "./AutoLayoutResults";
import { createAutoLayoutApi, type AutoLayoutClientError } from "./api";
import {
  DEFAULT_AUTOLAYOUT_CONFIG,
  applyPreset,
  toLayoutRequest,
  type AutoLayoutEffort,
  type AutoLayoutPreset,
} from "./config";
import {
  buildCandidatePreview,
  type AutoLayoutCandidatePreview,
} from "./preview/build-candidate-preview";
import { useAutoLayoutJob } from "./state/useAutoLayoutJob";
import { selectedCandidate } from "./state/types";

const PRESETS: Array<{ id: Exclude<AutoLayoutPreset, "custom">; label: string; hint: string }> = [
  { id: "balanced", label: "Balanced", hint: "Service defaults" },
  { id: "routability", label: "Routability", hint: "Favour completable routing" },
  { id: "compact", label: "Compact", hint: "Favour short connections" },
  { id: "preserve", label: "Preserve layout", hint: "Stay close to your placement" },
];

const EFFORTS: Array<{ id: AutoLayoutEffort; label: string }> = [
  { id: "fast", label: "Fast" },
  { id: "balanced", label: "Balanced" },
  { id: "quality", label: "Quality" },
];

export interface AutoLayoutDialogProps {
  backendURL: string | null | undefined;
  moduleId: string;
  designId: string;
  cloudHeaders?: CloudHeadersProvider;
  open: boolean;
  onClose: () => void;
  /** Current board placements — the base the candidate ghosts are composed onto. */
  placements: readonly PcbPlacedPart[];
  /** Selected component ids, for the "Selected components" scope. */
  selectedPlacementIds: readonly string[];
  /** Persisted per-design config seed. */
  config?: AutoLayoutConfig;
  onConfigChange?: (config: AutoLayoutConfig) => void;
  /** True when a cloud session exists. False renders the sign-in gate and issues NO request. */
  signedIn: boolean;
  /** Live content digest of the board; a change mid-run marks the result stale. */
  contentDigest?: string | null;
  sessionId: string;
  onApplied?: (revision: number) => void;
  /** Ghost preview for the canvas (null clears it). */
  onPreviewChange?: (preview: AutoLayoutCandidatePreview | null) => void;
}

/**
 * Cloud Auto Layout: one composite job, ranked candidates, atomic apply.
 *
 * The dialog owns configuration and review; it owns no HTTP and no state machine (those are
 * `./api` and `./state/useAutoLayoutJob`). Preview is derived locally from the already-
 * downloaded result, so switching candidates never calls the cloud and never touches the
 * board — the revision is unchanged until Apply.
 */
export function AutoLayoutDialog({
  backendURL,
  moduleId,
  designId,
  cloudHeaders,
  open,
  onClose,
  placements,
  selectedPlacementIds,
  config: seedConfigValue,
  onConfigChange,
  signedIn,
  contentDigest,
  sessionId,
  onApplied,
  onPreviewChange,
}: AutoLayoutDialogProps): ReactElement | null {
  const [config, setConfig] = useState<AutoLayoutConfig>(
    seedConfigValue ?? DEFAULT_AUTOLAYOUT_CONFIG,
  );

  const api = useMemo(
    () =>
      createAutoLayoutApi({
        backendURL,
        moduleId,
        designId,
        cloudHeaders,
      }),
    [backendURL, moduleId, designId, cloudHeaders],
  );

  const job = useAutoLayoutJob({ api, sessionId, onApplied });
  const { state } = job;

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // A board edit during a run invalidates the candidates — inspectable, not appliable.
  useEffect(() => {
    if (state.type !== "review" || state.stale) return;
    if (contentDigest && contentDigest !== state.run.snapshotDigest) job.markStale();
  }, [contentDigest, job, state]);

  const candidate = selectedCandidate(state);
  const preview = useMemo<AutoLayoutCandidatePreview | null>(
    () => (candidate ? buildCandidatePreview(candidate, placements) : null),
    [candidate, placements],
  );

  // Push the ghost to the canvas; clear it whenever the dialog is closed or has no
  // candidate, so a preview can never outlive the review it belongs to.
  useEffect(() => {
    if (!onPreviewChange) return;
    onPreviewChange(open ? preview : null);
    return () => onPreviewChange(null);
  }, [onPreviewChange, open, preview]);

  if (!open) return null;

  const scopeDisabled = selectedPlacementIds.length === 0;
  const busy = state.type === "submitting" || state.type === "running";

  function updateConfig(next: AutoLayoutConfig): void {
    setConfig(next);
    onConfigChange?.(next);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pcb-autolayout-dialog-title"
      className="pointer-events-auto absolute right-4 top-4 z-30 flex max-h-[80vh] w-[26rem] flex-col rounded-float border border-border bg-surface-raised shadow-xl"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2
          id="pcb-autolayout-dialog-title"
          className="text-sm font-semibold text-text-strong"
        >
          Auto Layout
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-control p-1 text-text-tertiary hover:bg-surface-hover"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <section className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm text-text">
        {!signedIn ? (
          // The feature stays VISIBLE signed out and explains itself; hiding it entirely
          // is how users conclude a feature does not exist. No request is issued.
          <div className="space-y-2">
            <p className="text-xs text-text-secondary">
              Auto Layout places and routes your board in OpenPCB Cloud, then lets you pick
              from several complete candidates.
            </p>
            <p className="rounded-control border border-selection/40 bg-selection-soft px-3 py-2 text-xs text-selection">
              Sign in to OpenPCB Cloud to run Auto Layout.
            </p>
          </div>
        ) : null}

        {signedIn && state.type === "idle" ? (
          <div className="space-y-3">
            <fieldset>
              <legend className="text-[11px] font-medium uppercase tracking-wide text-text-caps">
                Scope
              </legend>
              <div className="mt-1 flex gap-2">
                {(["all", "selected"] as const).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    // An empty selection never silently becomes a whole-board run: the
                    // scope is simply unavailable until something is selected.
                    disabled={scope === "selected" && scopeDisabled}
                    onClick={() => updateConfig({ ...config, scope })}
                    className={chipClass((config.scope ?? "all") === scope)}
                  >
                    {scope === "all"
                      ? "Whole board"
                      : `Selected components${scopeDisabled ? "" : ` (${selectedPlacementIds.length})`}`}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-[11px] font-medium uppercase tracking-wide text-text-caps">
                Priority
              </legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    title={preset.hint}
                    onClick={() => updateConfig(applyPreset(config, preset.id))}
                    className={chipClass(config.preset === preset.id)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-[11px] font-medium uppercase tracking-wide text-text-caps">
                Effort
              </legend>
              <div className="mt-1 flex gap-2">
                {EFFORTS.map((effort) => (
                  <button
                    key={effort.id}
                    type="button"
                    onClick={() =>
                      updateConfig({ ...config, effort: effort.id, preset: "custom" })
                    }
                    className={chipClass(config.effort === effort.id)}
                  >
                    {effort.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <p className="text-[11px] text-text-tertiary">
              The number of candidates is chosen by the service.
            </p>
          </div>
        ) : null}

        {state.type === "submitting" ? (
          <p className="text-xs text-text-tertiary">
            Submitting board to OpenPCB Cloud…
          </p>
        ) : null}

        {state.type === "running" ? (
          <>
            {state.run.warnings.length > 0 ? (
              <SnapshotWarnings warnings={state.run.warnings} />
            ) : null}
            <AutoLayoutProgress progress={state.progress} cancelling={state.cancelling} />
          </>
        ) : null}

        {state.type === "review" || state.type === "applying" ? (
          <AutoLayoutResults
            result={state.type === "review" ? state.result : state.result}
            selectedCandidateId={state.selectedCandidateId}
            stale={state.type === "review" ? state.stale : false}
            applying={state.type === "applying"}
            onSelect={job.select}
          />
        ) : null}

        {state.type === "completed" ? (
          <div
            className={
              state.drcErrors === null
                ? "rounded-control border border-border bg-surface-section px-3 py-2 text-xs text-text-secondary"
                : state.drcErrors > 0
                  ? "rounded-control border border-status-warning bg-status-warning-soft px-3 py-2 text-xs text-status-warning"
                  : "rounded-control border border-status-success bg-status-success-soft px-3 py-2 text-xs text-status-success"
            }
          >
            <p className="font-medium">Auto Layout applied</p>
            <p className="mt-0.5">
              {state.drcErrors === null
                ? "DRC did not run for this apply — run DRC to check the board."
                : state.drcErrors > 0
                  ? `The candidate was applied, but DRC found ${state.drcErrors} error${
                      state.drcErrors === 1 ? "" : "s"
                    } — review them on the board.`
                  : "DRC clean."}
              {state.drcWarnings !== null && state.drcWarnings > 0
                ? ` ${state.drcWarnings} warning(s).`
                : ""}
            </p>
            <p className="mt-0.5 text-[11px]">Undo reverts the whole layout in one step.</p>
          </div>
        ) : null}

        {state.type === "cancelled" ? (
          <p className="text-xs text-text-tertiary">
            Auto Layout was cancelled.
          </p>
        ) : null}

        {state.type === "failed" ? <FailureNotice error={state.error} /> : null}
      </section>

      <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-control border border-border-control px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-hover hover:text-text-strong"
        >
          {state.type === "completed" ? "Done" : "Close"}
        </button>

        {signedIn && (state.type === "idle" || state.type === "failed" || state.type === "cancelled") ? (
          <button
            type="button"
            onClick={() =>
              void job.run(toLayoutRequest(config, selectedPlacementIds))
            }
            className="rounded-control bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            {state.type === "idle" ? "Run Auto Layout" : "Try again"}
          </button>
        ) : null}

        {busy ? (
          <button
            type="button"
            onClick={() => void job.cancel()}
            disabled={state.type === "running" && state.cancelling}
            className="rounded-control border border-border-control px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-hover hover:text-text-strong disabled:opacity-50"
          >
            {state.type === "running" && state.cancelling ? "Cancelling…" : "Cancel run"}
          </button>
        ) : null}

        {state.type === "review" || state.type === "applying" ? (
          <button
            type="button"
            onClick={() => void job.apply()}
            disabled={
              state.type === "applying" ||
              !state.selectedCandidateId ||
              (state.type === "review" && state.stale) ||
              Boolean(candidate?.failure)
            }
            className="rounded-control bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.type === "applying" ? "Applying…" : "Apply candidate"}
          </button>
        ) : null}
      </footer>
    </div>
  );
}

function chipClass(active: boolean): string {
  return [
    "rounded-control border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
    active
      ? "border-selection bg-selection text-primary-foreground"
      : "border-border-control text-text hover:bg-surface-hover hover:text-text-strong",
  ].join(" ");
}

function SnapshotWarnings({ warnings }: { warnings: string[] }): ReactElement {
  return (
    <div className="rounded-control border border-status-warning bg-status-warning-soft px-3 py-2 text-[11px] text-status-warning">
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="h-3.5 w-3.5" />
        {warnings.length} warning{warnings.length === 1 ? "" : "s"}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {warnings.map((warning, i) => (
          <li key={i}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Failure copy is chosen by CODE, never by matching the service's message — that is the
 * whole point of typing these errors at the boundary.
 */
function FailureNotice({ error }: { error: AutoLayoutClientError }): ReactElement {
  const message = (() => {
    switch (error.code) {
      case "AUTO_LAYOUT_AUTH_REQUIRED":
        return "Your OpenPCB Cloud session expired. Sign in again to run Auto Layout.";
      case "AUTO_LAYOUT_QUOTA_EXCEEDED":
        return "Another cloud job is already running for your account. Wait for it to finish, or cancel it, then try again.";
      case "AUTO_LAYOUT_SERVICE_UNSUPPORTED":
        return "Your OpenPCB Cloud service does not support Auto Layout. Route Board is still available.";
      case "AUTO_LAYOUT_SNAPSHOT_INVALID":
        return "Auto Layout can't start — the board has issues that need attention.";
      case "AUTO_LAYOUT_STALE":
        return "The board changed after Auto Layout started. Run it again for the current board.";
      case "AUTO_LAYOUT_RESULT_EXPIRED":
        return "This Auto Layout result is no longer available. Run it again.";
      case "AUTO_LAYOUT_OPERATION_INVALID":
        return "OpenPCB rejected part of this candidate, so nothing was applied. Try another candidate.";
      case "AUTO_LAYOUT_REVISION_CONFLICT":
        return "The board was edited while the candidate was being applied. Nothing was applied.";
      case "AUTO_LAYOUT_CONTRACT_MISMATCH":
        return "OpenPCB Cloud returned a response this version of OpenPCB doesn't understand.";
      default:
        return error.message;
    }
  })();

  const diagnostics = Array.isArray(error.detail)
    ? (error.detail as Array<{ message?: unknown; severity?: unknown }>)
    : null;

  return (
    <div className="rounded-control border border-status-danger bg-status-danger-soft px-3 py-2 text-xs text-status-danger">
      <p>{message}</p>
      {diagnostics && diagnostics.length > 0 ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px]">
          {diagnostics.slice(0, 5).map((diagnostic, i) => (
            <li key={i}>
              {typeof diagnostic.message === "string"
                ? diagnostic.message
                : JSON.stringify(diagnostic)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
