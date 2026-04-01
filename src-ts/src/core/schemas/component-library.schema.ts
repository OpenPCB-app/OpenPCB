/**
 * Component Library Zod/OpenAPI Schemas
 *
 * Typed contracts for the package-aware component hierarchy.
 * Mirrors types in component-semantics.ts with runtime validation.
 */
import { z } from "./base";
import { UUIDv7Schema, TimestampSchema } from "./common";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ComponentScopeSchema = z
  .enum(["built_in", "workspace"])
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

export const Model3DLinkStatusSchema = z
  .enum(["valid", "missing_target", "orphan_asset", "shared_body"])
  .openapi("Model3DLinkStatus");

export const ImportWarningSeveritySchema = z
  .enum(["warning", "blocker"])
  .openapi("ImportWarningSeverity");

export const ImportWarningCodeSchema = z
  .enum([
    "missing_symbol_data",
    "zero_package_variants",
    "no_default_variant",
    "variant_missing_default_footprint",
    "unresolved_pin_remap",
    "broken_internal_ids",
    "duplicate_canonical_code",
    "missing_3d_model",
    "orphan_model_file",
    "missing_datasheet",
    "absent_offerings",
    "import_ambiguity",
    "unsupported_construct",
  ])
  .openapi("ImportWarningCode");

export const SwitchOutcomeSchema = z
  .enum(["auto_apply", "auto_fallback", "requires_confirmation", "blocked"])
  .openapi("SwitchOutcome");

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

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
    bodyGraphics: z.array(z.any()).optional(),
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

export const Model3DOptionSchema = z
  .object({
    id: UUIDv7Schema,
    footprintOptionId: UUIDv7Schema,
    fileName: z.string().min(1),
    stepAssetPath: z.string().nullable(),
    gltfPreviewPath: z.string().nullable(),
    isDefault: z.boolean(),
    linkStatus: Model3DLinkStatusSchema,
  })
  .strict()
  .openapi("Model3DOption");

export const DensityLevelSchema = z
  .enum(["most", "nominal", "least"])
  .openapi("DensityLevel");

export const FootprintOptionSchema = z
  .object({
    id: UUIDv7Schema,
    variantId: UUIDv7Schema,
    label: z.string().min(1),
    isDefault: z.boolean(),
    kicadPayload: z.unknown().nullable(),
    densityLevel: DensityLevelSchema.nullable().optional(),
    ipcName: z.string().nullable().optional(),
    model3dOptions: z.array(Model3DOptionSchema),
    defaultModel3dOptionId: UUIDv7Schema.nullable(),
  })
  .strict()
  .openapi("FootprintOption");

export const ManufacturerOfferingSchema = z
  .object({
    id: UUIDv7Schema,
    variantId: UUIDv7Schema,
    mpn: z.string().min(1),
    manufacturer: z.string().min(1),
    datasheetUrl: z.string().url().nullable(),
  })
  .strict()
  .openapi("ManufacturerOffering");

export const PackageVariantSchema = z
  .object({
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
    footprintOptions: z.array(FootprintOptionSchema),
    defaultFootprintOptionId: UUIDv7Schema.nullable(),
    offerings: z.array(ManufacturerOfferingSchema),
  })
  .strict()
  .openapi("PackageVariant");

export const ComponentFamilySchema = z
  .object({
    id: UUIDv7Schema,
    canonicalKey: z.string().min(1),
    displayLabel: z.string().min(1),
    description: z.string(),
    scope: ComponentScopeSchema,
    symbolData: SymbolDataSchema,
    packageVariants: z.array(PackageVariantSchema),
    defaultPackageVariantId: UUIDv7Schema.nullable(),
    categoryPath: z.string().nullable(),
    tags: z.array(z.string()).default([]),
  })
  .strict()
  .openapi("ComponentFamily");

// ---------------------------------------------------------------------------
// Draft & revision
// ---------------------------------------------------------------------------

export const ComponentDraftPayloadSchema = z
  .object({
    displayLabel: z.string().min(1),
    description: z.string(),
    symbolData: SymbolDataSchema,
    packageVariants: z.array(PackageVariantSchema),
    defaultPackageVariantId: UUIDv7Schema.nullable(),
  })
  .strict()
  .openapi("ComponentDraftPayload");

export const ImportWarningSchema = z
  .object({
    code: ImportWarningCodeSchema,
    message: z.string(),
    severity: ImportWarningSeveritySchema,
    context: z.record(z.string(), z.string()),
  })
  .strict()
  .openapi("ImportWarning");

