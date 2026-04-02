import { Plus, Star, Trash2 } from "lucide-react";
import type { FootprintDraft } from "@/components/footprint-editor";
import { FootprintEditorStep } from "@/components/footprint-editor";
import type { MountType } from "@/lib/api/component-api";
import { cn } from "@/lib/utils";
import type { EditableComponentVariant } from "./component-variant-buffer";

interface ComponentVariantManagerProps {
  variants: EditableComponentVariant[];
  selectedVariantId: string | null;
  variantDirty: boolean;
  onSelectVariant: (variantId: string) => void;
  onAddVariant: () => void;
  onRemoveVariant: (variantId: string) => void;
  onSetDefaultVariant: (variantId: string) => void;
  onUpdateVariant: (
    variantId: string,
    updates: Partial<Pick<EditableComponentVariant, "humanLabel" | "mountType">>,
  ) => void;
  onImportedDraft: (draft: FootprintDraft) => void;
}

const MOUNT_TYPE_OPTIONS: Array<{ value: MountType; label: string }> = [
  { value: "smd", label: "SMD" },
  { value: "through_hole", label: "Through Hole" },
  { value: "virtual", label: "Virtual" },
];

export function ComponentVariantManager({
  variants,
  selectedVariantId,
  variantDirty,
  onSelectVariant,
  onAddVariant,
  onRemoveVariant,
  onSetDefaultVariant,
  onUpdateVariant,
  onImportedDraft,
}: ComponentVariantManagerProps) {
  const selectedVariant =
    variants.find((variant) => variant.id === selectedVariantId) ?? variants[0] ?? null;

  return (
    <section className="rounded-lg border border-border-default bg-bg-elevated p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-text-primary">Footprints / Variants</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Manage variant metadata and one concrete footprint payload per variant.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="variant-dirty-indicator"
            className="rounded-full bg-bg-input px-2.5 py-1 text-xs text-text-tertiary"
          >
            {variantDirty ? "Modified" : "Saved"}
          </span>
          <button
            type="button"
            onClick={onAddVariant}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Variant
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="rounded-md border border-border-default bg-bg-secondary p-2">
          <ul className="space-y-2">
            {variants.map((variant) => (
              <li key={variant.id} className="rounded-md border border-border-default bg-bg-elevated p-2">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectVariant(variant.id)}
                    className={cn(
                      "flex-1 rounded px-2 py-1 text-left transition-colors",
                      selectedVariant?.id === variant.id
                        ? "bg-brand/10 text-text-primary"
                        : "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
                    )}
                  >
                    <p className="text-sm font-medium">{variant.humanLabel}</p>
                    <p className="text-xs text-text-tertiary">{variant.canonicalCode}</p>
                    <p className="mt-1 text-xs uppercase text-text-muted">
                      {variant.mountType.replace("_", " ")}
                    </p>
                  </button>
                  <div className="flex flex-col items-end gap-1">
                    {variant.isDefault && (
                      <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand">
                        Default
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onSetDefaultVariant(variant.id)}
                      disabled={variant.isDefault}
                      className="rounded p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
                      title="Set as default variant"
                      aria-label={`Set ${variant.humanLabel} as default variant`}
                    >
                      <Star className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveVariant(variant.id)}
                      disabled={variants.length <= 1}
                      className="rounded p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
                      title={
                        variants.length <= 1
                          ? "At least one variant is required"
                          : "Remove variant"
                      }
                      aria-label={`Remove variant ${variant.humanLabel}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-4">
          {selectedVariant ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label
                    htmlFor="component-variant-canonical"
                    className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-secondary"
                  >
                    Canonical Code
                  </label>
                  <input
                    id="component-variant-canonical"
                    type="text"
                    value={selectedVariant.canonicalCode}
                    readOnly
                    className="w-full cursor-not-allowed rounded-md border border-border-default bg-bg-input px-3 py-2 text-sm text-text-tertiary"
                  />
                </div>

                <div>
                  <label
                    htmlFor="component-variant-label"
                    className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-secondary"
                  >
                    Variant Label
                  </label>
                  <input
                    id="component-variant-label"
                    type="text"
                    value={selectedVariant.humanLabel}
                    onChange={(event) =>
                      onUpdateVariant(selectedVariant.id, { humanLabel: event.target.value })
                    }
                    placeholder="e.g. 0603"
                    className="w-full rounded-md border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="component-variant-mount-type"
                    className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-secondary"
                  >
                    Mount Type
                  </label>
                  <select
                    id="component-variant-mount-type"
                    value={selectedVariant.mountType}
                    onChange={(event) =>
                      onUpdateVariant(selectedVariant.id, {
                        mountType: event.target.value as MountType,
                      })
                    }
                    className="w-full rounded-md border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none"
                  >
                    {MOUNT_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div
                data-testid="component-footprint-editor"
                className="h-[640px] overflow-hidden rounded-md border border-border-default"
              >
                <FootprintEditorStep onImportedDraft={onImportedDraft} />
              </div>
            </>
          ) : (
            <div className="rounded-md border border-dashed border-border-default bg-bg-secondary px-4 py-8 text-sm text-text-tertiary">
              No variant selected.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
