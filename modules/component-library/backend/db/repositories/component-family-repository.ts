import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { BaseRepository } from "./base";
import {
  componentFamily,
  type ComponentFamilyRow,
  type NewComponentFamilyRow,
} from "../schema/component-family";
import {
  packageVariant,
  type PackageVariantRow,
  type NewPackageVariantRow,
} from "../schema/package-variant";
import {
  footprintOption,
  type FootprintOptionRow,
  type NewFootprintOptionRow,
} from "../schema/footprint-option";
import {
  model3dOption,
  type Model3dOptionRow,
  type NewModel3dOptionRow,
} from "../schema/model-3d-option";
import {
  manufacturerOffering,
  type ManufacturerOfferingRow,
  type NewManufacturerOfferingRow,
} from "../schema/manufacturer-offering";
import {
  componentRevision,
  type ComponentRevisionRow,
  type NewComponentRevisionRow,
} from "../schema/component-revision";
import {
  componentProvenance,
  type ComponentProvenanceRow,
  type NewComponentProvenanceRow,
} from "../schema/component-provenance";
import { and, eq, isNull, like, or, desc } from "drizzle-orm";
import { withQueryLogging } from "../decorators";

export class ComponentFamilyRepository extends BaseRepository<
  typeof componentFamily,
  ComponentFamilyRow,
  NewComponentFamilyRow
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, componentFamily, logger, "ComponentFamily");
  }

  async findByScope(scope: string): Promise<ComponentFamilyRow[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByScope",
      async () => {
        return this.db
          .select()
          .from(componentFamily)
          .where(
            and(
              eq(componentFamily.scope, scope as any),
              isNull(componentFamily.deletedAt),
            ),
          );
      },
    );
  }

  async findByScopeAndKey(
    scope: string,
    canonicalKey: string,
  ): Promise<ComponentFamilyRow | null> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByScopeAndKey",
      async () => {
        const result = await this.db
          .select()
          .from(componentFamily)
          .where(
            and(
              eq(componentFamily.scope, scope as any),
              eq(componentFamily.canonicalKey, canonicalKey),
              isNull(componentFamily.deletedAt),
            ),
          )
          .limit(1);
        return result[0] ?? null;
      },
    );
  }

  async search(query: string, scope?: string): Promise<ComponentFamilyRow[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "search",
      async () => {
        const conditions: any[] = [
          isNull(componentFamily.deletedAt),
          or(
            like(componentFamily.displayLabel, `%${query}%`),
            like(componentFamily.canonicalKey, `%${query}%`),
          ),
        ];
        if (scope) {
          conditions.push(eq(componentFamily.scope, scope as any));
        }
        return this.db
          .select()
          .from(componentFamily)
          .where(and(...conditions));
      },
    );
  }

  async findWithFilters(filters: {
    scope?: string;
    categoryPath?: string;
    tags?: string[];
    mountType?: string;
    search?: string;
  }): Promise<ComponentFamilyRow[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findWithFilters",
      async () => {
        const conditions: any[] = [isNull(componentFamily.deletedAt)];

        if (filters.scope) {
          conditions.push(eq(componentFamily.scope, filters.scope as any));
        }

        if (filters.categoryPath) {
          conditions.push(
            like(componentFamily.categoryPath, `${filters.categoryPath}%`),
          );
        }

        if (filters.search) {
          conditions.push(
            or(
              like(componentFamily.displayLabel, `%${filters.search}%`),
              like(componentFamily.canonicalKey, `%${filters.search}%`),
              like(componentFamily.description, `%${filters.search}%`),
            ),
          );
        }

        // Handle tags filter (JSON array containment)
        if (filters.tags && filters.tags.length > 0) {
          const tagConditions = filters.tags.map((tag) =>
            like(componentFamily.tags, `%"${tag}"%`),
          );
          conditions.push(or(...tagConditions));
        }

        // Handle mountType filter via join with packageVariant
        if (filters.mountType) {
          const familiesWithMount = await this.db
            .selectDistinct({ id: componentFamily.id })
            .from(componentFamily)
            .innerJoin(
              packageVariant,
              eq(packageVariant.familyId, componentFamily.id),
            )
            .where(
              and(
                isNull(componentFamily.deletedAt),
                eq(packageVariant.mountType, filters.mountType as any),
                isNull(packageVariant.deletedAt),
              ),
            );

          const familyIds = familiesWithMount.map((f) => f.id);
          if (familyIds.length === 0) {
            return [];
          }

          return this.db
            .select()
            .from(componentFamily)
            .where(
              and(
                ...conditions,
                or(...familyIds.map((id) => eq(componentFamily.id, id))),
              ),
            );
        }

        return this.db
          .select()
          .from(componentFamily)
          .where(and(...conditions));
      },
    );
  }

  async findByIdWithRelations(id: string): Promise<{
    family: ComponentFamilyRow;
    variants: PackageVariantRow[];
    footprints: FootprintOptionRow[];
    models: Model3dOptionRow[];
    offerings: ManufacturerOfferingRow[];
  }> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByIdWithRelations",
      async () => {
        const family = await this.findByIdOrThrow(id);
        const variants = await this.findVariantsByFamily(id);

        const variantIds = variants.map((v) => v.id);

        // Load all footprints for all variants
        const footprints: FootprintOptionRow[] = [];
        for (const variantId of variantIds) {
          const fps = await this.findFootprintsByVariant(variantId);
          footprints.push(...fps);
        }

        // Load all 3D models
        let models: Model3dOptionRow[] = [];
        if (footprints.length > 0) {
          models = await this.db
            .select()
            .from(model3dOption)
            .where(
              or(
                ...footprints.map((fp) =>
                  eq(model3dOption.footprintOptionId, fp.id),
                ),
              ),
            );
        }

        // Load all offerings
        let offerings: ManufacturerOfferingRow[] = [];
        if (variantIds.length > 0) {
          offerings = await this.db
            .select()
            .from(manufacturerOffering)
            .where(
              or(...variantIds.map((vid) => eq(manufacturerOffering.variantId, vid))),
            );
        }

        return {
          family,
          variants,
          footprints,
          models,
          offerings,
        };
      },
    );
  }

  // --- Variant CRUD ---

  async createVariant(
    data: Omit<NewPackageVariantRow, "id" | "createdAt" | "updatedAt">,
  ): Promise<PackageVariantRow> {
    return withQueryLogging(
      this.logger,
      "PackageVariant",
      "create",
      async () => {
        const { generateUUIDv7 } = await import("../schema/base");
        const id = generateUUIDv7();
        const now = new Date();
        await this.db
          .insert(packageVariant)
          .values({ ...data, id, createdAt: now, updatedAt: now } as never);
        const result = await this.db
          .select()
          .from(packageVariant)
          .where(eq(packageVariant.id, id))
          .limit(1);
        return result[0]!;
      },
    );
  }

  async findVariantsByFamily(familyId: string): Promise<PackageVariantRow[]> {
    return withQueryLogging(
      this.logger,
      "PackageVariant",
      "findByFamily",
      async () => {
        return this.db
          .select()
          .from(packageVariant)
          .where(
            and(
              eq(packageVariant.familyId, familyId),
              isNull(packageVariant.deletedAt),
            ),
          );
      },
    );
  }

  // --- Footprint CRUD ---

  async createFootprint(
    data: Omit<NewFootprintOptionRow, "id" | "createdAt" | "updatedAt">,
  ): Promise<FootprintOptionRow> {
    return withQueryLogging(
      this.logger,
      "FootprintOption",
      "create",
      async () => {
        const { generateUUIDv7 } = await import("../schema/base");
        const id = generateUUIDv7();
        const now = new Date();
        await this.db
          .insert(footprintOption)
          .values({ ...data, id, createdAt: now, updatedAt: now } as never);
        const result = await this.db
          .select()
          .from(footprintOption)
          .where(eq(footprintOption.id, id))
          .limit(1);
        return result[0]!;
      },
    );
  }

  async findFootprintsByVariant(
    variantId: string,
  ): Promise<FootprintOptionRow[]> {
    return withQueryLogging(
      this.logger,
      "FootprintOption",
      "findByVariant",
      async () => {
        return this.db
          .select()
          .from(footprintOption)
          .where(
            and(
              eq(footprintOption.variantId, variantId),
              isNull(footprintOption.deletedAt),
            ),
          );
      },
    );
  }

  // --- 3D Model CRUD ---

  async createModel3d(
    data: Omit<NewModel3dOptionRow, "id" | "createdAt" | "updatedAt">,
  ): Promise<Model3dOptionRow> {
    return withQueryLogging(
      this.logger,
      "Model3dOption",
      "create",
      async () => {
        const { generateUUIDv7 } = await import("../schema/base");
        const id = generateUUIDv7();
        const now = new Date();
        await this.db
          .insert(model3dOption)
          .values({ ...data, id, createdAt: now, updatedAt: now } as never);
        const result = await this.db
          .select()
          .from(model3dOption)
          .where(eq(model3dOption.id, id))
          .limit(1);
        return result[0]!;
      },
    );
  }

  // --- Offering CRUD ---

  async createOffering(
    data: Omit<NewManufacturerOfferingRow, "id" | "createdAt" | "updatedAt">,
  ): Promise<ManufacturerOfferingRow> {
    return withQueryLogging(
      this.logger,
      "ManufacturerOffering",
      "create",
      async () => {
        const { generateUUIDv7 } = await import("../schema/base");
        const id = generateUUIDv7();
        const now = new Date();
        await this.db
          .insert(manufacturerOffering)
          .values({ ...data, id, createdAt: now, updatedAt: now } as never);
        const result = await this.db
          .select()
          .from(manufacturerOffering)
          .where(eq(manufacturerOffering.id, id))
          .limit(1);
        return result[0]!;
      },
    );
  }

  // --- Revision CRUD ---

  async createRevision(
    data: Omit<NewComponentRevisionRow, "id" | "createdAt" | "updatedAt">,
  ): Promise<ComponentRevisionRow> {
    return withQueryLogging(
      this.logger,
      "ComponentRevision",
      "create",
      async () => {
        const { generateUUIDv7 } = await import("../schema/base");
        const id = generateUUIDv7();
        const now = new Date();
        await this.db
          .insert(componentRevision)
          .values({ ...data, id, createdAt: now, updatedAt: now } as never);
        const result = await this.db
          .select()
          .from(componentRevision)
          .where(eq(componentRevision.id, id))
          .limit(1);
        return result[0]!;
      },
    );
  }

  async findLatestRevision(
    familyId: string,
  ): Promise<ComponentRevisionRow | null> {
    return withQueryLogging(
      this.logger,
      "ComponentRevision",
      "findLatest",
      async () => {
        const result = await this.db
          .select()
          .from(componentRevision)
          .where(eq(componentRevision.familyId, familyId))
          .orderBy(desc(componentRevision.revisionNumber))
          .limit(1);
        return result[0] ?? null;
      },
    );
  }

  // --- Provenance CRUD ---

  async createProvenance(
    data: Omit<NewComponentProvenanceRow, "id" | "createdAt" | "updatedAt">,
  ): Promise<ComponentProvenanceRow> {
    return withQueryLogging(
      this.logger,
      "ComponentProvenance",
      "create",
      async () => {
        const { generateUUIDv7 } = await import("../schema/base");
        const id = generateUUIDv7();
        const now = new Date();
        await this.db
          .insert(componentProvenance)
          .values({ ...data, id, createdAt: now, updatedAt: now } as never);
        const result = await this.db
          .select()
          .from(componentProvenance)
          .where(eq(componentProvenance.id, id))
          .limit(1);
        return result[0]!;
      },
    );
  }

  async findProvenanceByFamily(
    familyId: string,
  ): Promise<ComponentProvenanceRow | null> {
    return withQueryLogging(
      this.logger,
      "ComponentProvenance",
      "findByFamily",
      async () => {
        const result = await this.db
          .select()
          .from(componentProvenance)
          .where(eq(componentProvenance.familyId, familyId))
          .limit(1);
        return result[0] ?? null;
      },
    );
  }

  // --- Full AggregatCreate ---

  async createFamilyWithHierarchy(data: {
    family: Omit<NewComponentFamilyRow, "id" | "createdAt" | "updatedAt">;
    variants: Array<{
      variant: Omit<
        NewPackageVariantRow,
        "id" | "createdAt" | "updatedAt" | "familyId"
      >;
      footprints: Array<{
        footprint: Omit<
          NewFootprintOptionRow,
          "id" | "createdAt" | "updatedAt" | "variantId"
        >;
        models: Array<
          Omit<NewModel3dOptionRow, "id" | "createdAt" | "updatedAt" | "footprintOptionId">
        >;
      }>;
    }>;
    provenance?: Omit<
      NewComponentProvenanceRow,
      "id" | "createdAt" | "updatedAt" | "familyId"
    >;
  }): Promise<{
    family: ComponentFamilyRow;
    variants: PackageVariantRow[];
    footprints: FootprintOptionRow[];
    models: Model3dOptionRow[];
  }> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "createFamilyWithHierarchy",
      async () => {
        const family = await this.create(data.family);
        const createdVariants: PackageVariantRow[] = [];
        const createdFootprints: FootprintOptionRow[] = [];
        const createdModels: Model3dOptionRow[] = [];

        let defaultVariantId: string | null = null;

        for (const v of data.variants) {
          const variant = await this.createVariant({
            ...v.variant,
            familyId: family.id,
          });
          createdVariants.push(variant);

          if (v.variant.isDefault ?? false) {
            defaultVariantId = variant.id;
          }

          let defaultFootprintId: string | null = null;
          for (const fp of v.footprints) {
            const footprint = await this.createFootprint({
              ...fp.footprint,
              variantId: variant.id,
            });
            createdFootprints.push(footprint);

            if (fp.footprint.isDefault ?? false) {
              defaultFootprintId = footprint.id;
            }

            for (const m of fp.models) {
              const model = await this.createModel3d({
                ...m,
                footprintOptionId: footprint.id,
              });
              createdModels.push(model);
            }
          }

          // Update variant with default footprint
          if (defaultFootprintId) {
            await this.db
              .update(packageVariant)
              .set({ defaultFootprintOptionId: defaultFootprintId })
              .where(eq(packageVariant.id, variant.id));
          }
        }

        // Update family with default variant
        if (defaultVariantId) {
          await this.db
            .update(componentFamily)
            .set({ defaultPackageVariantId: defaultVariantId })
            .where(eq(componentFamily.id, family.id));
        }

        // Create provenance if provided
        if (data.provenance) {
          await this.createProvenance({
            ...data.provenance,
            familyId: family.id,
          });
        }

        return {
          family,
          variants: createdVariants,
          footprints: createdFootprints,
          models: createdModels,
        };
      },
    );
  }
}
