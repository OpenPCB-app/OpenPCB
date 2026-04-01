import { z } from "./base";
import { TimestampSchema, UUIDv7Schema } from "./common";

export const ComponentScopeSchema = z.literal("workspace").openapi("ComponentScope");

export const SymbolTemplateSchema = z.string().min(1).openapi("SymbolTemplate");

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
    properties: z.record(z.string(), z.string()),
    unitCount: z.number().int().min(1).default(1),
    bodyGraphics: z.array(z.unknown()).optional().default([]),
    rawKicadSource: z.string().nullable().optional(),
    symbolTemplate: SymbolTemplateSchema.nullable().optional(),
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
    footprint_id: UUIDv7Schema.optional(),
    variant_id: UUIDv7Schema.optional(),
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
    variant_id: UUIDv7Schema.optional(),
    component_id: UUIDv7Schema.optional(),
    id: UUIDv7Schema,
    familyId: UUIDv7Schema,
    canonicalCode: z.string().min(1),
    humanLabel: z.string().min(1),
    imperialAlias: z.string().nullable(),
    metricAlias: z.string().nullable(),
    mountType: MountTypeSchema,
    dimensions: PackageDimensionsSchema.nullable(),
    isDefault: z.boolean(),
    pinRemapTable: PinRemapTableSchema.nullable(),
    footprints: z.array(ComponentFootprintSchema).default([]),
    defaultFootprintId: UUIDv7Schema.nullable().optional(),
    footprintOptions: z.array(ComponentFootprintSchema).default([]),
    defaultFootprintOptionId: UUIDv7Schema.nullable(),
  })
  .strict()
  .openapi("ComponentVariant");

export const ComponentSchema = z
  .object({
    component_id: UUIDv7Schema.optional(),
    id: UUIDv7Schema,
    canonicalKey: z.string().min(1),
    displayLabel: z.string().min(1),
    description: z.string(),
    scope: ComponentScopeSchema,
    symbolData: SymbolDataSchema,
    variants: z.array(ComponentVariantSchema).default([]),
    defaultVariantId: UUIDv7Schema.nullable().optional(),
    packageVariants: z.array(ComponentVariantSchema).default([]),
    defaultPackageVariantId: UUIDv7Schema.nullable(),
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

export type SymbolTemplateType = z.infer<typeof SymbolTemplateSchema>;
export type ComponentType = z.infer<typeof ComponentSchema>;
export type ComponentVariantType = z.infer<typeof ComponentVariantSchema>;
export type ComponentFootprintType = z.infer<typeof ComponentFootprintSchema>;
export type ComponentReferenceType = z.infer<typeof ComponentReferenceSchema>;
export type ComponentFamilyType = ComponentType;
export type PackageVariantType = ComponentVariantType;
export type FootprintOptionType = ComponentFootprintType;