export const ComponentDraftSchema = z
  .object({
    id: UUIDv7Schema,
    familyId: UUIDv7Schema.nullable(),
    wizardStep: z.number().int().min(0),
    payload: ComponentDraftPayloadSchema,
    warnings: z.array(ImportWarningSchema),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .openapi("ComponentDraft");

export const ComponentRevisionSchema = z
  .object({
    id: UUIDv7Schema,
    familyId: UUIDv7Schema,
    revisionNumber: z.number().int().positive(),
    snapshot: ComponentDraftPayloadSchema,
    publishedAt: TimestampSchema,
  })
  .strict()
  .openapi("ComponentRevision");

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export const ComponentProvenanceSchema = z
  .object({
    id: UUIDv7Schema,
    familyId: UUIDv7Schema,
    sourceFileNames: z.array(z.string()),
    sourceHashes: z.record(z.string(), z.string()),
    importTimestamp: TimestampSchema,
    kicadIdentifiers: z.record(z.string(), z.string()),
    heuristicDecisions: z.array(z.string()),
  })
  .strict()
  .openapi("ComponentProvenance");

// ---------------------------------------------------------------------------
// Schematic instance selection
// ---------------------------------------------------------------------------

export const SchematicComponentSelectionSchema = z
  .object({
    componentFamilyId: UUIDv7Schema,
    componentRevisionId: UUIDv7Schema,
    selectedPackageVariantId: UUIDv7Schema,
    selectedFootprintOptionId: UUIDv7Schema,
  })
  .strict()
  .openapi("SchematicComponentSelection");

// ---------------------------------------------------------------------------
// Preset catalog
// ---------------------------------------------------------------------------

export const PresetVariantSchema = z
  .object({
    id: UUIDv7Schema,
    catalogId: UUIDv7Schema,
    canonicalCode: z.string().min(1),
    humanLabel: z.string().min(1),
    imperialAlias: z.string().nullable(),
    metricAlias: z.string().nullable(),
    mountType: MountTypeSchema,
    typicalDimensions: PackageDimensionsSchema.nullable(),
    pinCount: z.number().int().positive().nullable(),
  })
  .strict()
  .openapi("PresetVariant");

export const PresetCatalogSchema = z
  .object({
    id: UUIDv7Schema,
    name: z.string().min(1),
    scope: ComponentScopeSchema,
    isImmutable: z.boolean(),
    variants: z.array(PresetVariantSchema),
  })
  .strict()
  .openapi("PresetCatalog");

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const ValidationIssueSchema = z
  .object({
    code: ImportWarningCodeSchema,
    message: z.string(),
    entityId: z.string().nullable(),
    entityType: z.string().nullable(),
  })
  .strict()
  .openapi("ValidationIssue");

export const ValidationResultSchema = z
  .object({
    blockers: z.array(ValidationIssueSchema),
    warnings: z.array(ValidationIssueSchema),
    canPublish: z.boolean(),
  })
  .strict()
  .openapi("ValidationResult");

// ---------------------------------------------------------------------------
// Switch preview
// ---------------------------------------------------------------------------

export const SwitchPreviewSchema = z
  .object({
    outcome: SwitchOutcomeSchema,
    sourceVariantId: UUIDv7Schema,
    targetVariantId: UUIDv7Schema,
    newFootprintOptionId: UUIDv7Schema.nullable(),
    affectedPins: z.array(z.string()),
    confirmationMessage: z.string().nullable(),
  })
  .strict()
  .openapi("SwitchPreview");

// ---------------------------------------------------------------------------
// Import preview/confirm
// ---------------------------------------------------------------------------

export const ImportPreviewGroupSchema = z
  .object({
    suggestedFamilyLabel: z.string(),
    suggestedCanonicalKey: z.string(),
    variants: z.array(
      z.object({
        suggestedCanonicalCode: z.string(),
        suggestedHumanLabel: z.string(),
        footprintFileNames: z.array(z.string()),
        model3dFileNames: z.array(z.string()),
        confidence: z.number().min(0).max(1),
      }),
    ),
    warnings: z.array(ImportWarningSchema),
    symbolFileName: z.string().nullable(),
  })
  .strict()
  .openapi("ImportPreviewGroup");

export const ImportPreviewSchema = z
  .object({
    groups: z.array(ImportPreviewGroupSchema),
    ungroupedFiles: z.array(z.string()),
    totalWarnings: z.number().int(),
    totalBlockers: z.number().int(),
  })
  .strict()
  .openapi("ImportPreview");

export const ImportConfirmInputSchema = z
  .object({
    groups: z.array(
      z.object({
        familyLabel: z.string().min(1),
        canonicalKey: z.string().min(1),
        variants: z.array(
          z.object({
            canonicalCode: z.string().min(1),
            humanLabel: z.string().min(1),
            footprintFileNames: z.array(z.string()),
            model3dFileNames: z.array(z.string()),
          }),
        ),
        symbolFileName: z.string().nullable(),
      }),
    ),
    publishImmediately: z.boolean().default(false),
  })
  .strict()
  .openapi("ImportConfirmInput");

// ---------------------------------------------------------------------------
// API input/response schemas
// ---------------------------------------------------------------------------

export const CreateComponentDraftInputSchema = z
  .object({
    displayLabel: z.string().min(1).max(200),
    description: z.string().default(""),
    symbolData: SymbolDataSchema.optional(),
    importFromFiles: z.boolean().default(false),
  })
  .strict()
  .openapi("CreateComponentDraftInput");

export const UpdateComponentDraftInputSchema = z
  .object({
    wizardStep: z.number().int().min(0).optional(),
    payload: ComponentDraftPayloadSchema.optional(),
    warnings: z.array(ImportWarningSchema).optional(),
  })
  .strict()
  .openapi("UpdateComponentDraftInput");

export const SwitchPreviewInputSchema = z
  .object({
    selection: SchematicComponentSelectionSchema,
    targetVariantId: UUIDv7Schema,
  })
  .strict()
  .openapi("SwitchPreviewInput");

// Response wrappers
export const ComponentFamilyResponseSchema = z
  .object({ family: ComponentFamilySchema })
  .openapi("ComponentFamilyResponse");

export const ComponentFamilyListResponseSchema = z
  .object({ families: z.array(ComponentFamilySchema) })
  .openapi("ComponentFamilyListResponse");

export const DraftResponseSchema = z
  .object({ draft: ComponentDraftSchema })
  .openapi("DraftResponse");

export const PresetCatalogListResponseSchema = z
  .object({ catalogs: z.array(PresetCatalogSchema) })
  .openapi("PresetCatalogListResponse");

export const PresetCatalogResponseSchema = z
  .object({ catalog: PresetCatalogSchema })
  .openapi("PresetCatalogResponse");

export const ImportPreviewResponseSchema = z
  .object({ preview: ImportPreviewSchema })
  .openapi("ImportPreviewResponse");

export const ImportConfirmResponseSchema = z
  .object({
    familyIds: z.array(UUIDv7Schema),
    draftIds: z.array(UUIDv7Schema),
  })
  .openapi("ImportConfirmResponse");

export const SwitchPreviewResponseSchema = z
  .object({ switchPreview: SwitchPreviewSchema })
  .openapi("SwitchPreviewResponse");

export const ValidationResultResponseSchema = z
  .object({ validation: ValidationResultSchema })
  .openapi("ValidationResultResponse");

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type ComponentFamilyType = z.infer<typeof ComponentFamilySchema>;
export type PackageVariantType = z.infer<typeof PackageVariantSchema>;
export type FootprintOptionType = z.infer<typeof FootprintOptionSchema>;
export type Model3DOptionType = z.infer<typeof Model3DOptionSchema>;
export type ManufacturerOfferingType = z.infer<
  typeof ManufacturerOfferingSchema
>;
export type ComponentDraftType = z.infer<typeof ComponentDraftSchema>;
export type ComponentDraftPayloadType = z.infer<
  typeof ComponentDraftPayloadSchema
>;
export type ComponentRevisionType = z.infer<typeof ComponentRevisionSchema>;
export type ComponentProvenanceType = z.infer<typeof ComponentProvenanceSchema>;
export type SchematicComponentSelectionType = z.infer<
  typeof SchematicComponentSelectionSchema
>;
export type PresetCatalogType = z.infer<typeof PresetCatalogSchema>;
export type PresetVariantType = z.infer<typeof PresetVariantSchema>;
export type ValidationResultType = z.infer<typeof ValidationResultSchema>;
export type SwitchPreviewType = z.infer<typeof SwitchPreviewSchema>;
export type ImportPreviewType = z.infer<typeof ImportPreviewSchema>;
export type ImportPreviewGroupType = z.infer<typeof ImportPreviewGroupSchema>;
export type ImportConfirmInputType = z.infer<typeof ImportConfirmInputSchema>;
export type ImportWarningType = z.infer<typeof ImportWarningSchema>;
export type CreateComponentDraftInputType = z.infer<
  typeof CreateComponentDraftInputSchema
>;
export type UpdateComponentDraftInputType = z.infer<
  typeof UpdateComponentDraftInputSchema
>;
