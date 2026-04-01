import type {
  ComponentDraftPayload,
  ImportWarningCode,
  ValidationResult,
  ValidationIssue,
} from "../../core/schemas/component-semantics";

export interface IComponentValidationService {
  validateForPublish(payload: ComponentDraftPayload): ValidationResult;
}

export class ComponentValidationService implements IComponentValidationService {
  validateForPublish(payload: ComponentDraftPayload): ValidationResult {
    const blockers: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    // Missing symbol data
    if (!payload.symbolData || payload.symbolData.pinDefinitions.length === 0) {
      blockers.push(
        this.issue(
          "missing_symbol_data",
          "Symbol has no pin definitions",
          null,
          "family",
        ),
      );
    }

    // Zero package variants
    if (payload.packageVariants.length === 0) {
      blockers.push(
        this.issue(
          "zero_package_variants",
          "Family has no package variants",
          null,
          "family",
        ),
      );
    }

    // No default variant flagged
    const defaultVariants = payload.packageVariants.filter((v) => v.isDefault);
    if (payload.packageVariants.length > 0 && defaultVariants.length !== 1) {
      blockers.push(
        this.issue(
          "no_default_variant",
          `Expected exactly 1 default variant, found ${defaultVariants.length}`,
          null,
          "family",
        ),
      );
    }

    // Check defaultPackageVariantId matches
    if (payload.defaultPackageVariantId) {
      const exists = payload.packageVariants.some(
        (v) => v.id === payload.defaultPackageVariantId,
      );
      if (!exists) {
        blockers.push(
          this.issue(
            "broken_internal_ids",
            "defaultPackageVariantId references non-existent variant",
            payload.defaultPackageVariantId,
            "family",
          ),
        );
      }
    }

    // Duplicate canonical codes
    const codes = payload.packageVariants.map((v) => v.canonicalCode);
    const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (dupes.length > 0) {
      blockers.push(
        this.issue(
          "duplicate_canonical_code",
          `Duplicate package codes: ${[...new Set(dupes)].join(", ")}`,
          null,
          "family",
        ),
      );
    }

    // Per-variant checks
    for (const variant of payload.packageVariants) {
      // Default footprint check
      const defaultFps = variant.footprintOptions.filter((fp) => fp.isDefault);
      if (defaultFps.length !== 1) {
        blockers.push(
          this.issue(
            "variant_missing_default_footprint",
            `Variant ${variant.canonicalCode} has ${defaultFps.length} default footprints (need exactly 1)`,
            variant.id,
            "variant",
          ),
        );
      }

      // Pin remap validation
      if (variant.pinRemapTable) {
        const familyPinNames = new Set(
          payload.symbolData.pinDefinitions.map((p) => p.name),
        );
        for (const key of Object.keys(variant.pinRemapTable)) {
          if (!familyPinNames.has(key)) {
            blockers.push(
              this.issue(
                "unresolved_pin_remap",
                `Pin remap key "${key}" not found in family pins`,
                variant.id,
                "variant",
              ),
            );
          }
        }
      }

      // Footprint internal ID checks
      if (variant.defaultFootprintOptionId) {
        const fpExists = variant.footprintOptions.some(
          (fp) => fp.id === variant.defaultFootprintOptionId,
        );
        if (!fpExists) {
          blockers.push(
            this.issue(
              "broken_internal_ids",
              `Variant ${variant.canonicalCode} defaultFootprintOptionId references non-existent footprint`,
              variant.id,
              "variant",
            ),
          );
        }
      }

      // Warning: missing 3D models
      for (const fp of variant.footprintOptions) {
        if (fp.model3dOptions.length === 0) {
          warnings.push(
            this.issue(
              "missing_3d_model",
              `Footprint "${fp.label}" in variant ${variant.canonicalCode} has no 3D model`,
              fp.id,
              "footprint",
            ),
          );
        }
      }

      // Warning: absent offerings
      if (variant.offerings.length === 0) {
        warnings.push(
          this.issue(
            "absent_offerings",
            `Variant ${variant.canonicalCode} has no manufacturer offerings`,
            variant.id,
            "variant",
          ),
        );
      }
    }

    return {
      blockers,
      warnings,
      canPublish: blockers.length === 0,
    };
  }

  private issue(
    code: ImportWarningCode,
    message: string,
    entityId: string | null,
    entityType: string | null,
  ): ValidationIssue {
    return { code, message, entityId, entityType };
  }
}
