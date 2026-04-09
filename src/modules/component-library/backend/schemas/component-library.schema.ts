import { z } from "./base";
import { TimestampSchema, UUIDv7Schema } from "./common";

export const ComponentScopeSchema = z
  .enum(["workspace", "builtin"])
  .openapi("ComponentScope");

export const MountTypeSchema = z
  .enum(["smd", "through_hole", "virtual"])
  .openapi("MountType");

export const PinElectricalTypeSchema = z
  .enum([
    "passive",
    "input",
    "output",
    "bidirectional",
    "power_in",
    "power_out",
    "open_collector",
    "open_emitter",
    "unspecified",
  ])
  .openapi("PinElectricalType");

export const DensityLevelSchema = z
  .enum(["most", "nominal", "least"])
  .openapi("DensityLevel");

export const PinDefinitionSchema = z
  .object({
    name: z.string().min(1),
    electricalType: PinElectricalTypeSchema,
  })
  .strict()
  .openapi("PinDefinition");

export const SymbolDataSchema = z
  .object({
    referencePrefix: z.string().min(1).max(5),
    pinDefinitions: z.array(PinDefinitionSchema),
    pins: z
      .array(
        z.object({
          name: z.string(),
          number: z.string(),
          position: z.object({ x: z.number(), y: z.number() }),
          side: z.enum(["left", "right", "top", "bottom"]).nullable(),
          length: z.number().optional(),
          electricalType: PinElectricalTypeSchema.optional(),
        }),
      )
      .optional()
      .default([]),
    properties: z.record(z.string(), z.string()),
    unitCount: z.number().int().min(1).default(1),
    bodyGraphics: z.array(z.unknown()).optional().default([]),
    rawKicadSource: z.string().nullable().optional(),
  })
  .strict()
  .openapi("SymbolData");

export const PackageDimensionsSchema = z
  .object({
    lengthMm: z.number().positive(),
    widthMm: z.number().positive(),
    heightMm: z.number().positive().nullable(),
  })
  .strict()
  .openapi("PackageDimensions");

export const PinRemapTableSchema = z
  .record(z.string(), z.string())
  .openapi("PinRemapTable");

export const FootprintPayloadSchema = z.unknown().openapi("FootprintPayload");

export const ComponentFootprintSchema = z
  .object({
    id: UUIDv7Schema,
    variantId: UUIDv7Schema,
    label: z.string().min(1),
    isDefault: z.boolean(),
    kicadPayload: FootprintPayloadSchema.nullable(),
    model3dOptions: z.array(z.unknown()).optional().default([]),
    densityLevel: DensityLevelSchema.nullable().optional(),
    ipcName: z.string().nullable().optional(),
  })
  .strict()
  .openapi("ComponentFootprint");

export const ComponentVariantSchema = z
  .object({
    id: UUIDv7Schema,
    componentId: UUIDv7Schema,
    canonicalCode: z.string().min(1),
    humanLabel: z.string().min(1),
    imperialAlias: z.string().nullable(),
    metricAlias: z.string().nullable(),
    mountType: MountTypeSchema,
    dimensions: PackageDimensionsSchema.nullable(),
    isDefault: z.boolean(),
    pinRemapTable: PinRemapTableSchema.nullable(),
    footprintOptions: z.array(ComponentFootprintSchema).default([]),
    defaultFootprintOptionId: UUIDv7Schema.nullable(),
  })
  .strict()
  .openapi("ComponentVariant");

export const ComponentSchema = z
  .object({
    id: UUIDv7Schema,
    canonicalKey: z.string().min(1),
    displayLabel: z.string().min(1),
    description: z.string(),
    scope: ComponentScopeSchema,
    symbolData: SymbolDataSchema,
    variants: z.array(ComponentVariantSchema).default([]),
    defaultVariantId: UUIDv7Schema.nullable().optional(),
    categoryPath: z.string().nullable(),
    tags: z.array(z.string()).default([]),
    createdAt: TimestampSchema.optional(),
    updatedAt: TimestampSchema.optional(),
  })
  .strict()
  .openapi("Component");

export const ComponentReferenceSchema = z
  .object({
    component_id: UUIDv7Schema,
    variant_id: UUIDv7Schema,
    footprint_id: UUIDv7Schema.nullable(),
    reference: z.string().min(1).optional(),
  })
  .strict()
  .openapi("ComponentReference");

export const ComponentResponseSchema = z
  .object({ component: ComponentSchema })
  .openapi("ComponentResponse");

export const ComponentListResponseSchema = z
  .object({ components: z.array(ComponentSchema) })
  .openapi("ComponentListResponse");

export const ComponentFamilyResponseSchema = z
  .object({ family: ComponentSchema })
  .openapi("ComponentFamilyResponse");

export const ComponentFamilyListResponseSchema = z
  .object({ families: z.array(ComponentSchema) })
  .openapi("ComponentFamilyListResponse");

export type ComponentType = z.infer<typeof ComponentSchema>;
export type ComponentVariantType = z.infer<typeof ComponentVariantSchema>;
export type ComponentFootprintType = z.infer<typeof ComponentFootprintSchema>;
export type ComponentReferenceType = z.infer<typeof ComponentReferenceSchema>;
