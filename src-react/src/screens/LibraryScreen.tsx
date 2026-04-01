import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Search, Plus, ArrowLeft, Filter, Loader2 } from "lucide-react";
import {
  SymbolEditorCanvas,
  PinPalette,
  PinPropertiesPanel,
  BodyPresetSelector,
  SymbolEditorToolbar,
  SymbolMetadataEditor,
  useSymbolEditorStore,
} from "@/components/symbol-editor";
import { FootprintEditorStep } from "@/components/footprint-editor";
import { useComponents, type UseComponentsFilters } from "@/hooks/useComponents";
import { ComponentDetailPanel } from "@/components/library/ComponentDetailPanel";
import type { ComponentFamilyType } from "@/../../src-ts/src/core/schemas/component-library.schema";

const MOUNT_TYPE_OPTIONS = [
  { value: "smd" as const, label: "SMD" },
  { value: "through_hole" as const, label: "Through-hole" },
  { value: "virtual" as const, label: "Virtual" },
];

const WIZARD_STEPS = [
  { id: 1, label: "Symbol" },
  { id: 2, label: "Footprint" },
  { id: 3, label: "3D model" },
  { id: 4, label: "Specs" },
];

export function LibraryScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [selectedComponent, setSelectedComponent] =
    useState<ComponentFamilyType | null>(null);
  const [filters, setFilters] = useState<UseComponentsFilters>({});

  const { components, loading, error } = useComponents({
    ...filters,
    search: searchQuery.trim() || undefined,
  });

  if (wizardOpen) {
    return (
      <ComponentWizard
        step={wizardStep}
        setStep={setWizardStep}
        onClose={() => setWizardOpen(false)}
      />
    );
  }

  const toggleMountType = (mountType: typeof MOUNT_TYPE_OPTIONS[number]["value"]) => {
    const currentTypes = filters.mountTypes ?? [];
    const newTypes = currentTypes.includes(mountType)
      ? currentTypes.filter((t) => t !== mountType)
      : [...currentTypes, mountType];

    setFilters({ ...filters, mountTypes: newTypes.length > 0 ? newTypes : undefined });
  };

  return (
    <>
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default bg-bg-secondary px-6 py-3">
          <h1 className="text-lg font-medium text-text-primary">
            Component Library
          </h1>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
              <input
                type="text"
                placeholder="Search components..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-64 rounded-md bg-bg-input pl-8 pr-3 text-sm text-text-primary placeholder:text-text-tertiary border border-border-default focus:border-border-strong focus:outline-none"
              />
            </div>
            <button
              className="flex items-center gap-1.5 h-9 rounded-md bg-brand px-4 text-sm font-medium text-white hover:opacity-90 transition-opacity"
              onClick={() => {
                setWizardOpen(true);
                setWizardStep(1);
              }}
            >
              <Plus className="h-4 w-4" />
              New
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="border-b border-border-default bg-bg-secondary px-6 py-3">
          <div className="flex items-center gap-4">
            {/* Scope filter */}
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-text-tertiary" />
              <span className="text-xs font-medium text-text-secondary">Scope:</span>
              <div className="flex gap-1">
                <button
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    !filters.scope
                      ? "bg-brand-bg text-brand"
                      : "bg-bg-input text-text-tertiary hover:text-text-secondary",
                  )}
                  onClick={() => setFilters({ ...filters, scope: undefined })}
                >
                  All
                </button>
                <button
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    filters.scope === "built_in"
                      ? "bg-brand-bg text-brand"
                      : "bg-bg-input text-text-tertiary hover:text-text-secondary",
                  )}
                  onClick={() => setFilters({ ...filters, scope: "built_in" })}
                >
                  Built-in
                </button>
                <button
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    filters.scope === "workspace"
                      ? "bg-brand-bg text-brand"
                      : "bg-bg-input text-text-tertiary hover:text-text-secondary",
                  )}
                  onClick={() => setFilters({ ...filters, scope: "workspace" })}
                >
                  Workspace
                </button>
              </div>
            </div>

            {/* Mount type chips */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text-secondary">Mount:</span>
              <div className="flex gap-1">
                {MOUNT_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      filters.mountTypes?.includes(option.value)
                        ? "bg-brand-bg text-brand"
                        : "bg-bg-input text-text-tertiary hover:text-text-secondary",
                    )}
                    onClick={() => toggleMountType(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Component card grid */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-text-tertiary" />
            </div>
          ) : error ? (
            <div className="mt-4 rounded-lg border border-border-default bg-bg-secondary px-4 py-8 text-center">
              <p className="text-sm text-error">{error}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
                {components.map((component) => (
                  <article
                    key={component.id}
                    className="group rounded-lg border border-border-default bg-bg-elevated hover:border-border-strong transition-colors cursor-pointer"
                    onClick={() => setSelectedComponent(component)}
                  >
                    <div className="flex h-20 items-center justify-center rounded-t-lg bg-bg-input">
                      <div className="text-4xl text-text-tertiary">
                        {component.symbolData.referencePrefix}
                      </div>
                    </div>
                    <div className="space-y-1 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[13px] font-medium text-text-primary">
                          {component.displayLabel}
                        </p>
                        <span className="rounded-full bg-bg-input px-2 py-0.5 text-[10px] font-medium tracking-wide text-text-muted uppercase">
                          {component.scope}
                        </span>
                      </div>
                      <p className="text-[11px] text-text-muted line-clamp-2">
                        {component.description || "No description"}
                      </p>
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {component.packageVariants.slice(0, 2).map((variant) => (
                          <span
                            key={variant.id}
                            className="text-[9px] bg-bg-input px-1.5 py-0.5 rounded text-text-tertiary"
                          >
                            {variant.humanLabel}
                          </span>
                        ))}
                        {component.packageVariants.length > 2 && (
                          <span className="text-[9px] text-text-tertiary">
                            +{component.packageVariants.length - 2}
                          </span>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              {components.length === 0 && (
                <div className="mt-4 rounded-lg border border-dashed border-border-default bg-bg-secondary px-4 py-8 text-center">
                  <p className="text-sm text-text-muted">
                    No components match the current filters.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selectedComponent && (
        <ComponentDetailPanel
          component={selectedComponent}
          onClose={() => setSelectedComponent(null)}
        />
      )}
    </>
  );
}

// Component Editor Wizard
function ComponentWizard({
  step,
  setStep,
  onClose,
}: {
  step: number;
  setStep: (s: number) => void;
  onClose: () => void;
}) {
  const resetDraft = useSymbolEditorStore((s) => s.resetDraft);

  // Reset draft when wizard opens
  useEffect(() => {
    resetDraft();
  }, [resetDraft]);

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      {/* Wizard header */}
      <div className="flex items-center gap-3 border-b border-border-default bg-bg-secondary px-6 py-3">
        <button
          className="text-text-tertiary hover:text-text-secondary"
          onClick={onClose}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-lg font-medium text-text-primary">New component</h1>
        <span className="text-sm text-text-tertiary">
          Step {step} of 4: {WIZARD_STEPS[step - 1]?.label}
        </span>
      </div>

      {/* Progress bar */}
      <div className="flex px-6 py-3 gap-1">
        {WIZARD_STEPS.map((s) => (
          <div key={s.id} className="flex-1 flex flex-col items-center gap-1">
            <div
              className={cn(
                "h-1 w-full rounded-full",
                s.id < step
                  ? "bg-success"
                  : s.id === step
                    ? "bg-brand"
                    : "bg-bg-input",
              )}
            />
            <span
              className={cn(
                "text-[10px]",
                s.id <= step ? "text-text-secondary" : "text-text-muted",
              )}
            >
              {s.id}. {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Step content */}
      {step === 1 ? (
        <SymbolEditorStep />
      ) : step === 2 ? (
        <FootprintEditorStep />
      ) : (
        <div className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-[800px]">
            <div className="grid grid-cols-2 gap-6">
              {/* Canvas area */}
              <div className="rounded-lg border border-border-default bg-bg-input p-4 min-h-[300px] flex items-center justify-center">
                <p className="text-sm text-text-muted">
                  {step === 3 && "3D model preview"}
                  {step === 4 && ""}
                </p>
              </div>

              {/* Config panel */}
              <div className="space-y-4">
                {step === 3 && (
                  <>
                    <p className="text-sm text-text-secondary">
                      Upload a STEP file or generate from footprint dimensions.
                    </p>
                    <div className="rounded-lg border-2 border-dashed border-border-default p-8 text-center">
                      <p className="text-sm text-text-muted">
                        Drag & drop .step/.stp file
                      </p>
                    </div>
                  </>
                )}
                {step === 4 && (
                  <>
                    <FormField label="Name" placeholder="10kΩ Chip Resistor" />
                    <FormField
                      label="Description"
                      placeholder="Thick film, ±1%, 1/16W"
                    />
                    <FormField
                      label="Category"
                      placeholder="Resistors > Chip Resistor"
                    />
                    <FormField label="MPN" placeholder="RC0402FR-0710KL" />
                    <FormField label="Manufacturer" placeholder="Yageo" />
                    <FormField label="Datasheet URL" placeholder="https://..." />
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer nav */}
      <div className="flex items-center justify-end gap-2 border-t border-border-default px-6 py-3">
        {step > 1 && (
          <button
            className="h-9 rounded-md bg-bg-input px-4 text-sm font-medium text-text-secondary hover:bg-bg-elevated transition-colors"
            onClick={() => setStep(step - 1)}
          >
            Back
          </button>
        )}
        {step < 4 ? (
          <button
            className="h-9 rounded-md bg-brand px-4 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            onClick={() => setStep(step + 1)}
          >
            Next
          </button>
        ) : (
          <button
            className="h-9 rounded-md bg-brand px-4 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            onClick={onClose}
          >
            Save Component
          </button>
        )}
      </div>
    </div>
  );
}

// Symbol Editor Step Component
function SymbolEditorStep() {
  const selection = useSymbolEditorStore((s) => s.chrome.selection);
  const hasSelection = selection.selectedPinIds.size > 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <SymbolEditorToolbar />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - Body presets and pin palette */}
        <div className="w-56 flex-shrink-0 overflow-y-auto border-r border-border-default bg-bg-secondary p-3 space-y-4">
          <BodyPresetSelector />
          <div className="border-t border-border-default pt-4">
            <PinPalette />
          </div>
        </div>

        {/* Canvas area */}
        <div className="flex-1 overflow-hidden">
          <SymbolEditorCanvas />
        </div>

        {/* Right sidebar - Metadata and pin properties */}
        <div className="w-64 flex-shrink-0 overflow-y-auto border-l border-border-default bg-bg-secondary p-3 space-y-4">
          <SymbolMetadataEditor />
          <div className="border-t border-border-default pt-4">
            {hasSelection ? (
              <PinPropertiesPanel />
            ) : (
              <div className="text-sm text-text-muted">
                <p className="font-medium text-text-secondary mb-2">Pin Properties</p>
                <p className="text-xs italic">Select a pin to edit its properties</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  placeholder,
  type = "text",
}: {
  label: string;
  placeholder: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1">
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        className="w-full h-9 rounded-md bg-bg-input px-3 text-sm text-text-primary placeholder:text-text-tertiary border border-border-default focus:border-border-strong focus:outline-none"
      />
    </div>
  );
}
