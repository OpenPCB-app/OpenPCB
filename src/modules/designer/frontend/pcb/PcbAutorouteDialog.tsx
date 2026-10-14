import { useEffect, useMemo, useState, type ReactElement } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useEscapeLayer } from "@shared/frontend/keyboard/use-escape-layer";
import { createDesignerApi, type CloudHeadersProvider } from "../api";
import type {
  RouteOperation,
  RouteOptions,
  RouteResultEnvelope,
} from "../../../../sdks/designer";
import type { AutoroutePreviewTrace } from "./PcbScene";

interface PcbAutorouteDialogProps {
  backendURL: string | null | undefined;
  moduleId: string;
  designId: string;
  cloudHeaders?: CloudHeadersProvider;
  open: boolean;
  onClose: () => void;
  /**
   * Optional engine request. When present (Auto-Layout orchestrator), its
   * `options` + `serializePours` drive the submit; absent = backend defaults.
   */
  request?: {
    options?: RouteOptions;
    routableNetClassIds?: string[];
    excludedNetIds?: string[];
    serializePours?: boolean;
  };
  /** Called after ops are applied so the canvas can reload its projection. */
  onApplied?: () => void;
  /** Ghost-trace preview of the currently-selected ops (null = clear). */
  onPreviewChange?: (preview: AutoroutePreviewTrace[] | null) => void;
}

/** Trace geometry of the selected ops, for the live canvas ghost preview. */
function previewFromOps(
  ops: RouteOperation[],
  selected: Set<string>,
): AutoroutePreviewTrace[] {
  const out: AutoroutePreviewTrace[] = [];
  for (const op of ops) {
    if (!selected.has(op.id)) continue;
    const p = op.payload;
    if (p.type === "pcb_add_trace") {
      out.push({ pointsNm: p.pointsNm, layer: p.layer, widthMm: p.widthMm });
    } else if (p.type === "pcb_add_trace_via") {
      out.push({
        pointsNm: p.trace.pointsNm,
        layer: p.trace.layer,
        widthMm: p.trace.widthMm,
      });
    }
  }
  return out;
}

type Phase =
  | "submitting"
  | "polling"
  | "review"
  | "applying"
  | "applied"
  | "error";

const POLL_INTERVAL_MS = 700;
// ~7 min ceiling: portfolio routing (default K=4) runs the variants sequentially
// in-engine, so wall-time scales ~K× a single pass on large boards.
const MAX_POLLS = 600;

function mmFromNm(nm: number): string {
  return (nm / 1_000_000).toFixed(2);
}

/**
 * Cloud auto-route dialog. Submits the board snapshot, polls for completion,
 * then lets the user cherry-pick the returned trace/via ops and apply them.
 * The desktop re-validates with its own DRC after apply.
 */
