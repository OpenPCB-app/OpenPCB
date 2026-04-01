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
