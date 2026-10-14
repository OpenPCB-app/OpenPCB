/**
 * Shared builder for editor-authored footprints (generated IPC preset or
 * drawn). Used by `commit-drawn.ts` (new component) and by the
 * add-footprint-to-existing-component path in `queries.ts`.
 */

import { buildFootprintRenderModel } from "../../../../shared/rendering/footprint-preview-builder";
import type {
  FootprintRenderSource,
  SymbolRenderSource,
} from "../../../../shared/rendering/types";
import { buildIdentityPinMapJson } from "./pinmap";
import {
  validateFootprintPads,
  validateSymbolPinsCoverFootprintPads,
  type SymbolPinsLike,
} from "./validate-pads";

export type AuthoredFootprintMode = "generated" | "drawn";

export interface AuthoredFootprintMetadata {
  name: string;
  mountType: string;
  packageCode: { imperial: string | null; metric: string | null };
  tags: readonly string[];
}

export function hashString(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  return `drawn:${(hash >>> 0).toString(16)}`;
}

export interface AuthoredFootprintRecord {
  footprintName: string;
  footprintDataJson: string;
  pinMapJson: string | null;
}

/**
 * Validates pads + symbol pin coverage and builds the persisted data JSON.
 * Throws `ImportValidationError` (400) on invalid input.
 */
export function buildAuthoredFootprintRecord(params: {
  mode: AuthoredFootprintMode;
  source: FootprintRenderSource;
  metadata: AuthoredFootprintMetadata;
  symbol: SymbolRenderSource | SymbolPinsLike;
  footprintId: string;
  now: string;
  /** Server-derived generator provenance; never taken from the client payload. */
  provenance?: Record<string, unknown>;
}): AuthoredFootprintRecord {
  const { mode, source, metadata, symbol, footprintId, now } = params;
  validateFootprintPads(source);
  validateSymbolPinsCoverFootprintPads(symbol, source);
  const model = buildFootprintRenderModel(source);
  const hash = hashString(JSON.stringify(source));
  const pinMapJson = buildIdentityPinMapJson(
    symbol as SymbolRenderSource,
    source,
  );
  const generated = mode === "generated";
  const footprintDataJson = JSON.stringify({
    provenance: {
      sourceKind: generated ? "generated" : "drawn",
      sourceFormat: generated ? "ipc-7351b" : "openpcb-editor",
      fileName: null,
      importedAt: now,
      sourceHash: hash,
      ...params.provenance,
    },
    parser: { warnings: [] },
    normalized: {
      id: footprintId,
      fileName: "",
      name: metadata.name,
      description: `${generated ? "Generated" : "Drawn"} ${metadata.name} footprint`,
      mountType: metadata.mountType,
      padCount: source.pads.length,
      packageCode: metadata.packageCode,
      tags: metadata.tags,
      sourceHash: hash,
      warnings: [],
      preview: model,
    },
    raw: { source },
  });
  return { footprintName: metadata.name, footprintDataJson, pinMapJson };
}
