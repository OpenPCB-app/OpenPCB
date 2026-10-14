import { useEffect, useMemo, useState, type ReactElement } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useEscapeLayer } from "@shared/frontend/keyboard/use-escape-layer";
import { createDesignerApi, type CloudHeadersProvider } from "../api";
import type { PlaceOptions, PlacementResultEnvelope } from "../../../../sdks";

interface PcbAutoplaceDialogProps {
  backendURL: string | null | undefined;
  moduleId: string;
  designId: string;
  cloudHeaders?: CloudHeadersProvider;
  open: boolean;
  onClose: () => void;
  /**
   * Optional engine request. When present (Auto-Layout orchestrator), its
   * `placeOptions` drive the submit; absent = the backend's own defaults.
   */
  request?: {
    placeOptions?: PlaceOptions;
    routableNetClassIds?: string[];
    excludedNetIds?: string[];
  };
  /**
   * Called once the job completes with the result envelope. The canvas then enters the
   * interactive preview (move/adjust/accept); this dialog only owns submit + poll.
   */
  onPreviewResult: (result: PlacementResultEnvelope) => void;
}

type Phase = "submitting" | "polling" | "error";

const POLL_INTERVAL_MS = 700;
// ~7 min ceiling: matches the auto-router dialog (multi-restart SA on large boards).
const MAX_POLLS = 600;

/**
 * Cloud auto-place launcher. Submits the board snapshot and polls for completion, then
 * hands the result to the canvas, which renders an interactive preview where the user
 * moves/rotates/flips components and accepts or rejects the layout. The desktop
 * re-validates + runs DRC on accept.
 */
export function PcbAutoplaceDialog({
  backendURL,
  moduleId,
  designId,
  cloudHeaders,
  open,
  onClose,
  request,
  onPreviewResult,
}: PcbAutoplaceDialogProps): ReactElement | null {
  const [phase, setPhase] = useState<Phase>("submitting");
  const [jobId, setJobId] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const api = useMemo(
    () => createDesignerApi({ backendURL, moduleId, cloudHeaders }),
    [backendURL, moduleId, cloudHeaders],
  );

  useEscapeLayer(onClose, { enabled: open });

  // Reset + submit each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase("submitting");
    setJobId(null);
    setWarnings([]);
    setMessage(null);
    void api
      .submitAutoplace(designId, request)
      .then((res) => {
        if (cancelled) return;
        setWarnings(res.warnings ?? []);
        setJobId(res.jobId);
        setPhase("polling");
      })
      .catch((e) => {
        if (cancelled) return;
        setMessage(e instanceof Error ? e.message : String(e));
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open, api, designId, request]);

  // Poll the job until a terminal status, then hand the result to the canvas.
  useEffect(() => {
    if (!open || phase !== "polling" || !jobId) return;
    let cancelled = false;
    let polls = 0;
    const tick = (): void => {
      if (cancelled) return;
      polls += 1;
      void api
        .getAutoplaceStatus(designId, jobId)
        .then((status) => {
          if (cancelled) return;
          if (status.status === "done" && status.result) {
            onPreviewResult(status.result);
            return;
          }
          if (status.status === "failed") {
            setMessage(status.error ?? "Placement failed");
            setPhase("error");
            return;
          }
          if (status.status === "cancelled") {
            onClose();
            return;
          }
          if (polls >= MAX_POLLS) {
            setMessage("Placement timed out");
            setPhase("error");
            return;
          }
          window.setTimeout(tick, POLL_INTERVAL_MS);
        })
        .catch((e) => {
          if (cancelled) return;
          setMessage(e instanceof Error ? e.message : String(e));
          setPhase("error");
        });
    };
    const id = window.setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [open, phase, jobId, api, designId, onClose, onPreviewResult]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Auto-place"
      aria-labelledby="pcb-autoplace-dialog-title"
      className="fixed bottom-4 right-4 z-40 flex w-[360px] max-w-[92vw] flex-col overflow-hidden rounded-float border border-border bg-surface-raised shadow-2xl"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2
          id="pcb-autoplace-dialog-title"
          className="text-sm font-semibold text-text-strong"
        >
          Auto-place
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

      <section className="space-y-3 px-4 py-4 text-sm text-text">
        {warnings.length > 0 ? (
          <div className="rounded-control border border-status-warning bg-status-warning-soft px-3 py-2 text-xs text-status-warning">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              {warnings.length} warning{warnings.length === 1 ? "" : "s"}
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {phase === "submitting" ? (
          <p className="text-xs text-text-tertiary">
            Submitting board to the auto-placer…
          </p>
        ) : null}
        {phase === "polling" ? (
          <p className="text-xs text-selection">
            Optimizing placement…
          </p>
        ) : null}
        {phase === "error" ? (
          <p className="rounded-control border border-status-danger bg-status-danger-soft px-3 py-2 text-xs text-status-danger">
            {message ?? "Auto-place failed"}
          </p>
        ) : null}
      </section>
    </div>
  );
}
