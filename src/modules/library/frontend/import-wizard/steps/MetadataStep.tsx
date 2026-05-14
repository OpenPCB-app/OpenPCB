import { memo, useEffect, type ReactElement } from "react";
import { useShallow } from "zustand/react/shallow";
import { useImportWizardStore } from "../useImportWizardStore";
import { useSymbolEditorStore } from "../editor";
import { useFootprintEditorStore } from "../footprint-editor";
import { TagTokenInput } from "../../components/TagTokenInput";
import { useLibraryTags } from "../../hooks/useLibraryTags";

interface MetadataStepProps {
  backendURL: string | null | undefined;
  moduleId: string;
}

export const MetadataStep = memo(function MetadataStep({
  backendURL,
  moduleId,
}: MetadataStepProps): ReactElement {
  const {
    componentName,
    setComponentName,
    description,
    setDescription,
    tags,
    setTags,
    tagsDirty,
    inspectData,
    selectedSymbolId,
    selectedFootprintId,
    hasFootprint,
    inputsLocked,
    symbolSource,
    footprintSource,
    generatedFootprint,
  } = useImportWizardStore(
    useShallow((s) => ({
      componentName: s.componentName,
      setComponentName: s.setComponentName,
      description: s.description,
      setDescription: s.setDescription,
      tags: s.tags,
      setTags: s.setTags,
      tagsDirty: s.tagsDirty,
      inspectData: s.inspectData,
      selectedSymbolId: s.selectedSymbolId,
      selectedFootprintId: s.selectedFootprintId,
      hasFootprint:
        s.selectedFootprintId.length > 0 ||
        (s.footprintSource === "preset" && s.generatedFootprint !== null),
      inputsLocked: s.inspectStatus === "loading",
      symbolSource: s.symbolSource,
      footprintSource: s.footprintSource,
      generatedFootprint: s.generatedFootprint,
    })),
  );

  const { tags: tagSuggestions } = useLibraryTags({
    backendURL,
    moduleId,
    excludeSystem: true,
  });

  // Auto-seed tags from generated footprint metadata if the user hasn't touched them.
  useEffect(() => {
    if (tagsDirty) return;
    const auto: string[] = [];
    if (generatedFootprint?.metadata?.tags) {
      for (const tag of generatedFootprint.metadata.tags) {
        if (typeof tag === "string" && tag.trim().length > 0) {
          auto.push(tag.trim().toLowerCase());
        }
      }
    }
    if (auto.length > 0 && auto.join("|") !== tags.join("|")) {
      setTags(auto, false);
    }
  }, [generatedFootprint, tagsDirty, tags, setTags]);

  // Pin count: drawn editor pins, or parsed symbol pin count
  const drawnPinCount = useSymbolEditorStore((s) => s.pins.length);
  const expectedPinCount =
    symbolSource === "draw"
      ? drawnPinCount
      : (inspectData?.symbols.find((s) => s.id === selectedSymbolId)
          ?.pinCount ?? null);

  // Pad count: drawn editor, preset-generated, or parsed footprint
  const drawnFpPadCount = useFootprintEditorStore((s) => s.pads.length);
  const padCount =
    footprintSource === "draw"
      ? drawnFpPadCount
      : footprintSource === "preset" && generatedFootprint
        ? generatedFootprint.source.pads.length
        : (inspectData?.footprints.find((f) => f.id === selectedFootprintId)
            ?.padCount ?? null);

  const countMismatch =
    expectedPinCount !== null &&
    padCount !== null &&
    padCount > 0 &&
    expectedPinCount > 0 &&
    expectedPinCount !== padCount;

  const symbolWarningCount = inspectData
    ? inspectData.warnings.filter((w) => w.scope === "symbol").length
    : 0;
  const footprintWarningCount = inspectData
    ? inspectData.warnings.filter((w) => w.scope === "footprint").length
    : 0;
  const totalWarnings = inspectData?.warnings.length ?? 0;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Metadata
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Review and edit the component details before importing.
        </p>

        {inputsLocked ? (
          <div className="mt-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
            Re-inspecting files. Metadata editing is temporarily locked.
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="text-slate-700 dark:text-slate-300">
              Component name <span className="text-red-500">*</span>
            </span>
            <input
              value={componentName}
              onChange={(e) => setComponentName(e.target.value)}
              placeholder="e.g. C, R, LED"
              disabled={inputsLocked}
              className="h-8 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span className="text-slate-700 dark:text-slate-300">
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Unpolarized capacitor"
              rows={3}
              disabled={inputsLocked}
              className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>

          <div className="block space-y-1 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-slate-700 dark:text-slate-300">Tags</span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                Enter, comma, or Tab to commit · Backspace to remove
              </span>
            </div>
            <TagTokenInput
              value={tags}
              onChange={(next) => setTags(next, true)}
              suggestions={tagSuggestions}
              disabled={inputsLocked}
              placeholder="e.g. passive, 0603, resistor"
            />
          </div>
        </div>

        {totalWarnings > 0 && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950">
            <div className="text-sm font-medium text-amber-800 dark:text-amber-300">
              {totalWarnings} parser warning{totalWarnings !== 1 ? "s" : ""}
            </div>
            <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              {symbolWarningCount > 0 && (
                <span>{symbolWarningCount} symbol</span>
              )}
              {symbolWarningCount > 0 && footprintWarningCount > 0 && (
                <span>, </span>
              )}
              {footprintWarningCount > 0 && (
                <span>{footprintWarningCount} footprint</span>
              )}
            </div>
          </div>
        )}

        {!hasFootprint && inspectData && (
          <div className="mt-4 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
            Importing without a footprint. Component will use visible
            placeholder: <span className="font-semibold">No footprint yet</span>
            .
          </div>
        )}

        {countMismatch && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            Pin/pad count mismatch:{" "}
            <span className="font-semibold">{expectedPinCount}</span> pin
            {expectedPinCount !== 1 ? "s" : ""} vs{" "}
            <span className="font-semibold">{padCount}</span> pad
            {padCount !== 1 ? "s" : ""}. Auto-mapping by number may leave some
            unconnected.
          </div>
        )}

        {totalWarnings === 0 && inspectData && (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
            No parser warnings
          </div>
        )}
      </div>
    </div>
  );
});
