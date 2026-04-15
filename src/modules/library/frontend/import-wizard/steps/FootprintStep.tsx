import { Grid3X3, Upload } from "lucide-react";
import { memo, useId, type ReactElement } from "react";
import { FootprintPreviewCanvas } from "../../../../../shared/frontend/canvas/preview";
import { CanvasStepLayout } from "../layout/CanvasStepLayout";
import { useImportWizardStore } from "../useImportWizardStore";

const PACKAGE_TYPES = [
  { title: "Chip", subtitle: "R, C, L (0402-2512)", active: true },
  { title: "SOD", subtitle: "Small Outline Diode" },
  { title: "MELF", subtitle: "Cylindrical metal electrode" },
  { title: "Polar Cap", subtitle: "Tantalum, electrolytic" },
  { title: "SOIC", subtitle: "Small Outline IC" },
  { title: "SOT", subtitle: "Small Outline Transistor" },
  { title: "SOJ", subtitle: "J-Lead dual-row" },
  { title: "DIP", subtitle: "Through-hole dual in-line" },
  { title: "QFP", subtitle: "Quad Flat Package" },
  { title: "QFN", subtitle: "Quad Flat No-lead" },
  { title: "PLCC", subtitle: "J-Lead chip carrier" },
] as const;

export const FootprintStep = memo(function FootprintStep(): ReactElement {
  const inputId = useId();
  const footprintFiles = useImportWizardStore((s) => s.footprintFiles);
  const setFootprintFiles = useImportWizardStore((s) => s.setFootprintFiles);
  const inspectData = useImportWizardStore((s) => s.inspectData);
  const selectedFootprintId = useImportWizardStore(
    (s) => s.selectedFootprintId,
  );
  const setSelectedFootprintId = useImportWizardStore(
    (s) => s.setSelectedFootprintId,
  );
  const inspectStatus = useImportWizardStore((s) => s.inspectStatus);
  const inspectError = useImportWizardStore((s) => s.inspectError);
  const gridVisible = useImportWizardStore((s) => s.footprintGridVisible);
  const setGridVisible = useImportWizardStore((s) => s.setFootprintGridVisible);

  const variants = inspectData?.footprints ?? [];
  const selectedFootprint = variants.find(
    (variant) => variant.id === selectedFootprintId,
  );
  const selectedWarnings = inspectData
    ? inspectData.warnings.filter(
        (warning) => warning.itemId === selectedFootprintId,
      )
    : [];

  const packageCode =
    selectedFootprint?.packageCode.imperial ??
    selectedFootprint?.packageCode.metric ??
    "default";
  const displayLabel = selectedFootprint?.name ?? "-";
  const mountType = selectedFootprint?.mountType?.toUpperCase() ?? "-";

  return (
    <CanvasStepLayout
      defaultLeftWidth={330}
      defaultRightWidth={330}
      minSidebarWidth={240}
      maxSidebarWidth={520}
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
        <div className="min-h-0 space-y-3 p-3">
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
                {footprintFiles.slice(0, 3).map((file) => (
                  <div
                    key={file.name}
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

          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
              Package presets
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {PACKAGE_TYPES.map((item) => (
                <button
                  key={item.title}
                  type="button"
                  disabled
                  aria-disabled="true"
                  className={`rounded-lg border px-3 py-2 ${
                    "active" in item && item.active
                      ? "border-violet-300 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/20"
                      : "border-slate-200/70 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/30"
                  } cursor-not-allowed opacity-70`}
                >
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {item.title}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
                    {item.subtitle}
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      }
      center={
        <div className="relative h-full border-x border-slate-200 bg-slate-900 dark:border-slate-800">
          <FootprintPreviewCanvas
            model={selectedFootprint?.preview ?? null}
            className="h-full w-full"
            showGrid={gridVisible}
            fitToGeometryOnly
            emptyMessage={
              footprintFiles.length === 0
                ? "Import one or more .kicad_mod files to preview geometry."
                : "No footprint preview available for current selection."
            }
          />

          {inspectStatus === "loading" && footprintFiles.length > 0 ? (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/35">
              <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-300">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-violet-400" />
                Processing footprint files...
              </div>
            </div>
          ) : null}
        </div>
      }
      rightSidebar={
        <div className="min-h-0 space-y-3 p-3">
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
          ) : selectedWarnings.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950">
              <div className="text-xs font-medium text-amber-800 dark:text-amber-300">
                {selectedWarnings.length} warning
                {selectedWarnings.length !== 1 ? "s" : ""}
              </div>
              <div className="mt-1 space-y-1 text-xs text-amber-700 dark:text-amber-400">
                {selectedWarnings.slice(0, 2).map((warning) => (
                  <div
                    key={warning.code + warning.message}
                    className="line-clamp-2"
                  >
                    {warning.message}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

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
                            {index === 0 ? "default ★" : variant.name}
                          </div>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            {variant.padCount}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                          {variant.mountType.toUpperCase()}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  + Add Variant (Coming later)
                </button>
              </section>
            </>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              Import and inspect footprints, then select a variant to view
              details.
            </div>
          )}
        </div>
      }
    />
  );
});
