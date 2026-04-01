import { X, Package, Ruler, Box, FileText, ExternalLink } from "lucide-react";
import * as Accordion from "@radix-ui/react-accordion";
import type {
  ComponentFamilyType,
  PackageVariantType,
  ManufacturerOfferingType,
} from "@/../../src-ts/src/core/schemas/component-library.schema";

interface ComponentDetailPanelProps {
  component: ComponentFamilyType;
  onClose: () => void;
}

export function ComponentDetailPanel({
  component,
  onClose,
}: ComponentDetailPanelProps) {
  // Group variants by size/dimensions
  const variantsBySize = groupVariantsBySize(component.packageVariants || []);

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
            Package Variants ({component.packageVariants?.length || 0})
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
                          variant.id === component.defaultPackageVariantId
                        }
                      />
                    ))}
                  </div>
                </Accordion.Content>
              </Accordion.Item>
            ))}
          </Accordion.Root>
        </section>

        {/* MPN Table */}
        {component.packageVariants?.some((v) => v.offerings?.length > 0) && (
          <section className="p-4">
            <h3 className="mb-3 text-sm font-medium text-text-primary">
              Manufacturer Part Numbers
            </h3>
            <div className="space-y-2">
              {component.packageVariants?.map((variant) =>
                variant.offerings?.map((offering) => (
                  <OfferingCard
                    key={offering.id}
                    offering={offering}
                    variantLabel={variant.humanLabel}
                  />
                )),
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function VariantCard({
  variant,
  isDefault,
}: {
  variant: PackageVariantType;
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

      {/* 3D Model Info */}
      {variant.footprintOptions.some((fp) => fp.model3dOptions.length > 0) && (
        <div className="mt-2 border-t border-border-default pt-2">
          <p className="flex items-center gap-1 text-xs text-text-secondary">
            <Box className="h-3 w-3" />
            3D model available
          </p>
        </div>
      )}
    </div>
  );
}

function OfferingCard({
  offering,
  variantLabel,
}: {
  offering: ManufacturerOfferingType;
  variantLabel: string;
}) {
  return (
    <div className="rounded-md border border-border-default bg-bg-elevated p-2.5">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium font-mono text-text-primary">
            {offering.mpn}
          </p>
          <p className="text-xs text-text-muted">{offering.manufacturer}</p>
          <p className="mt-0.5 text-xs text-text-tertiary">{variantLabel}</p>
        </div>
        {offering.datasheetUrl && (
          <a
            href={offering.datasheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand hover:text-brand-dark"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  );
}

function groupVariantsBySize(
  variants: PackageVariantType[],
): Record<string, PackageVariantType[]> {
  const groups: Record<string, PackageVariantType[]> = {};

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
