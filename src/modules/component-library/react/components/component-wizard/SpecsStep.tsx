/**
 * SpecsStep Component
 *
 * Step 5 of the component wizard - metadata and specifications form.
 * Edits: name, description, category, MPN, manufacturer, datasheet URL.
 */

import { useCallback } from "react";
import { useComponentWizardStore } from "@/stores/component-wizard-store";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SpecsStep() {
  const draft = useComponentWizardStore((s) => s.draft);
  const updateDraft = useComponentWizardStore((s) => s.updateDraft);

  const handleChange = useCallback(
    (field: string, value: string) => {
      updateDraft({
        specs: {
          ...draft?.specs,
          [field]: value,
        },
      });
    },
    [draft?.specs, updateDraft],
  );

  const handleLabelChange = useCallback(
    (value: string) => {
      updateDraft({ displayLabel: value });
    },
    [updateDraft],
  );

  const handleDescriptionChange = useCallback(
    (value: string) => {
      updateDraft({ description: value });
    },
    [updateDraft],
  );

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-[600px] space-y-6">
        <div className="text-center mb-8">
          <h2 className="text-xl font-semibold text-text-primary mb-2">
            Component Details
          </h2>
          <p className="text-sm text-text-muted">
            Add metadata and specifications for your component.
          </p>
        </div>

        {/* Basic info */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-text-secondary border-b border-border-default pb-2">
            Basic Information
          </h3>

          <FormField
            label="Display Name"
            placeholder="10kΩ Chip Resistor"
            value={draft?.displayLabel ?? ""}
            onChange={handleLabelChange}
            required
          />

          <FormField
            label="Description"
            placeholder="Thick film, ±1%, 1/16W"
            value={draft?.description ?? ""}
            onChange={handleDescriptionChange}
            multiline
          />

          <FormField
            label="Category"
            placeholder="Resistors > Chip Resistor"
            value={draft?.specs?.category ?? ""}
            onChange={(v) => handleChange("category", v)}
          />
        </div>

        {/* Part identification */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-text-secondary border-b border-border-default pb-2">
            Part Identification
          </h3>

          <FormField
            label="Manufacturer Part Number (MPN)"
            placeholder="RC0402FR-0710KL"
            value={draft?.specs?.mpn ?? ""}
            onChange={(v) => handleChange("mpn", v)}
          />

          <FormField
            label="Manufacturer"
            placeholder="Yageo"
            value={draft?.specs?.manufacturer ?? ""}
            onChange={(v) => handleChange("manufacturer", v)}
          />

          <FormField
            label="Datasheet URL"
            placeholder="https://www.yageo.com/upload/media/product/productsearch/datasheet/..."
            value={draft?.specs?.datasheetUrl ?? ""}
            onChange={(v) => handleChange("datasheetUrl", v)}
            type="url"
          />
        </div>

        {/* Info note */}
        <div className="rounded-md border border-border-default bg-bg-secondary p-4">
          <p className="text-xs text-text-muted">
            <strong className="text-text-secondary">Tip:</strong> You can leave
            optional fields empty and fill them in later by editing the component
            in your library.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FormField
// ---------------------------------------------------------------------------

interface FormFieldProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "url";
  multiline?: boolean;
  required?: boolean;
}

function FormField({
  label,
  placeholder,
  value,
  onChange,
  type = "text",
  multiline = false,
  required = false,
}: FormFieldProps) {
  const baseClasses =
    "w-full rounded-md bg-bg-input px-3 text-sm text-text-primary placeholder:text-text-tertiary border border-border-default focus:border-border-strong focus:outline-none";

  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1">
        {label}
        {required && <span className="text-error ml-0.5">*</span>}
      </label>
      {multiline ? (
        <textarea
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${baseClasses} h-20 py-2 resize-none`}
        />
      ) : (
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${baseClasses} h-9`}
        />
      )}
    </div>
  );
}
