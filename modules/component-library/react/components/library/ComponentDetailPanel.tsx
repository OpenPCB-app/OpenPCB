import { X, Package, Ruler, FileText } from "lucide-react";
import * as Accordion from "@radix-ui/react-accordion";
import type {
  ComponentType,
  ComponentVariantType,
} from "@shared/types/component-library-schema.types";

interface ComponentDetailPanelProps {
  component: ComponentType;
  onClose: () => void;
}

export function ComponentDetailPanel({
  component,
  onClose,
}: ComponentDetailPanelProps) {
  const variants = getComponentVariants(component);
  const defaultVariantId = getDefaultVariantId(component, variants);

  // Group variants by size/dimensions
  const variantsBySize = groupVariantsBySize(variants);

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] border-l border-border-default bg-bg-secondary shadow-xl flex flex-col z-50">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border-default p-4">
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-text-primary">
            {component.displayLabel}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            {component.description || "No description"}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded-full bg-bg-input px-2 py-0.5 text-xs font-medium text-text-muted uppercase">
              {component.scope}
            </span>
            <span className="text-xs text-text-tertiary">
              {component.symbolData.referencePrefix}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-text-tertiary hover:bg-bg-elevated hover:text-text-secondary"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Symbol Info */}
        <section className="border-b border-border-default p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-text-primary">
            <FileText className="h-4 w-4" />
            Symbol
          </h3>
          <div className="space-y-2">
            <div>
              <span className="text-xs text-text-muted">Reference Prefix:</span>
              <p className="text-sm font-mono text-text-primary">
                {component.symbolData.referencePrefix}
              </p>
            </div>
            <div>
              <span className="text-xs text-text-muted">Pins:</span>
              <p className="text-sm text-text-primary">
                {component.symbolData.pinDefinitions.length} pin
                {component.symbolData.pinDefinitions.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </section>

        {/* Package Variants */}
        <section className="border-b border-border-default p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-text-primary">
            <Package className="h-4 w-4" />
            Package Variants ({variants.length})
          </h3>
          <Accordion.Root type="single" collapsible>
            {Object.entries(variantsBySize).map(([sizeKey, variants]) => (
              <Accordion.Item
                key={sizeKey}
                value={sizeKey}
                className="border-b border-border-default last:border-0"
              >
                <Accordion.Trigger className="flex w-full items-center justify-between py-2 text-sm font-medium text-text-secondary hover:text-text-primary">
                  <span>
                    {sizeKey} ({variants.length})
                  </span>
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4 transition-transform duration-200 [[data-state=open]>&]:rotate-180"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </Accordion.Trigger>
                <Accordion.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                  <div className="space-y-2 pb-2">
                    {variants.map((variant) => (
                      <VariantCard
                        key={variant.id}
                        variant={variant}
                        isDefault={
                          variant.id === defaultVariantId
                        }
                      />
                    ))}
                  </div>
                </Accordion.Content>
              </Accordion.Item>
            ))}
          </Accordion.Root>
        </section>

      </div>
    </div>
  );
}

function VariantCard({
  variant,
  isDefault,
}: {
  variant: ComponentVariantType;
  isDefault: boolean;
}) {
  return (
    <div className="rounded-md border border-border-default bg-bg-elevated p-3">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-text-primary">
              {variant.humanLabel}
            </p>
            {isDefault && (
              <span className="rounded bg-brand-bg px-1.5 py-0.5 text-[10px] font-medium text-brand uppercase">
                Default
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-text-muted">
            {variant.canonicalCode}
          </p>
        </div>
        <span className="rounded-full bg-bg-input px-2 py-0.5 text-[10px] font-medium text-text-muted uppercase">
          {variant.mountType.replace("_", " ")}
        </span>
      </div>

      {variant.dimensions && (
        <div className="mt-2 flex items-center gap-3 text-xs text-text-secondary">
          <span className="flex items-center gap-1">
            <Ruler className="h-3 w-3" />
            {variant.dimensions.lengthMm} × {variant.dimensions.widthMm}
            {variant.dimensions.heightMm &&
              ` × ${variant.dimensions.heightMm}`}{" "}
            mm
          </span>
        </div>
      )}

      {/* Footprint Options */}
      {variant.footprintOptions.length > 0 && (
        <div className="mt-2 border-t border-border-default pt-2">
          <p className="text-xs text-text-muted">
            {variant.footprintOptions.length} footprint option
            {variant.footprintOptions.length !== 1 ? "s" : ""}
          </p>
          {variant.footprintOptions.map((fp) => (
            <div
              key={fp.id}
              className="mt-1 flex items-center justify-between text-xs"
            >
              <span className="text-text-secondary">{fp.label}</span>
              {fp.isDefault && (
                <span className="text-text-muted">(default)</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function groupVariantsBySize(
  variants: ComponentVariantType[],
): Record<string, ComponentVariantType[]> {
  const groups: Record<string, ComponentVariantType[]> = {};

  for (const variant of variants) {
    let key = "Other";

    if (variant.dimensions) {
      const { lengthMm, widthMm } = variant.dimensions;
      // Group by approximate size categories
      if (lengthMm < 1 && widthMm < 1) {
        key = "Micro (< 1mm)";
      } else if (lengthMm < 3 && widthMm < 3) {
        key = "Small (< 3mm)";
      } else if (lengthMm < 10 && widthMm < 10) {
        key = "Medium (< 10mm)";
      } else {
        key = "Large (≥ 10mm)";
      }
    }

    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key]!.push(variant);
  }

  return groups;
}

function getComponentVariants(component: ComponentType): ComponentVariantType[] {
  return component.variants;
}

function getDefaultVariantId(
  component: ComponentType,
  variants: ComponentVariantType[],
): string | null {
  return (
    component.defaultVariantId ??
    variants.find((variant) => variant.isDefault)?.id ??
    variants[0]?.id ??
    null
  );
}
