import { memo, useEffect, useState, type ReactElement } from "react";
import { useShallow } from "zustand/react/shallow";
import { SymbolPreviewCanvas } from "../../../../../shared/frontend/canvas/preview";
import { WarningsPanel } from "../components/WarningsPanel";
import {
  SymbolEditorCanvas,
  EditorToolbar,
  PinPropertyPanel,
  useSymbolEditorStore,
} from "../editor";
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
    symbolSource,
    setSymbolSource,
  } = useImportWizardStore(
    useShallow((s) => ({
      symbolFile: s.symbolFile,
      setSymbolFile: s.setSymbolFile,
      inspectData: s.inspectData,
      selectedSymbolId: s.selectedSymbolId,
      setSelectedSymbolId: s.setSelectedSymbolId,
      inspectStatus: s.inspectStatus,
      inspectError: s.inspectError,
      symbolSource: s.symbolSource,
      setSymbolSource: s.setSymbolSource,
    })),
  );

  const isDrawMode = symbolSource === "draw";

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
      topContent={isDrawMode ? <EditorToolbar /> : <ImportTopBar />}
      leftSidebar={
        <div className="min-h-0 space-y-3 p-3">
          {/* Source toggle */}
          <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setSymbolSource("import")}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                !isDrawMode
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              Import file
            </button>
            <button
              type="button"
              onClick={() => setSymbolSource("draw")}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                isDrawMode
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              Draw symbol
            </button>
          </div>

          {isDrawMode ? (
            <DrawModeSidebar />
          ) : (
            <ImportModeSidebar
              symbolFile={symbolFile}
              inspectData={inspectData}
              selectedSymbolId={selectedSymbolId}
              handleSymbolFileSelect={handleSymbolFileSelect}
              setSelectedSymbolId={setSelectedSymbolId}
            />
          )}
        </div>
      }
      center={
        <div className="relative h-full border-x border-slate-200 bg-slate-900 dark:border-slate-800">
          {isDrawMode ? (
            <SymbolEditorCanvas className="h-full w-full" />
          ) : (
            <>
              <SymbolPreviewCanvas
                model={selectedSymbol?.preview ?? null}
                className="h-full w-full"
                showGrid
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
            </>
          )}
        </div>
      }
      rightSidebar={
        <div className="min-h-0 space-y-3 p-3">
          {isDrawMode ? (
            <DrawModeRightSidebar />
          ) : (
            <ImportModeRightSidebar
              inspectError={inspectError}
              symbolFile={symbolFile}
              selectedWarnings={selectedWarnings}
              selectedSymbol={selectedSymbol}
            />
          )}
        </div>
      }
    />
  );
});

// ── Import mode top bar ─────────────────────────────────────────────

function ImportTopBar(): ReactElement {
  const gridVisible = useImportWizardStore((s) => s.symbolGridVisible);
  const setGridVisible = useImportWizardStore((s) => s.setSymbolGridVisible);

  return (
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
        Grid
      </button>
      <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />
      <div className="text-xs text-slate-500 dark:text-slate-400">
        Zoom: scroll wheel
      </div>
    </div>
  );
}

// ── Import mode sidebars ────────────────────────────────────────────

import type {
  InspectPayload,
  InspectSymbolItem,
  ImportWarning,
} from "../../types";

function ImportModeSidebar({
  symbolFile,
  inspectData,
  selectedSymbolId,
  handleSymbolFileSelect,
  setSelectedSymbolId,
}: {
  symbolFile: File | null;
  inspectData: InspectPayload | null;
  selectedSymbolId: string;
  handleSymbolFileSelect: (files: FileList | null) => void;
  setSelectedSymbolId: (id: string) => void;
}): ReactElement {
  return (
    <>
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
    </>
  );
}

function ImportModeRightSidebar({
  inspectError,
  symbolFile,
  selectedWarnings,
  selectedSymbol,
}: {
  inspectError: string | null;
  symbolFile: File | null;
  selectedWarnings: ImportWarning[];
  selectedSymbol: InspectSymbolItem | undefined;
}): ReactElement {
  return (
    <>
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
          <dl className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Name</dt>
              <dd className="font-medium text-slate-700 dark:text-slate-100">
                {selectedSymbol.name}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Reference</dt>
              <dd className="font-medium text-slate-700 dark:text-slate-100">
                {selectedSymbol.referencePrefix}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Pins</dt>
              <dd className="font-medium text-slate-700 dark:text-slate-100">
                {selectedSymbol.pinCount}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">
                Description
              </dt>
              <dd className="min-w-0 truncate font-medium text-slate-700 dark:text-slate-100">
                {selectedSymbol.description ?? "-"}
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Import and inspect a symbol to view details.
        </div>
      )}
    </>
  );
}

// ── Draw mode sidebars ──────────────────────────────────────────────

