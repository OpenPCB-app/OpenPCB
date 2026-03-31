/**
 * PCB Project Zod Schemas
 *
 * Runtime contract for versioned PCB project documents.
 * Mirrors `src-ts/shared/types/pcb.types.ts`.
 */
import { z } from "./base";
import { TimestampSchema } from "./common";

const DocumentIdSchema = z.string().min(1);

export const PcbProjectDocumentFormatVersionSchema = z.literal(
  "pcb.project-document/v1",
);
export const SchematicProjectDocumentFormatVersionSchema = z.literal(
  "pcb.schematic-project-document/v1",
);
export const LibraryProjectDocumentFormatVersionSchema = z.literal(
  "pcb.library-project-document/v1",
);
export const ManufacturingProjectDocumentFormatVersionSchema = z.literal(
  "pcb.manufacturing-project-document/v1",
);
export const ProjectDocumentBundleFormatVersionSchema = z.literal(
  "pcb.project-document-bundle/v1",
);

export const ProjectDocumentIdSchema = z
  .object({
    id: DocumentIdSchema,
    projectId: DocumentIdSchema,
    updatedAt: TimestampSchema,
    version: z.number().int().positive(),
  })
  .strict()
  .openapi("ProjectDocumentId");

export const ProjectPointSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict()
  .openapi("ProjectPoint");

export const ProjectRectSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict()
  .openapi("ProjectRect");

export const ProjectPolylineSchema = z
  .object({
    points: z.array(ProjectPointSchema).min(2),
  })
  .strict()
  .openapi("ProjectPolyline");

export const SchematicSymbolPinSchema = z
  .object({
    id: DocumentIdSchema,
    name: z.string().min(1),
    position: ProjectPointSchema,
  })
  .strict()
  .openapi("SchematicSymbolPin");