export function PcbAutorouteDialog({
  backendURL,
  moduleId,
  designId,
  cloudHeaders,
  open,
  onClose,
  request,
  onApplied,
  onPreviewChange,
}: PcbAutorouteDialogProps): ReactElement | null {
  const [phase, setPhase] = useState<Phase>("submitting");
  const [jobId, setJobId] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [result, setResult] = useState<RouteResultEnvelope | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [applied, setApplied] = useState<{
    count: number;
    failed: number;
    errors: number;
  } | null>(null);

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
    setResult(null);
    setSelected(new Set());
    setMessage(null);
    setApplied(null);
    void api
      .submitAutoroute(designId, request)
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

  // Poll the job until a terminal status.
  useEffect(() => {
    if (!open || phase !== "polling" || !jobId) return;
    let cancelled = false;
    let polls = 0;
    const tick = (): void => {
      if (cancelled) return;
      polls += 1;
      void api
        .getAutorouteStatus(designId, jobId)
        .then((status) => {
          if (cancelled) return;
          if (status.status === "done" && status.result) {
            setResult(status.result);
            setSelected(new Set(status.result.operations.map((o) => o.id)));
            setPhase("review");
            return;
          }
          if (status.status === "failed") {
            setMessage(status.error ?? "Routing failed");
            setPhase("error");
            return;
          }
          if (status.status === "cancelled") {
            onClose();
            return;
          }
          if (polls >= MAX_POLLS) {
            setMessage("Routing timed out");
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
  }, [open, phase, jobId, api, designId, onClose]);

  // Mirror the selected ops onto the live canvas as ghost traces while reviewing.
  useEffect(() => {
    if (!onPreviewChange) return;
    if (open && (phase === "review" || phase === "applying") && result) {
      onPreviewChange(previewFromOps(result.operations, selected));
    } else {
      onPreviewChange(null);
    }
  }, [onPreviewChange, open, phase, result, selected]);

  // Clear the preview when the dialog unmounts.
  useEffect(() => () => onPreviewChange?.(null), [onPreviewChange]);

  if (!open) return null;

  const ops = result?.operations ?? [];
  const selectedOps: RouteOperation[] = ops.filter((o) => selected.has(o.id));

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = async (): Promise<void> => {
    if (!result || selectedOps.length === 0) return;
    setPhase("applying");
    try {
      // "designer-pcb-session" (not a throwaway id) so applied ops land in the
      // user's undo stack — an apply is undoable like any manual edit. The
      // capture fields attribute the copper to this job/candidate (WP-D4).
      const { appliedCount, failures, drc } = await api.applyAutorouteOps(
        designId,
        selectedOps,
        "designer-pcb-session",
        {
          jobId: jobId ?? undefined,
          appliedCandidateId: result.id,
          resultSummary: result.payload,
        },
      );
      setApplied({
        count: appliedCount,
        failed: (failures ?? []).length,
        errors: drc?.summary.errors ?? 0,
      });
      setPhase("applied");
      onApplied?.();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const completion = result?.payload.completion;
  const metrics = result?.payload.metrics;
  // [M7] When portfolio routing ran (K>1), surface which variant the service kept.
  const portfolioWinner = result?.payload.portfolio?.find((v) => v.selected);

  return (
    <div
      role="dialog"
      aria-label="Auto-route"
      aria-labelledby="pcb-autoroute-dialog-title"
      className="fixed bottom-4 right-4 z-40 flex max-h-[78vh] w-[420px] max-w-[92vw] flex-col overflow-hidden rounded-float border border-border bg-surface-raised shadow-2xl"
    >
      <div className="contents">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2
            id="pcb-autoroute-dialog-title"
            className="text-sm font-semibold text-text-strong"
          >
            Auto-route
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
              Submitting board to the auto-router…
            </p>
          ) : null}
          {phase === "polling" ? (
            <p className="text-xs text-selection">
              Routing…
            </p>
          ) : null}
          {phase === "error" ? (
            <p className="rounded-control border border-status-danger bg-status-danger-soft px-3 py-2 text-xs text-status-danger">
              {message ?? "Auto-route failed"}
            </p>
          ) : null}

          {result && (phase === "review" || phase === "applying") ? (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-control border border-border bg-surface-panel px-3 py-2 text-xs text-text-secondary">
                <span>
                  Routed{" "}
                  <strong>
                    {completion?.routedNets}/{completion?.totalNets}
                  </strong>{" "}
                  nets
                </span>
                <span>
                  Vias <strong>{metrics?.viaCount ?? 0}</strong>
                </span>
                <span>
                  Length{" "}
                  <strong>{mmFromNm(metrics?.totalLengthNm ?? 0)} mm</strong>
                </span>
                <span>
                  Bends <strong>{metrics?.bendCount ?? 0}</strong>
                </span>
                {portfolioWinner ? (
                  <span>
                    Variant{" "}
                    <strong>
                      {portfolioWinner.index + 1}/
                      {result.payload.portfolio.length}
                    </strong>
                  </span>
                ) : null}
              </div>

              {result.payload.diagnostics.length > 0 ? (
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-text-tertiary">
                  {result.payload.diagnostics.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              ) : null}

              {ops.length === 0 ? (
                <p className="rounded-control border border-border bg-surface-panel px-3 py-2 text-xs text-text-secondary">
                  No operations were produced.
                  {result.payload.unroutedNets.length > 0
                    ? ` ${result.payload.unroutedNets.length} net(s) could not be routed.`
                    : ""}
                </p>
              ) : (
                <ul className="space-y-1">
                  {ops.map((op) => (
                    <li key={op.id}>
                      <label className="flex items-start gap-2 rounded-control px-1 py-0.5 hover:bg-surface-hover">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={selected.has(op.id)}
                          onChange={() => toggle(op.id)}
                          disabled={phase === "applying"}
                        />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-text-strong">
                            {op.title}
                          </span>
                          <span className="block truncate text-[11px] text-text-tertiary">
                            {op.summary}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}

          {phase === "applied" && applied ? (
            <p
              className={
                applied.errors > 0 || applied.failed > 0
                  ? "rounded-control border border-status-warning bg-status-warning-soft px-3 py-2 text-xs text-status-warning"
                  : "rounded-control border border-status-success bg-status-success-soft px-3 py-2 text-xs text-status-success"
              }
            >
              Applied {applied.count} operation
              {applied.count === 1 ? "" : "s"}
              {applied.failed > 0 ? ` (${applied.failed} rejected)` : ""}.{" "}
              {applied.errors > 0
                ? `DRC reports ${applied.errors} error(s) — review on the board.`
                : "DRC clean."}
            </p>
          ) : null}
        </section>

        <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-control border border-border-control px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-hover hover:text-text-strong"
          >
            {phase === "applied" ? "Done" : "Cancel"}
          </button>
          {phase === "review" || phase === "applying" ? (
            <button
              type="button"
              onClick={() => void handleApply()}
              disabled={phase === "applying" || selectedOps.length === 0}
              className="inline-flex items-center gap-1.5 rounded-control bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === "applying"
                ? "Applying…"
                : `Apply selected (${selectedOps.length})`}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
