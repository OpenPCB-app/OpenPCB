/**
 * KiCad project import wizard.
 *
 * Three-step modal:
 *   1. Pick a .zip — calls /imports/kicad-project/inspect; renders report.
 *   2. Review (counts, warnings, components, board summary). Optional
 *      design-name override.
 *   3. Commit — calls /imports/kicad-project; on success opens the new design.
 *
 * v1 scope: design + board settings + outline + net classes are imported.
 * Schematic + PCB entities are surfaced as "deferred" in the warnings panel
 * until library ingestion of project-embedded symbols/footprints lands.
 */

import { AlertTriangle, FileUp, Loader2, X } from "lucide-react";
import {
  type ChangeEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  KicadProjectCommitResult,
  KicadProjectInspectReport,
} from "../../../../sdks/designer";
import { createDesignerApi } from "../api";

interface KicadProjectImportWizardProps {
  backendURL: string | null;
  moduleId: string;
  onClose(): void;
  onImported(result: KicadProjectCommitResult): void;
}

type WizardStage = "pick" | "review" | "committing" | "done";

export function KicadProjectImportWizard({
  backendURL,
  moduleId,
  onClose,
  onImported,
}: KicadProjectImportWizardProps): ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<WizardStage>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<KicadProjectInspectReport | null>(null);
  const [overrideName, setOverrideName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commitResult, setCommitResult] =
    useState<KicadProjectCommitResult | null>(null);

  const api = createDesignerApi({ backendURL, moduleId });

  const handleFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const chosen = event.target.files?.[0];
      if (!chosen) return;
      setFile(chosen);
      setError(null);
      setBusy(true);
      try {
        const result = await api.inspectKicadProject(chosen);
        setReport(result);
        setOverrideName(result.projectName);
        setStage("review");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStage("pick");
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  const handleCommit = useCallback(async () => {
    if (!file) return;
    setError(null);
    setBusy(true);
    setStage("committing");
    try {
      const trimmed = overrideName.trim();
      const result = await api.commitKicadProject(
        file,
        trimmed.length > 0 ? trimmed : undefined,
      );
      setCommitResult(result);
      setStage("done");
      onImported(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("review");
    } finally {
      setBusy(false);
    }
  }, [api, file, onImported, overrideName]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Import KiCad project"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900 shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <FileUp className="h-4 w-4" />
            Import KiCad project
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 text-sm text-slate-200">
          {stage === "pick" && (
            <PickStage
              busy={busy}
              error={error}
              onPick={() => fileInputRef.current?.click()}
            />
          )}
          {stage === "review" && report && (
            <ReviewStage
              report={report}
              overrideName={overrideName}
              onNameChange={setOverrideName}
              error={error}
            />
          )}
          {stage === "committing" && <CommittingStage />}
          {stage === "done" && commitResult && (
            <DoneStage result={commitResult} />
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-950/40 px-4 py-3">
          {stage === "pick" && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
          )}
          {stage === "review" && (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-md px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCommit()}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Import design
              </button>
            </>
          )}
          {stage === "done" && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
            >
              Done
            </button>
          )}
        </footer>

        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => void handleFile(e)}
        />
      </div>
    </div>
  );
}

function PickStage({
  busy,
  error,
  onPick,
}: {
  busy: boolean;
  error: string | null;
  onPick(): void;
}): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
      <p className="text-sm text-slate-300">
        Pick a ZIP archive of a KiCad project (.kicad_pro + .kicad_sch +
        .kicad_pcb).
      </p>
      <button
        type="button"
        onClick={onPick}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-500 disabled:opacity-60"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Inspecting…
          </>
        ) : (
          <>
            <FileUp className="h-4 w-4" />
            Choose ZIP…
          </>
        )}
      </button>
      {error && (
        <div className="mt-2 max-w-sm rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      <p className="text-[11px] text-slate-500">
        v1 imports the project name, layer count, board outline and net classes.
        Schematic and PCB entity ingestion lands in the next iteration.
      </p>
    </div>
  );
}