function DrawModeSidebar(): ReactElement {
  const referencePrefix = useSymbolEditorStore((s) => s.referencePrefix);

  return (
    <>
      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          Properties
        </div>
        <label className="block space-y-1">
          <span className="text-xs text-slate-600 dark:text-slate-300">
            Reference prefix
          </span>
          <input
            value={referencePrefix}
            onChange={(e) =>
              useSymbolEditorStore.getState().setReferencePrefix(e.target.value)
            }
            placeholder="U"
            className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
      </section>

      <PinPropertyPanel />

      <section className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          Shortcuts
        </div>
        <div className="mt-2 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
          <div>
            <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">V</kbd>{" "}
            Select
          </div>
          <div>
            <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">L</kbd>{" "}
            Line
          </div>
          <div>
            <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">R</kbd>{" "}
            Rectangle (Rotate when selection active)
          </div>
          <div>
            <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">C</kbd>{" "}
            Circle
          </div>
          <div>
            <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">A</kbd>{" "}
            Arc
          </div>
          <div>
            <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">P</kbd>{" "}
            Pin
          </div>
          <div>
            <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">T</kbd>{" "}
            Text
          </div>
          <div>
            <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">R</kbd>{" "}
            Rotate selection (Shift+R = CW)
          </div>
          <div>
            <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">
              ⌘C
            </kbd>{" "}
            Copy /{" "}
            <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">
              ⌘V
            </kbd>{" "}
            Paste /{" "}
            <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">
              ⌘D
            </kbd>{" "}
            Duplicate
          </div>
          <div>
            <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">
              ⌘A
            </kbd>{" "}
            Select all /{" "}
            <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">
              Del
            </kbd>{" "}
            Delete selected
          </div>
        </div>
      </section>
    </>
  );
}

function DrawModeRightSidebar(): ReactElement {
  const graphics = useSymbolEditorStore((s) => s.graphics);
  const pins = useSymbolEditorStore((s) => s.pins);
  const activeTool = useSymbolEditorStore((s) => s.activeTool);

  return (
    <>
      {activeTool === "pin" ? <PinDefaultsPanel /> : null}
      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Drawing Summary
        </h3>
        <dl className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-slate-500 dark:text-slate-400">Graphics</dt>
            <dd className="font-medium text-slate-700 dark:text-slate-100">
              {graphics.length}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-slate-500 dark:text-slate-400">Pins</dt>
            <dd className="font-medium text-slate-700 dark:text-slate-100">
              {pins.length}
            </dd>
          </div>
        </dl>
        {graphics.length === 0 && pins.length === 0 && (
          <div className="text-xs text-slate-400 dark:text-slate-500">
            Use the drawing tools to create a symbol. Add at least one pin
            before proceeding.
          </div>
        )}
      </section>
    </>
  );
}

const PIN_DEFAULT_TYPES: readonly { value: string; label: string }[] = [
  { value: "passive", label: "Passive" },
  { value: "input", label: "Input" },
  { value: "output", label: "Output" },
  { value: "bidirectional", label: "Bidirectional" },
  { value: "tri_state", label: "Tri-state" },
  { value: "open_collector", label: "Open collector" },
  { value: "open_emitter", label: "Open emitter" },
  { value: "power_in", label: "Power in" },
  { value: "power_out", label: "Power out" },
  { value: "unconnected", label: "Unconnected" },
  { value: "no_connect", label: "No connect" },
];

const PIN_DEFAULT_ROTATIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: "0° →" },
  { value: 90, label: "90° ↑" },
  { value: 180, label: "180° ←" },
  { value: 270, label: "270° ↓" },
];

function PinDefaultsPanel(): ReactElement {
  const pinDefaults = useSymbolEditorStore((s) => s.pinDefaults);
  const setPinDefaults = useSymbolEditorStore.getState().setPinDefaults;
  const [lengthDraft, setLengthDraft] = useState(String(pinDefaults.lengthMm));
  useEffect(
    () => setLengthDraft(String(pinDefaults.lengthMm)),
    [pinDefaults.lengthMm],
  );

  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
        Next pin defaults
      </div>
      <label className="block space-y-0.5">
        <span className="block text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Type
        </span>
        <select
          value={pinDefaults.electricalType}
          onChange={(e) =>
            setPinDefaults({ electricalType: e.currentTarget.value })
          }
          className="h-7 w-full rounded-md border border-slate-300 bg-white px-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          {PIN_DEFAULT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-0.5">
        <span className="block text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Rotation
        </span>
        <select
          value={pinDefaults.rotationDeg}
          onChange={(e) =>
            setPinDefaults({ rotationDeg: Number(e.currentTarget.value) })
          }
          className="h-7 w-full rounded-md border border-slate-300 bg-white px-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          {PIN_DEFAULT_ROTATIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-0.5">
        <span className="block text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Length (mm)
        </span>
        <input
          type="number"
          step={0.635}
          min={0}
          value={lengthDraft}
          onChange={(e) => setLengthDraft(e.currentTarget.value)}
          onBlur={() => {
            const next = Number(lengthDraft);
            if (
              Number.isFinite(next) &&
              next > 0 &&
              next !== pinDefaults.lengthMm
            ) {
              setPinDefaults({ lengthMm: next });
            } else {
              setLengthDraft(String(pinDefaults.lengthMm));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") {
              setLengthDraft(String(pinDefaults.lengthMm));
              e.currentTarget.blur();
            }
          }}
          className="h-7 w-full rounded-md border border-slate-300 bg-white px-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </label>
      <div className="text-[10px] text-slate-400 dark:text-slate-500">
        New pins placed with P tool inherit these.
      </div>
    </section>
  );
}
