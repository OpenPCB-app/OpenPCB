import { useState } from "react";
import { cn } from "@/lib/utils";
import { Search, Plus, ArrowLeft } from "lucide-react";

// Mock data for placeholder component cards
const MOCK_COMPONENTS = [
  {
    id: "1",
    name: "10kΩ Resistor",
    mpn: "RC0402FR-0710KL",
    mfr: "Yageo",
    pkg: "0402",
    price: "$0.002",
    stock: "45K",
  },
  {
    id: "2",
    name: "100nF Capacitor",
    mpn: "CL05B104KO5NNNC",
    mfr: "Samsung",
    pkg: "0402",
    price: "$0.003",
    stock: "120K",
  },
  {
    id: "3",
    name: "ESP32-S3",
    mpn: "ESP32-S3-WROOM-1",
    mfr: "Espressif",
    pkg: "Module",
    price: "$2.85",
    stock: "12K",
  },
  {
    id: "4",
    name: "AMS1117-3.3",
    mpn: "AMS1117-3.3",
    mfr: "AMS",
    pkg: "SOT-223",
    price: "$0.15",
    stock: "8K",
  },
  {
    id: "5",
    name: "USB-C Connector",
    mpn: "USB4110-GF-A",
    mfr: "GCT",
    pkg: "SMD",
    price: "$0.45",
    stock: "25K",
  },
  {
    id: "6",
    name: "Red LED",
    mpn: "19-217/R6C-AL1M2VY/3T",
    mfr: "Everlight",
    pkg: "0603",
    price: "$0.01",
    stock: "500K",
  },
];

const FILTERS = ["All", "My parts", "Built-in", "Community"];

const WIZARD_STEPS = [
  { id: 1, label: "Symbol" },
  { id: 2, label: "Footprint" },
  { id: 3, label: "3D model" },
  { id: 4, label: "Specs" },
];

export function LibraryScreen() {
  const [activeFilter, setActiveFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);

  if (wizardOpen) {
    return (
      <ComponentWizard
        step={wizardStep}
        setStep={setWizardStep}
        onClose={() => setWizardOpen(false)}
      />
    );
  }

  return (
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

      {/* Filter pills */}
      <div className="flex items-center gap-2 border-b border-border-default bg-bg-secondary px-6 py-2">
        {FILTERS.map((filter) => (
          <button
            key={filter}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              activeFilter === filter
                ? "bg-brand-bg text-brand"
                : "bg-bg-input text-text-tertiary hover:text-text-secondary",
            )}
            onClick={() => setActiveFilter(filter)}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Component card grid */}
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
          {MOCK_COMPONENTS.filter(
            (c) =>
              !searchQuery ||
              c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              c.mpn.toLowerCase().includes(searchQuery.toLowerCase()),
          ).map((comp) => (
            <div
              key={comp.id}
              className="group rounded-lg border border-border-default bg-bg-elevated hover:border-border-strong transition-colors cursor-pointer"
            >
              {/* Symbol preview placeholder */}
              <div className="h-20 rounded-t-lg bg-bg-input flex items-center justify-center">
                <div className="h-10 w-10 rounded border border-border-default bg-bg-primary" />
              </div>
              <div className="p-2.5">
                <p className="text-[13px] font-medium text-text-primary truncate">
                  {comp.name}
                </p>
                <p className="text-[11px] font-mono text-text-tertiary truncate">
                  {comp.mpn}
                </p>
                <p className="text-[11px] text-text-muted mt-0.5">
                  {comp.mfr} · {comp.pkg}
                </p>
                <p className="text-[11px] text-text-muted">
                  {comp.price} · {comp.stock} in stock
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
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
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-[800px]">
          <div className="grid grid-cols-2 gap-6">
            {/* Canvas area */}
            <div className="rounded-lg border border-border-default bg-bg-input p-4 min-h-[300px] flex items-center justify-center">
              <p className="text-sm text-text-muted">
                {step === 1 && "Symbol editor canvas"}
                {step === 2 && "Footprint editor canvas"}
                {step === 3 && "3D model preview"}
                {step === 4 && ""}
              </p>
            </div>

            {/* Config panel */}
            <div className="space-y-4">
              {step === 1 && (
                <>
                  <FormField
                    label="Component name"
                    placeholder="e.g. 10kΩ Resistor"
                  />
                  <FormField
                    label="Reference prefix"
                    placeholder="e.g. R, C, U"
                  />
                  <FormField
                    label="Pin count"
                    placeholder="e.g. 2"
                    type="number"
                  />
                </>
              )}
              {step === 2 && (
                <>
                  <FormField label="Pad shape" placeholder="Rect" />
                  <FormField label="Width" placeholder="1.2mm" />
                  <FormField label="Height" placeholder="0.6mm" />
                  <FormField label="Pitch" placeholder="2.54mm" />
                </>
              )}
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
