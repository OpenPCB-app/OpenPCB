import { memo, type ReactElement } from "react";
import {
  ALL_FAMILIES,
  type DensityLevel,
  type PackageFamily,
} from "../../../../shared/rendering/ipc7351b";
import { generatorUnavailableReason } from "../../shared/generator-policy";

const DENSITY_OPTIONS: { value: DensityLevel; label: string; desc: string }[] =
  [
    { value: "most", label: "A (Most)", desc: "Prototyping" },
    { value: "nominal", label: "B (Nominal)", desc: "Standard" },
    { value: "least", label: "C (Least)", desc: "High-density" },
  ];

export interface IpcSelection {
  family: PackageFamily | null;
  size: string | null;
  density: DensityLevel;
}

interface IpcPresetTabProps {
  selection: IpcSelection;
  onFamilyChange: (family: PackageFamily | null) => void;
  onSizeChange: (size: string | null) => void;
  onDensityChange: (density: DensityLevel) => void;
  onGenerate: () => void;
}

/** Presentational IPC-7351B family / size / density picker (store-free). */
export const IpcPresetTab = memo(function IpcPresetTab({
  selection,
  onFamilyChange,
  onSizeChange,
  onDensityChange,
  onGenerate,
}: IpcPresetTabProps): ReactElement {
  const presetFamily = selection.family;
  const presetSize = selection.size;
  const presetDensity = selection.density;
  const selectedFamilyDef = presetFamily
    ? ALL_FAMILIES.find((f) => f.id === presetFamily)
    : null;

  return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-control border border-border bg-surface-panel p-3">
        <h2 className="text-sm font-semibold text-text-strong">
          Package Family
        </h2>

        <div className="grid grid-cols-2 gap-1.5">
          {ALL_FAMILIES.map((family) => {
            const active = presetFamily === family.id;
            const unavailableReason = generatorUnavailableReason(
              family.id as PackageFamily,
            );
            return (
              <button
                key={family.id}
                type="button"
                aria-pressed={active}
                disabled={Boolean(unavailableReason)}
                title={unavailableReason ?? undefined}
                onClick={() =>
                  onFamilyChange(
                    active ? null : (family.id as PackageFamily),
                  )
                }
                className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                  active
                    ? "border-selection bg-surface-selected"
                    : "border-border bg-surface-control hover:bg-surface-hover"
                }`}
              >
                <div className="text-xs font-semibold text-text-strong">
                  {family.label}
                </div>
                <div className="mt-0.5 text-2xs leading-4 text-text-tertiary">
                  {unavailableReason ?? family.subtitle}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {selectedFamilyDef && (
        <section className="space-y-2 rounded-control border border-border bg-surface-panel p-3">
          <h2 className="text-sm font-semibold text-text-strong">
            Size
          </h2>

          <div className="grid grid-cols-2 gap-1.5">
            {selectedFamilyDef.sizes.map((size) => {
              const active = presetSize === size.label;
              return (
                <button
                  key={size.label}
                  type="button"
                  onClick={() => onSizeChange(active ? null : size.label)}
                  className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
                    active
                      ? "border-selection bg-surface-selected"
                      : "border-border bg-surface-panel hover:bg-surface-hover"
                  }`}
                >
                  <div className="text-xs font-semibold text-text-strong">
                    {size.label}
                  </div>
                  <div className="text-2xs text-text-tertiary">
                    {size.subtitle}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {presetFamily && presetSize && (
        <section className="space-y-2 rounded-control border border-border bg-surface-panel p-3">
          <h2 className="text-sm font-semibold text-text-strong">
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
                  onClick={() => onDensityChange(opt.value)}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-center transition-colors ${
                    active
                      ? "border-selection bg-surface-selected"
                      : "border-border bg-surface-panel hover:bg-surface-hover"
                  }`}
                >
                  <div className="text-xs font-semibold text-text-strong">
                    {opt.label}
                  </div>
                  <div className="text-2xs text-text-tertiary">
                    {opt.desc}
                  </div>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onGenerate}
            className="mt-1 h-9 w-full cursor-pointer rounded-control border border-primary bg-primary text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            Generate footprint
          </button>
        </section>
      )}
    </div>
  );
});
