import type {
  PackageVariant,
  PinDefinition,
  SchematicComponentSelection,
  SwitchPreview,
} from "../../core/schemas/component-semantics";
import { determineSwitchOutcome } from "../../core/schemas/component-semantics";

export interface IPackageSwitchService {
  previewSwitch(
    families: { variants: PackageVariant[]; pinDefinitions: PinDefinition[] },
    currentSelection: SchematicComponentSelection,
    targetVariantId: string,
  ): SwitchPreview;
}

export class PackageSwitchService implements IPackageSwitchService {
  previewSwitch(
    family: { variants: PackageVariant[]; pinDefinitions: PinDefinition[] },
    currentSelection: SchematicComponentSelection,
    targetVariantId: string,
  ): SwitchPreview {
    const source = family.variants.find(
      (v) => v.id === currentSelection.selectedPackageVariantId,
    );
    const target = family.variants.find((v) => v.id === targetVariantId);

    if (!source || !target) {
      return {
        outcome: "blocked",
        sourceVariantId: currentSelection.selectedPackageVariantId,
        targetVariantId,
        newFootprintOptionId: null,
        affectedPins: [],
        confirmationMessage: !source
          ? "Source variant not found"
          : "Target variant not found",
      };
    }

    const outcome = determineSwitchOutcome(
      source,
      target,
      family.pinDefinitions,
      currentSelection.selectedFootprintOptionId,
    );

    let newFootprintOptionId: string | null = null;
    let affectedPins: string[] = [];
    let confirmationMessage: string | null = null;

    switch (outcome) {
      case "auto_apply":
        newFootprintOptionId = target.footprintOptions.some(
          (fp) => fp.id === currentSelection.selectedFootprintOptionId,
        )
          ? currentSelection.selectedFootprintOptionId
          : target.defaultFootprintOptionId;
        break;

      case "auto_fallback":
        newFootprintOptionId = target.defaultFootprintOptionId;
        break;

      case "requires_confirmation": {
        newFootprintOptionId = target.defaultFootprintOptionId;
        const srcPins = source.pinRemapTable
          ? Object.values(source.pinRemapTable)
          : family.pinDefinitions.map((p) => p.name);
        const tgtPins = target.pinRemapTable
          ? Object.values(target.pinRemapTable)
          : family.pinDefinitions.map((p) => p.name);

        if (srcPins.length !== tgtPins.length) {
          affectedPins = [...new Set([...srcPins, ...tgtPins])];
          confirmationMessage = `Pin count changes from ${srcPins.length} to ${tgtPins.length}. PCB connectivity may be affected.`;
        } else {
          const changed = srcPins.filter((p, i) => p !== tgtPins[i]);
          affectedPins = changed;
          confirmationMessage = `Pin mapping changes for: ${changed.join(", ")}. Verify PCB connectivity.`;
        }
        break;
      }

      case "blocked":
        confirmationMessage = "Target variant has no default footprint";
        break;
    }

    return {
      outcome,
      sourceVariantId: source.id,
      targetVariantId: target.id,
      newFootprintOptionId,
      affectedPins,
      confirmationMessage,
    };
  }
}
