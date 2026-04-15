import { memo, useCallback, type ReactElement } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ALL_FAMILIES,
  generateFootprint,
  type DensityLevel,
  type PackageFamily,
} from "../../../../../shared/rendering/ipc7351b";
import { useImportWizardStore } from "../useImportWizardStore";

const DENSITY_OPTIONS: { value: DensityLevel; label: string; desc: string }[] =
  [
    { value: "most", label: "A (Most)", desc: "Prototyping" },
    { value: "nominal", label: "B (Nominal)", desc: "Standard" },
    { value: "least", label: "C (Least)", desc: "High-density" },
  ];

export const FootprintPresetPicker = memo(
  function FootprintPresetPicker(): ReactElement {
    const {
      presetFamily,
      presetSize,
      presetDensity,
      setPresetFamily,
      setPresetSize,
      setPresetDensity,
      setGeneratedFootprint,
    } = useImportWizardStore(
      useShallow((s) => ({
        presetFamily: s.presetFamily,
        presetSize: s.presetSize,
        presetDensity: s.presetDensity,
        setPresetFamily: s.setPresetFamily,
        setPresetSize: s.setPresetSize,
        setPresetDensity: s.setPresetDensity,
        setGeneratedFootprint: s.setGeneratedFootprint,
      })),
    );

    const selectedFamilyDef = presetFamily
      ? ALL_FAMILIES.find((f) => f.id === presetFamily)
      : null;

    const handleGenerate = useCallback(() => {
      if (!presetFamily || !presetSize) return;
      try {
        const result = generateFootprint(
          presetFamily,
          presetSize,
          presetDensity,
        );
        setGeneratedFootprint(result);
      } catch (err) {
        console.error("[FootprintPresetPicker] Generation failed:", err);
      }
    }, [presetFamily, presetSize, presetDensity, setGeneratedFootprint]);

    return (
      <div className="space-y-3">
        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Package Family
          </h2>

          <div className="grid grid-cols-2 gap-1.5">
            {ALL_FAMILIES.map((family) => {
              const active = presetFamily === family.id;
              return (
                <button
                  key={family.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setPresetFamily(
                      active ? null : (family.id as PackageFamily),
                    )
                  }
                  className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    active
                      ? "border-violet-500 bg-violet-50 dark:border-violet-600 dark:bg-violet-950/30"
                      : "border-slate-200/70 bg-slate-50/60 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/30 dark:hover:border-slate-700"
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {family.label}
                  </div>
                  <div className="mt-0.5 text-[10px] leading-4 text-slate-400 dark:text-slate-500">
                    {family.subtitle}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {selectedFamilyDef && (
          <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Size
            </h2>

            <div className="grid grid-cols-2 gap-1.5">
              {selectedFamilyDef.sizes.map((size) => {
                const active = presetSize === size.label;
                return (
                  <button
                    key={size.label}
                    type="button"
                    onClick={() => setPresetSize(active ? null : size.label)}
                    className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
                      active
                        ? "border-violet-500 bg-violet-50 dark:border-violet-600 dark:bg-violet-950/30"
                        : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {size.label}
                    </div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500">
                      {size.subtitle}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {presetFamily && presetSize && (
          <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Density Level
            </h2>

            <div className="flex gap-1.5">
              {DENSITY_OPTIONS.map((opt) => {
                const active = presetDensity === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPresetDensity(opt.value)}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-center transition-colors ${
                      active
                        ? "border-violet-500 bg-violet-50 dark:border-violet-600 dark:bg-violet-950/30"
                        : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {opt.label}
                    </div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500">
                      {opt.desc}
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              className="mt-1 h-9 w-full rounded-lg border border-violet-500 bg-violet-600 text-xs font-semibold text-white hover:bg-violet-700"
            >
              Generate footprint
            </button>
          </section>
        )}
      </div>
    );
  },
);
