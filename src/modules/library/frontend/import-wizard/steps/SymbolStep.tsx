import { Grid3X3 } from "lucide-react";
import { memo, type ReactElement } from "react";
import { useShallow } from "zustand/react/shallow";
import { SymbolPreviewCanvas } from "../../../../../shared/frontend/canvas/preview";
import { WarningsPanel } from "../components/WarningsPanel";
import { CanvasStepLayout } from "../layout/CanvasStepLayout";
import { useImportWizardStore } from "../useImportWizardStore";

export const SymbolStep = memo(function SymbolStep(): ReactElement {
  const {
    symbolFile,
    setSymbolFile,
    inspectData,
    selectedSymbolId,
    setSelectedSymbolId,
    inspectStatus,
    inspectError,
    gridVisible,
    setGridVisible,
  } = useImportWizardStore(
    useShallow((s) => ({
      symbolFile: s.symbolFile,
      setSymbolFile: s.setSymbolFile,
      inspectData: s.inspectData,
      selectedSymbolId: s.selectedSymbolId,
      setSelectedSymbolId: s.setSelectedSymbolId,
      inspectStatus: s.inspectStatus,
      inspectError: s.inspectError,
      gridVisible: s.symbolGridVisible,
      setGridVisible: s.setSymbolGridVisible,
    })),
  );

  const handleSymbolFileSelect = (files: FileList | null) => {
    setSymbolFile(files?.[0] ?? null);
  };

  const selectedSymbol = inspectData?.symbols.find(
    (symbol) => symbol.id === selectedSymbolId,
  );

  const selectedWarnings = inspectData
    ? inspectData.warnings.filter(
        (warning) => warning.itemId === selectedSymbolId,
      )
    : [];

  return (
    <CanvasStepLayout
      defaultLeftWidth={264}
      defaultRightWidth={296}
      minSidebarWidth={220}
      maxSidebarWidth={460}
      topContent={
        <div className="mx-auto inline-flex items-center gap-2 rounded-lg border border-slate-200/90 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/90">
          <button
            type="button"
            onClick={() => setGridVisible(!gridVisible)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors ${
              gridVisible
                ? "border-violet-500 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <Grid3X3 className="h-3.5 w-3.5" />
            Grid
          </button>

          <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />

          <div className="text-xs text-slate-500 dark:text-slate-400">
            Zoom: scroll wheel
          </div>
        </div>
      }
      leftSidebar={
        <div className="space-y-4 p-4">
          <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Import
            </div>

            <input
              type="file"
              accept=".kicad_sym"
              onInput={(event) =>
                handleSymbolFileSelect(
                  (event.currentTarget as HTMLInputElement).files,
                )
              }
              onChange={(event) =>
                handleSymbolFileSelect(event.currentTarget.files)
              }
              className="block w-full cursor-pointer rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 file:mr-2 file:rounded file:border-0 file:bg-violet-600 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-white hover:file:bg-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />

            {symbolFile ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300">
                {symbolFile.name}
              </div>
            ) : null}
          </section>

          <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Symbol
            </div>

            {inspectData && inspectData.symbols.length > 0 ? (
              <select
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={selectedSymbolId}
                onChange={(event) => setSelectedSymbolId(event.target.value)}
              >
                {inspectData.symbols.map((symbol) => (
                  <option key={symbol.id} value={symbol.id}>
                    {symbol.name} ({symbol.pinCount} pins)
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                Import a symbol file to inspect available symbols.
              </div>
            )}
          </section>
        </div>
      }
      center={
        <div className="relative h-full border-x border-slate-200 bg-slate-900 dark:border-slate-800">
          <SymbolPreviewCanvas
            model={selectedSymbol?.preview ?? null}
            className="h-full w-full"
            showGrid={gridVisible}
            emptyMessage={
              symbolFile
                ? "No preview available for selected symbol."
                : "Import a .kicad_sym file to preview symbol geometry."
            }
          />

          {inspectStatus === "loading" && symbolFile ? (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/35">
              <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-300">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-violet-400" />
                Processing symbol file...
              </div>
            </div>
          ) : null}
        </div>
      }
      rightSidebar={
        <div className="space-y-4 p-4">
          {inspectError && symbolFile ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              {inspectError}
            </div>
          ) : (
            <WarningsPanel warnings={selectedWarnings} />
          )}

          {selectedSymbol ? (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Symbol Details
              </h3>

              <label className="block space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                  Name
                </span>
                <input
                  value={selectedSymbol.name}
                  readOnly
                  className="h-8 w-full rounded-md border border-slate-300 bg-slate-50 px-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                  Reference prefix
                </span>
                <input
                  value={selectedSymbol.referencePrefix}
                  readOnly
                  className="h-8 w-24 rounded-md border border-slate-300 bg-slate-50 px-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                  Description
                </span>
                <textarea
                  value={selectedSymbol.description ?? ""}
                  readOnly
                  rows={3}
                  className="w-full resize-none rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200"
                />
              </label>

              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300">
                {selectedSymbol.pinCount} pins • {selectedSymbol.warningCount}{" "}
                warnings
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              Import and inspect a symbol to view details.
            </div>
          )}
        </div>
      }
    />
  );
});