export const SchematicSymbolSchema = z
  .object({
    id: DocumentIdSchema,
    libraryPartId: DocumentIdSchema.nullable().optional(),
    reference: z.string().nullable().optional(),
    position: ProjectPointSchema,
    rotation: z.number().optional(),
    pins: z.array(SchematicSymbolPinSchema),
    properties: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .openapi("SchematicSymbol");

export const SchematicWireSchema = z
  .object({
    id: DocumentIdSchema,
    points: z.array(ProjectPointSchema).min(2),
    sourcePinId: DocumentIdSchema,
    targetPinId: DocumentIdSchema,
    net: z.string().nullable().optional(),
  })
  .strict()
  .openapi("SchematicWire");

export const SchematicLabelSchema = z
  .object({
    id: DocumentIdSchema,
    text: z.string().min(1),
    position: ProjectPointSchema,
    rotation: z.number().optional(),
    net: z.string().nullable().optional(),
  })
  .strict()
  .openapi("SchematicLabel");

export const SchematicProjectDocumentSchema = ProjectDocumentIdSchema.extend({
  formatVersion: SchematicProjectDocumentFormatVersionSchema,
  title: z.string().optional(),
  symbols: z.array(SchematicSymbolSchema),
  wires: z.array(SchematicWireSchema),
  labels: z.array(SchematicLabelSchema),
})
  .strict()
  .openapi("SchematicProjectDocument");

export const PcbBoardOutlineSchema = z
  .object({
    id: DocumentIdSchema,
    outline: ProjectPolylineSchema,
    keepoutAreas: z.array(ProjectRectSchema).optional(),
    thicknessMm: z.number().positive().optional(),
  })
  .strict()
  .openapi("PcbBoardOutline");

export const PcbFootprintPadSchema = z
  .object({
    id: DocumentIdSchema,
    name: z.string().min(1),
    position: ProjectPointSchema,
    size: ProjectRectSchema,
  })
  .strict()
  .openapi("PcbFootprintPad");

export const PcbFootprintSchema = z
  .object({
    id: DocumentIdSchema,
    symbolId: DocumentIdSchema.nullable().optional(),
    libraryPartId: DocumentIdSchema.nullable().optional(),
    reference: z.string().nullable().optional(),
    position: ProjectPointSchema,
    rotation: z.number().optional(),
    pads: z.array(PcbFootprintPadSchema),
  })
  .strict()
  .openapi("PcbFootprint");

export const PcbTraceSchema = z
  .object({
    id: DocumentIdSchema,
    net: z.string().nullable().optional(),
    width: z.number().positive(),
    layer: z.string().min(1),
    points: z.array(ProjectPointSchema).min(2),
  })
  .strict()
  .openapi("PcbTrace");

export const PcbViaSchema = z
  .object({
    id: DocumentIdSchema,
    net: z.string().nullable().optional(),
    position: ProjectPointSchema,
    drillDiameter: z.number().positive(),
    diameter: z.number().positive(),
    layerFrom: z.string().min(1),
    layerTo: z.string().min(1),
  })
  .strict()
  .openapi("PcbVia");

export const PcbDesignRulesSchema = z
  .object({
    defaultTraceWidthMm: z.number().positive().optional(),
    defaultViaDiameterMm: z.number().positive().optional(),
    defaultViaDrillMm: z.number().positive().optional(),
    clearanceMm: z.number().positive().optional(),
  })
  .strict()
  .openapi("PcbDesignRules");

export const PcbProjectDocumentSchema = ProjectDocumentIdSchema.extend({
  formatVersion: PcbProjectDocumentFormatVersionSchema,
  board: PcbBoardOutlineSchema,
  footprints: z.array(PcbFootprintSchema),
  traces: z.array(PcbTraceSchema),
  vias: z.array(PcbViaSchema),
  rules: PcbDesignRulesSchema.optional(),
})
  .strict()
  .openapi("PcbProjectDocument");

export const LibraryPartReferenceSchema = z
  .object({
    id: DocumentIdSchema,
    partNumber: z.string().nullable().optional(),
    manufacturer: z.string().nullable().optional(),
    footprintId: DocumentIdSchema.nullable().optional(),
    schematicSymbolId: DocumentIdSchema.nullable().optional(),
  })
  .strict()
  .openapi("LibraryPartReference");

export const LibraryProjectDocumentSchema = ProjectDocumentIdSchema.extend({
  formatVersion: LibraryProjectDocumentFormatVersionSchema,
  parts: z.array(LibraryPartReferenceSchema),
})
  .strict()
  .openapi("LibraryProjectDocument");

export const ManufacturingOutputFormatSchema = z.enum([
  "gerber",
  "drill",
  "pick-and-place",
  "bom",
]);

export const ManufacturingExportMetadataSchema = z
  .object({
    exportedAt: TimestampSchema,
    format: ManufacturingOutputFormatSchema,
    outputPath: z.string().nullable().optional(),
    revision: z.string().nullable().optional(),
  })
  .strict()
  .openapi("ManufacturingExportMetadata");

export const ManufacturingProjectDocumentSchema = ProjectDocumentIdSchema.extend({
  formatVersion: ManufacturingProjectDocumentFormatVersionSchema,
  settings: z
    .object({
      outputUnits: z.enum(["mm", "mil"]).optional(),
      includeAssembly: z.boolean().optional(),
      includeFabrication: z.boolean().optional(),
      notes: z.string().optional(),
    })
    .strict(),
  lastExport: ManufacturingExportMetadataSchema.nullable().optional(),
})
  .strict()
  .openapi("ManufacturingProjectDocument");

export const ProjectDocumentBundleSchema = z
  .object({
    formatVersion: ProjectDocumentBundleFormatVersionSchema,
    docs: z
      .object({
        schematic: SchematicProjectDocumentSchema.nullable().optional(),
        pcb: PcbProjectDocumentSchema.nullable().optional(),
        library: LibraryProjectDocumentSchema.nullable().optional(),
        manufacturing: ManufacturingProjectDocumentSchema.nullable().optional(),
      })
      .strict(),
  })
  .strict()
  .openapi("ProjectDocumentBundle");

export type ProjectDocumentIdType = z.infer<typeof ProjectDocumentIdSchema>;
export type ProjectPointType = z.infer<typeof ProjectPointSchema>;
export type ProjectRectType = z.infer<typeof ProjectRectSchema>;
export type ProjectPolylineType = z.infer<typeof ProjectPolylineSchema>;
export type SchematicProjectDocumentType = z.infer<
  typeof SchematicProjectDocumentSchema
>;
export type PcbProjectDocumentType = z.infer<typeof PcbProjectDocumentSchema>;
export type LibraryProjectDocumentType = z.infer<
  typeof LibraryProjectDocumentSchema
>;
export type ManufacturingProjectDocumentType = z.infer<
  typeof ManufacturingProjectDocumentSchema
>;
export type ProjectDocumentBundleType = z.infer<
  typeof ProjectDocumentBundleSchema
>;
