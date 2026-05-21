import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Download, X } from "lucide-react";
import { createDesignerApi } from "../api";

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[480px] max-w-[90vw] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2
            id="pcb-export-dialog-title"
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            Export manufacturing files
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <section className="space-y-3 px-4 py-4 text-sm text-slate-700 dark:text-slate-200">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Bundle contents: Gerber X2 per copper / mask / paste / silk layer +
            Edge.Cuts + Excellon drill file. Optional BOM and pick-and-place
            CSVs. Output is a ZIP ready for JLCPCB / PCBWay upload.
          </p>

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

          {status.state === "running" ? (
            <p className="text-xs text-violet-600 dark:text-violet-300">
              Building bundle…
            </p>
          ) : null}
          {status.state === "ok" ? (
            <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
              Downloaded{" "}
              <span className="font-mono">{status.bundleName}.zip</span>
              {status.warnings && status.warnings > 0
                ? ` — ${status.warnings} warning(s)`
                : null}
            </p>
          ) : null}
          {status.state === "error" ? (
            <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
              {status.message ?? "Export failed"}
            </p>
          ) : null}
        </section>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={status.state === "running"}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            Download ZIP
          </button>
        </footer>
      </div>
    </div>
  );
}
