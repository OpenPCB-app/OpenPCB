import type { DesignRecord } from "@shared/types";
import type { SchematicDocument } from "./types";

export function createEmptySchematicDocument(
  design: DesignRecord,
): SchematicDocument {
  return {
    id: design.id,
    projectId: design.projectId ?? design.workspaceId,
    updatedAt: design.updatedAt,
    version: 1,
    formatVersion: "pcb.schematic-project-document/v1",
    name: design.name,
    revision: 1,
    symbols: [],
    wires: [],
    labels: [],
  };
}

export function createUnsavedSchematicDraft(
  workspaceId: string,
): SchematicDocument {
  const now = new Date().toISOString();
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `unsaved-${Date.now()}`,
    projectId: workspaceId,
    updatedAt: now,
    version: 1,
    formatVersion: "pcb.schematic-project-document/v1",
    name: "Untitled design",
    revision: 1,
    symbols: [],
    wires: [],
    labels: [],
  };
}

export function hasSchematicCanvasContent(doc: SchematicDocument): boolean {
  return doc.symbols.length > 0 || doc.wires.length > 0 || doc.labels.length > 0;
}
