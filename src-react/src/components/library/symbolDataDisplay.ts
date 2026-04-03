import type { ComponentType } from "@shared/types/component-library-schema.types";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function getSymbolProperties(
  symbolData?: ComponentType["symbolData"],
): Record<string, string> {
  const symbolDataRecord = asRecord(symbolData);
  const properties = asRecord(symbolDataRecord?.properties);
  if (!properties) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(properties).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function getSymbolReferenceDisplay(
  symbolData?: ComponentType["symbolData"],
): string {
  const symbolDataRecord = asRecord(symbolData);
  const referencePrefix = symbolDataRecord?.referencePrefix;
  if (typeof referencePrefix === "string" && referencePrefix.trim().length > 0) {
    return referencePrefix;
  }

  const properties = getSymbolProperties(symbolData);
  return properties.Reference ?? properties.reference ?? "U";
}

export function getSymbolValueDisplay(
  symbolData?: ComponentType["symbolData"],
): string {
  const properties = getSymbolProperties(symbolData);
  return properties.Value ?? properties.value ?? "";
}

export function isPowerSymbolData(
  symbolData?: ComponentType["symbolData"],
): boolean {
  return getSymbolReferenceDisplay(symbolData).toUpperCase() === "#PWR";
}

export function getSymbolPreviewLabel(
  symbolData?: ComponentType["symbolData"],
): string {
  if (isPowerSymbolData(symbolData)) {
    return getSymbolValueDisplay(symbolData) || getSymbolReferenceDisplay(symbolData);
  }

  return getSymbolReferenceDisplay(symbolData);
}
