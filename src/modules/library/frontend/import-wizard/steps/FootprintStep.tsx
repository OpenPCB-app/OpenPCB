import { Grid3X3, Upload } from "lucide-react";
import { memo, useId, type ReactElement } from "react";
import { useShallow } from "zustand/react/shallow";
import { FootprintPreviewCanvas } from "../../../../../shared/frontend/canvas/preview";
import { FootprintPresetPicker } from "../components/FootprintPresetPicker";
import { WarningsPanel } from "../components/WarningsPanel";
import { CanvasStepLayout } from "../layout/CanvasStepLayout";
import { useImportWizardStore } from "../useImportWizardStore";
import {
  FootprintEditorCanvas,
  FootprintEditorToolbar,
  LayerPanel,
  PadPropertyPanel,
  useFootprintEditorStore,
} from "../footprint-editor";
import { isCopperLayer } from "../footprint-editor/types";

export const FootprintStep = memo(function FootprintStep(): ReactElement {
  const inputId = useId();

  const {
    footprintFiles,
    setFootprintFiles,
    inspectData,
    selectedFootprintId,
    setSelectedFootprintId,
    inspectStatus,
    inspectError,
    gridVisible,
    setGridVisible,
    footprintSource,
    setFootprintSource,
    generatedFootprint,
  } = useImportWizardStore(
    useShallow((s) => ({
      footprintFiles: s.footprintFiles,
      setFootprintFiles: s.setFootprintFiles,
      inspectData: s.inspectData,
      selectedFootprintId: s.selectedFootprintId,
      setSelectedFootprintId: s.setSelectedFootprintId,
      inspectStatus: s.inspectStatus,
      inspectError: s.inspectError,
      gridVisible: s.footprintGridVisible,
      setGridVisible: s.setFootprintGridVisible,
      footprintSource: s.footprintSource,
      setFootprintSource: s.setFootprintSource,
      generatedFootprint: s.generatedFootprint,
    })),
  );

  const isPresetMode = footprintSource === "preset";
  const isDrawMode = footprintSource === "draw";

  // Import mode data
  const variants = inspectData?.footprints ?? [];
  const selectedFootprint = variants.find(
    (variant) => variant.id === selectedFootprintId,
  );
  const selectedWarnings = inspectData
    ? inspectData.warnings.filter(
        (warning) => warning.itemId === selectedFootprintId,
      )
    : [];

  // Resolve which model to show in canvas
  const canvasModel = isPresetMode
    ? (generatedFootprint?.model ?? null)
    : (selectedFootprint?.preview ?? null);

  const emptyMessage = isPresetMode
    ? "Select a package family and size, then click Generate."
    : footprintFiles.length === 0
      ? "Import one or more .kicad_mod files to preview geometry."
      : "No footprint preview available for current selection.";

  // Import mode detail values
  const packageCode =
    selectedFootprint?.packageCode.imperial ??
    selectedFootprint?.packageCode.metric ??
    "default";
  const displayLabel = selectedFootprint?.name ?? "-";
  const mountType = selectedFootprint?.mountType?.toUpperCase() ?? "-";

  const sourceTabClass = (active: boolean) =>
    `flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
      active
        ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
        : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
    }`;

  return (
    <CanvasStepLayout
      defaultLeftWidth={330}
      defaultRightWidth={330}
      minSidebarWidth={240}
      maxSidebarWidth={520}
      topContent={
        isDrawMode ? (
          <FootprintEditorToolbar />
        ) : (
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
        )
      }
      leftSidebar={
        <div className="min-h-0 space-y-3 p-3">
          {/* Source toggle — 3 tabs */}
          <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setFootprintSource("import")}
              className={sourceTabClass(footprintSource === "import")}
            >
              Import
            </button>
            <button
              type="button"
              onClick={() => setFootprintSource("preset")}
              className={sourceTabClass(footprintSource === "preset")}
            >
              Preset
            </button>
            <button
              type="button"
              onClick={() => setFootprintSource("draw")}
              className={sourceTabClass(footprintSource === "draw")}
            >
              Draw
            </button>
          </div>

          {isDrawMode ? (
            <DrawFootprintSidebar />
          ) : isPresetMode ? (
            <FootprintPresetPicker />
          ) : (
            <>
              <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Import Footprints
                </h2>

                <input
                  id={inputId}
                  type="file"
                  accept=".kicad_mod"
                  multiple
                  onClick={(event) => {
                    event.currentTarget.value = "";
                  }}
                  onChange={(event) =>
                    setFootprintFiles(
                      event.target.files ? Array.from(event.target.files) : [],
                    )
                  }
                  className="sr-only"
                />
                <label
                  htmlFor={inputId}
                  className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-violet-500 bg-violet-600 px-3 text-xs font-semibold text-white"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Import .kicad_mod
                </label>

                {footprintFiles.length > 0 ? (
                  <div className="space-y-1.5">
                    {footprintFiles.slice(0, 3).map((file, index) => (
                      <div
                        key={`${index}-${file.name}-${file.size}`}
                        className="max-w-full truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300"
                        title={file.name}
                      >
                        {file.name}
                      </div>
                    ))}
                    {footprintFiles.length > 3 ? (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        +{footprintFiles.length - 3} more files
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Import one or more .kicad_mod files.
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      }
      center={
        <div className="relative h-full border-x border-slate-200 bg-slate-900 dark:border-slate-800">
          {isDrawMode ? (
            <FootprintEditorCanvas className="h-full w-full" />
          ) : (
            <>
              <FootprintPreviewCanvas
                model={canvasModel}
                className="h-full w-full"
                showGrid={gridVisible}
                fitToGeometryOnly
                emptyMessage={emptyMessage}
              />
              {footprintSource === "import" &&
              inspectStatus === "loading" &&
              footprintFiles.length > 0 ? (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950/35">
                  <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-300">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-violet-400" />
                    Processing footprint files...
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
            <DrawFootprintRightSidebar />
          ) : isPresetMode ? (
            <PresetRightSidebar />
          ) : (
            <ImportRightSidebar
              inspectData={inspectData}
              selectedFootprintId={selectedFootprintId}
              inspectError={inspectError}
              footprintFiles={footprintFiles}
              selectedWarnings={selectedWarnings}
              selectedFootprint={selectedFootprint}
              packageCode={packageCode}
              displayLabel={displayLabel}
              mountType={mountType}
              variants={variants}
              setSelectedFootprintId={setSelectedFootprintId}
            />
          )}
        </div>
      }
    />
  );
});

// ── Right sidebar: Preset mode ──────────────────────────────────────

function PresetRightSidebar(): ReactElement {
  const generatedFootprint = useImportWizardStore((s) => s.generatedFootprint);

  if (!generatedFootprint) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        Select a package family and size, then generate a footprint to view
        details.
      </div>
    );
  }

  const { metadata, model } = generatedFootprint;

  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
        Generated Footprint
      </h3>
      <dl className="space-y-1.5 text-xs">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <dt className="text-slate-500 dark:text-slate-400">Name</dt>
          <dd className="min-w-0 truncate font-medium text-slate-700 dark:text-slate-100">
            {metadata.name}
          </dd>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <dt className="text-slate-500 dark:text-slate-400">Package code</dt>
          <dd className="font-medium text-slate-700 dark:text-slate-100">
            {metadata.packageCode.imperial ??
              metadata.packageCode.metric ??
              "-"}
          </dd>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <dt className="text-slate-500 dark:text-slate-400">Mount type</dt>
          <dd className="font-medium text-slate-700 dark:text-slate-100">
            {metadata.mountType?.toUpperCase() ?? "-"}
          </dd>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <dt className="text-slate-500 dark:text-slate-400">Pads</dt>
          <dd className="font-medium text-slate-700 dark:text-slate-100">
            {model.pads.length}
          </dd>
        </div>
      </dl>
      <div className="mt-1 flex flex-wrap gap-1">
        {metadata.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          >
            {tag}
          </span>
        ))}
      </div>
    </section>
  );
}

// ── Right sidebar: Import mode ──────────────────────────────────────

import type {
  InspectFootprintItem,
  InspectPayload,
  ImportWarning,
} from "../../types";

function ImportRightSidebar({
  inspectData,
  selectedFootprintId,
  inspectError,
  footprintFiles,
  selectedWarnings,
  selectedFootprint,
  packageCode,
  displayLabel,
  mountType,
  variants,
  setSelectedFootprintId,
}: {
  inspectData: InspectPayload | null;
  selectedFootprintId: string;
  inspectError: string | null;
  footprintFiles: File[];
  selectedWarnings: ImportWarning[];
  selectedFootprint: InspectFootprintItem | undefined;
  packageCode: string;
  displayLabel: string;
  mountType: string;
  variants: InspectFootprintItem[];
  setSelectedFootprintId: (id: string) => void;
}): ReactElement {
  return (
    <>
      {inspectData && selectedFootprintId.length === 0 ? (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
          No footprint selected. Import will use visible placeholder{" "}
          <span className="font-semibold">No footprint yet</span>.
        </div>
      ) : null}

      {inspectError && footprintFiles.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {inspectError}
        </div>
      ) : (
        <WarningsPanel warnings={selectedWarnings} />
      )}

      {selectedFootprint ? (
        <>
          <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Footprint Details
            </h3>
            <dl className="space-y-1.5 text-xs">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">
                  Package code
                </dt>
                <dd
                  className="min-w-0 truncate font-medium text-slate-700 dark:text-slate-100"
                  title={packageCode}
                >
                  {packageCode}
                </dd>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">
                  Display label
                </dt>
                <dd
                  className="min-w-0 truncate text-right font-medium text-slate-700 dark:text-slate-100"
                  title={displayLabel}
                >
                  {displayLabel}
                </dd>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">
                  Mount type
                </dt>
                <dd className="font-medium text-slate-700 dark:text-slate-100">
                  {mountType}
                </dd>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">Pads</dt>
                <dd className="font-medium text-slate-700 dark:text-slate-100">
                  {selectedFootprint.padCount}
                </dd>
              </div>
            </dl>
          </section>

          <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Package Variants
            </h3>

            <div className="space-y-1.5">
              {variants.map((variant, index) => {
                const selected = variant.id === selectedFootprintId;
                return (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => setSelectedFootprintId(variant.id)}
                    className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors ${
                      selected
                        ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30"
                        : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900"
                    }`}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        {index === 0 ? "default \u2605" : variant.name}
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {variant.padCount}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      {variant.mountType?.toUpperCase() ?? "-"}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Import and inspect footprints, then select a variant to view details.
        </div>
      )}
    </>
  );
}

// ── Draw mode sidebars ──────────────────────────────────────────────

function DrawFootprintSidebar(): ReactElement {
  const footprintName = useFootprintEditorStore((s) => s.footprintName);
  const activeLayer = useFootprintEditorStore((s) => s.activeLayer);
  const copperDrawMode = useFootprintEditorStore((s) => s.copperDrawMode);

  return (
    <>
      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          Properties
        </div>
        <label className="block space-y-1">
          <span className="text-xs text-slate-600 dark:text-slate-300">
            Footprint name
          </span>
          <input
            value={footprintName}
            onChange={(e) =>
              useFootprintEditorStore
                .getState()
                .setFootprintName(e.target.value)
            }
            placeholder="e.g. MY_0603"
            className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>

        {isCopperLayer(activeLayer) && (
          <div className="space-y-1">
            <span className="text-xs text-slate-600 dark:text-slate-300">
              Copper shapes
            </span>
            <div className="inline-flex w-full overflow-hidden rounded-md border border-slate-300 dark:border-slate-700">
              {(["pad", "graphic"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() =>
                    useFootprintEditorStore.getState().setCopperDrawMode(mode)
                  }
                  className={`flex-1 cursor-pointer px-2 py-1 text-[11px] font-medium transition-colors ${
                    copperDrawMode === mode
                      ? "bg-violet-600 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  {mode === "pad" ? "Pads" : "Graphics"}
                </button>
              ))}
            </div>
            <p className="text-[10px] leading-tight text-slate-400 dark:text-slate-500">
              Rect/Circle on {activeLayer} →{" "}
              {copperDrawMode === "pad" ? "numbered pads" : "filled copper"}.
              Hold ⌘/Ctrl while drawing to flip.
            </p>
          </div>
        )}
      </section>

      <LayerPanel />

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
            Rect (Rotate when selection active)
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
            <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">D</kbd>{" "}
            Pad (Shift+click = mirror)
          </div>
          <div>
            <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">T</kbd>{" "}
            Text
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
              Del
            </kbd>{" "}
            Delete selected
          </div>
        </div>
      </section>
    </>
  );
}

function DrawFootprintRightSidebar(): ReactElement {
  const pads = useFootprintEditorStore((s) => s.pads);
  const graphics = useFootprintEditorStore((s) => s.graphics);

  return (
    <>
      <PadPropertyPanel />

      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Drawing Summary
        </h3>
        <dl className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-slate-500 dark:text-slate-400">Pads</dt>
            <dd className="font-medium text-slate-700 dark:text-slate-100">
              {pads.length}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-slate-500 dark:text-slate-400">Graphics</dt>
            <dd className="font-medium text-slate-700 dark:text-slate-100">
              {graphics.length}
            </dd>
          </div>
        </dl>
        {pads.length === 0 && graphics.length === 0 && (
          <div className="text-xs text-slate-400 dark:text-slate-500">
            Use the Pad (D) and drawing tools to create a footprint.
          </div>
        )}
      </section>
    </>
  );
}
