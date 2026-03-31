import { describe, expect, test } from "bun:test";
import {
  ProjectDocumentBundleSchema,
  SchematicProjectDocumentSchema,
} from "./pcb-project.schema";

const now = "2026-03-31T12:00:00.000Z";

describe("pcb project schema", () => {
  test("accepts a minimal schematic project document", () => {
    const parsed = SchematicProjectDocumentSchema.parse({
      id: "sch-doc-1",
      projectId: "project-1",
      updatedAt: now,
      version: 1,
      formatVersion: "pcb.schematic-project-document/v1",
      symbols: [],
      wires: [],
      labels: [],
    });

    expect(parsed.formatVersion).toBe("pcb.schematic-project-document/v1");
    expect(parsed.version).toBe(1);
  });

  test("accepts a bundle with partial documents", () => {
    const parsed = ProjectDocumentBundleSchema.parse({
      formatVersion: "pcb.project-document-bundle/v1",
      docs: {
        schematic: {
          id: "sch-doc-1",
          projectId: "project-1",
          updatedAt: now,
          version: 1,
          formatVersion: "pcb.schematic-project-document/v1",
          symbols: [],
          wires: [],
          labels: [],
        },
        pcb: null,
      },
    });

    expect(parsed.docs.schematic?.id).toBe("sch-doc-1");
    expect(parsed.docs.pcb).toBeNull();
  });

  test("rejects invalid format version", () => {
    const result = ProjectDocumentBundleSchema.safeParse({
      formatVersion: "pcb.project-document-bundle/v2",
      docs: {},
    });

    expect(result.success).toBe(false);
  });
});