function ReviewStage({
  report,
  overrideName,
  onNameChange,
  error,
}: {
  report: KicadProjectInspectReport;
  overrideName: string;
  onNameChange(name: string): void;
  error: string | null;
}): ReactElement {
  const reuseCount = report.components.filter(
    (c) => c.status === "reuse",
  ).length;
  const missingCount = report.components.filter(
    (c) => c.status !== "reuse",
  ).length;
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Design name
        </label>
        <input
          type="text"
          value={overrideName}
          onChange={(e) => onNameChange(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
          placeholder={report.projectName}
        />
      </section>

      <section className="grid grid-cols-2 gap-3">
        <Stat label="Copper layers" value={String(report.copperLayerCount)} />
        <Stat
          label="Schematic sheets"
          value={String(report.schematicSheetCount)}
        />
        <Stat label="Nets" value={String(report.netCount)} />
        <Stat
          label="Board"
          value={
            report.boardOutlineMm
              ? `${Math.round(report.boardOutlineMm.maxXMm - report.boardOutlineMm.minXMm)} × ${Math.round(
                  report.boardOutlineMm.maxYMm - report.boardOutlineMm.minYMm,
                )} mm`
              : "default 50 × 30 mm"
          }
        />
        <Stat
          label="PCB footprints"
          value={String(report.counts.pcbFootprints)}
        />
        <Stat label="PCB traces" value={String(report.counts.pcbSegments)} />
        <Stat label="PCB vias" value={String(report.counts.pcbVias)} />
        <Stat
          label="Sch symbols"
          value={String(report.counts.schematicSymbols)}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Components ({reuseCount} reuse / {missingCount} missing)
        </h3>
        <div className="max-h-32 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/40">
          {report.components.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">
              No components referenced.
            </p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {report.components.slice(0, 50).map((row) => (
                <li
                  key={row.libId}
                  className="flex items-center justify-between px-3 py-1.5 text-xs"
                >
                  <span className="truncate text-slate-200">{row.libId}</span>
                  <span
                    className={
                      row.status === "reuse"
                        ? "ml-2 shrink-0 rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300"
                        : "ml-2 shrink-0 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-300"
                    }
                  >
                    {row.status}
                    {row.references.length > 1
                      ? ` ×${row.references.length}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {report.warnings.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            Warnings ({report.warnings.length})
          </h3>
          <ul className="max-h-32 overflow-y-auto rounded-md border border-amber-900/40 bg-amber-950/20 text-xs">
            {report.warnings.slice(0, 50).map((w, i) => (
              <li
                key={`${w.code}-${i}`}
                className="border-b border-amber-900/20 px-3 py-1.5 last:border-b-0 text-amber-200"
              >
                <span className="font-mono text-[10px] text-amber-400">
                  [{w.code}]
                </span>{" "}
                {w.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}

function CommittingStage(): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-sm text-slate-300">
      <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
      Importing project…
    </div>
  );
}

function DoneStage({
  result,
}: {
  result: KicadProjectCommitResult;
}): ReactElement {
  return (
    <div className="flex flex-col gap-3 py-4">
      <p className="text-sm text-slate-200">
        Imported <strong>{result.designName}</strong>.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Layers" value={String(result.applied.copperLayerCount)} />
        <Stat
          label="Net classes"
          value={String(result.applied.netClassesIngested)}
        />
        <Stat
          label="Board outline"
          value={result.applied.boardOutline ? "imported" : "default"}
        />
        <Stat label="Warnings" value={String(result.warnings.length)} />
      </div>
      {result.applied.deferred.length > 0 && (
        <div className="rounded-md border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
          Deferred for next iteration: {result.applied.deferred.join(", ")}.
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium text-slate-100">{value}</div>
    </div>
  );
}
