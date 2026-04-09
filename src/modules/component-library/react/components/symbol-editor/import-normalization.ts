import type { SymbolDraft } from "./types";

export const IMPORTED_SYMBOL_NORMALIZATION_PROPERTY =
  "__openpcbImportedSymbolNormalization";
export const IMPORTED_SYMBOL_NORMALIZATION_VERSION = "schematic-v1";

export function hasStoredImportedSymbolNormalization(
  properties: Record<string, string> | null | undefined,
): boolean {
  return (
    properties?.[IMPORTED_SYMBOL_NORMALIZATION_PROPERTY] ===
    IMPORTED_SYMBOL_NORMALIZATION_VERSION
  );
}

export function setStoredImportedSymbolNormalization(
  properties: Record<string, string>,
  normalized: boolean,
): Record<string, string> {
  const next = { ...properties };
  if (normalized) {
    next[IMPORTED_SYMBOL_NORMALIZATION_PROPERTY] =
      IMPORTED_SYMBOL_NORMALIZATION_VERSION;
  } else {
    delete next[IMPORTED_SYMBOL_NORMALIZATION_PROPERTY];
  }
  return next;
}

export function hasDraftImportedSymbolNormalization(
  draft: Pick<SymbolDraft, "importPreservation">,
): boolean {
  return draft.importPreservation?.normalizedSchematicGeometry === true;
}

export function setDraftImportedSymbolNormalization(
  draft: SymbolDraft,
  normalized: boolean,
): SymbolDraft {
  if (!draft.importPreservation) {
    return draft;
  }

  return {
    ...draft,
    importPreservation: {
      ...draft.importPreservation,
      normalizedSchematicGeometry: normalized,
    },
  };
}
