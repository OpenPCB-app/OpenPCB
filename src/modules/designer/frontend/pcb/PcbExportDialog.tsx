import { useEffect, useMemo, useState, type ReactElement } from "react";
import { AlertTriangle, Download, X } from "lucide-react";
import { createDesignerApi, type ExportSummary } from "../api";

interface PcbExportDialogProps {
  backendURL: string | null | undefined;
  moduleId: string;
  designId: string;
  open: boolean;
  onClose: () => void;
}

interface ExportStatus {
  state: "idle" | "running" | "ok" | "error";
  message?: string;
  bundleName?: string;
  warnings?: number;
}

/**
 * Manufacturing-export dialog. Triggers `POST .../exports/gerber?format=zip`
 * and offers the result as a browser download.
 *
 * Options:
 *   - Include BOM CSV
 *   - Include pick-and-place CSV
 *   - Include inner copper layers (4-layer boards only — backend ignores
 *     when board.layerCount === 2)
 */
export function PcbExportDialog({
  backendURL,
  moduleId,
  designId,
  open,
  onClose,
}: PcbExportDialogProps): ReactElement | null {
  const [includeBom, setIncludeBom] = useState(true);
  const [includePnp, setIncludePnp] = useState(true);
  const [includeInner, setIncludeInner] = useState(true);
  const [status, setStatus] = useState<ExportStatus>({ state: "idle" });
  // Pre-export DRC gate: errors block the download until acknowledged.
  const [drcGate, setDrcGate] = useState<{
    state: "running" | "ok" | "error";
    errors: number;
    warnings: number;
    infos: number;
    message?: string;
  }>({ state: "running", errors: 0, warnings: 0, infos: 0 });
  const [ackErrors, setAckErrors] = useState(false);
  // Export preview: file list + preflight warnings, refreshed whenever the
  // options change. Surfaces the backend export preflight (fab minimums,
  // missing outline, unsourced assembly parts) before the user downloads.
  const [summary, setSummary] = useState<ExportSummary | null>(null);
  const [summaryState, setSummaryState] = useState<"loading" | "ok" | "error">(
    "loading",
  );
  // The backend REFUSES boards it cannot manufacture faithfully (non-through
  // vias, more than four copper layers); the refusal must be readable here,
  // not only after pressing Export.
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const api = useMemo(
    () => createDesignerApi({ backendURL, moduleId }),
    [backendURL, moduleId],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Run DRC when the dialog opens (also persists the result → design card).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDrcGate({ state: "running", errors: 0, warnings: 0, infos: 0 });
    setAckErrors(false);
    void api
      .runDrc(designId)
      .then((r) => {
        if (cancelled) return;
        setDrcGate({
          state: "ok",
          errors: r.summary.errors,
          warnings: r.summary.warnings,
          infos: r.summary.infos,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setDrcGate({
          state: "error",
          errors: 0,
          warnings: 0,
          infos: 0,
          message: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [open, api, designId]);

  // Refresh the export preview whenever the dialog opens or the options change.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSummaryState("loading");
    setSummaryError(null);
    void api
      .fetchExportSummary(designId, {
        includeBom,
        includePickAndPlace: includePnp,
        includeInnerLayers: includeInner,
      })
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        setSummaryState("ok");
      })
      .catch((e) => {
        if (cancelled) return;
        setSummaryError(e instanceof Error ? e.message : String(e));
        setSummaryState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open, api, designId, includeBom, includePnp, includeInner]);

  const drcBlocks = drcGate.state === "ok" && drcGate.errors > 0 && !ackErrors;

  if (!open) return null;

  const handleDownload = async (): Promise<void> => {
    setStatus({ state: "running" });
    try {
      const { bundleName, warnings, blob } = await api.downloadGerberZip(
        designId,
        {
          includeBom,
          includePickAndPlace: includePnp,
          includeInnerLayers: includeInner,
        },
      );
      // Trigger browser download.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${bundleName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus({ state: "ok", bundleName, warnings });
    } catch (err) {
      setStatus({
        state: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pcb-export-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[480px] max-w-[90vw] overflow-hidden rounded-float border border-border bg-surface-raised shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2
            id="pcb-export-dialog-title"
            className="text-sm font-semibold text-text-strong"
          >
            Export manufacturing files
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
          <p className="text-xs text-text-tertiary">
            Bundle contents: Gerber X2 per copper / mask / paste / silk layer +
            Edge.Cuts + Excellon drill file. Optional BOM and pick-and-place
            CSVs. Output is a ZIP ready for JLCPCB / PCBWay upload.
          </p>

          {drcGate.state === "running" ? (
            <p className="rounded-control border border-border bg-surface-panel px-3 py-2 text-xs text-text-secondary">
              Running DRC…
            </p>
          ) : null}
          {drcGate.state === "error" ? (
            <p className="rounded-control border border-status-warning bg-status-warning-soft px-3 py-2 text-xs text-status-warning">
              DRC could not run ({drcGate.message}). Export is allowed but
              unverified.
            </p>
          ) : null}
          {drcGate.state === "ok" && drcGate.errors === 0 ? (
            <p className="rounded-control border border-status-success bg-status-success-soft px-3 py-2 text-xs text-status-success">
              DRC passed
              {drcGate.warnings > 0
                ? ` with ${drcGate.warnings} warning(s)`
                : " — no errors"}
              .
            </p>
          ) : null}
          {drcGate.state === "ok" && drcGate.errors > 0 ? (
            <div className="rounded-control border border-status-danger bg-status-danger-soft px-3 py-2 text-xs text-status-danger">
              <p className="font-medium">
                DRC found {drcGate.errors} error(s)
                {drcGate.warnings > 0
                  ? ` and ${drcGate.warnings} warning(s)`
                  : ""}
                .
              </p>
              <label className="mt-1.5 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={ackErrors}
                  onChange={(e) => setAckErrors(e.target.checked)}
                />
                Export anyway (ignore DRC errors)
              </label>
            </div>
          ) : null}

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeBom}
              onChange={(e) => setIncludeBom(e.target.checked)}
            />
            Include BOM CSV
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includePnp}
              onChange={(e) => setIncludePnp(e.target.checked)}
            />
            Include pick-and-place CSV
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeInner}
              onChange={(e) => setIncludeInner(e.target.checked)}
            />
            Include inner copper layers (4-layer boards only)
          </label>

          {summaryState === "loading" ? (
            <p className="text-xs text-text-tertiary">
              Preparing export preview…
            </p>
          ) : null}
          {summaryState === "error" ? (
            <p className="rounded-control border border-status-danger bg-status-danger-soft px-3 py-2 text-xs text-status-danger">
              {summaryError ?? "Export preview failed"}
            </p>
          ) : null}
          {summaryState === "ok" && summary && summary.warnings.length > 0 ? (
            <div className="rounded-control border border-status-warning bg-status-warning-soft px-3 py-2 text-xs text-status-warning">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                {summary.warnings.length} export warning
                {summary.warnings.length === 1 ? "" : "s"}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {summary.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {summaryState === "ok" && summary ? (
            <p className="text-xs text-text-tertiary">
              {summary.files.length} files ·{" "}
              <span className="font-mono">{summary.bundleName}.zip</span>
              {summary.warnings.length === 0 ? " · no warnings" : null}
            </p>
          ) : null}

          {status.state === "running" ? (
            <p className="text-xs text-selection">
              Building bundle…
            </p>
          ) : null}
          {status.state === "ok" ? (
            <p className="rounded-control border border-status-success bg-status-success-soft px-3 py-2 text-xs text-status-success">
              Downloaded{" "}
              <span className="font-mono">{status.bundleName}.zip</span>
              {status.warnings && status.warnings > 0
                ? ` — ${status.warnings} warning(s)`
                : null}
            </p>
          ) : null}
          {status.state === "error" ? (
            <p className="rounded-control border border-status-danger bg-status-danger-soft px-3 py-2 text-xs text-status-danger">
              {status.message ?? "Export failed"}
            </p>
          ) : null}
        </section>

        <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-control border border-border-control px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-hover hover:text-text-strong"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={
              status.state === "running" ||
              drcGate.state === "running" ||
              summaryState === "error" ||
              drcBlocks
            }
            title={
              drcBlocks
                ? "Resolve DRC errors or check “Export anyway”"
                : undefined
            }
            className="inline-flex items-center gap-1.5 rounded-control bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {ackErrors && drcGate.errors > 0 ? "Export anyway" : "Download ZIP"}
          </button>
        </footer>
      </div>
    </div>
  );
}
