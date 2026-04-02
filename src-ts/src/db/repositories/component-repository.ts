import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { and, eq, isNull, like, or, sql } from "drizzle-orm";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { withQueryLogging } from "../decorators";
import { BaseRepository } from "./base";
import {
  component,
  componentUsage,
  type ComponentRow,
  type NewComponentRow,
} from "../schema/component";
import { design } from "../schema/design";
import {
  componentVariant,
  type ComponentVariantRow,
  type NewComponentVariantRow,
} from "../schema/component-variant";
import { DbConflictError, DbNotFoundError } from "../errors";
import { generateUUIDv7 } from "../schema/base";

type MountType = "smd" | "through_hole" | "virtual";

export interface ComponentWithVariants {
  component: ComponentRow;
  variants: ComponentVariantRow[];
}

export type CreateVariantInput = Omit<
  NewComponentVariantRow,
  "id" | "componentId" | "createdAt" | "updatedAt"
>;

export interface CreateComponentInput {
  canonicalKey: string;
  displayLabel: string;
  description?: string;
  symbolData: Record<string, unknown>;
  categoryPath?: string | null;
  tags?: string[];
  variants: CreateVariantInput[];
}

export interface UpdateComponentInput {
  canonicalKey?: string;
  displayLabel?: string;
  description?: string;
  symbolData?: Record<string, unknown>;
  categoryPath?: string | null;
  tags?: string[];
  defaultVariantId?: string | null;
}

export type UpdateVariantInput = Partial<
  Omit<
    NewComponentVariantRow,
    "id" | "componentId" | "createdAt" | "updatedAt"
  >
>;

export interface ComponentListFilters {
  search?: string;
  categoryPath?: string;
  tags?: string[];
  mountType?: MountType;
}

export interface ComponentUsageInput {
  componentId: string;
  designId: string;
  variantId: string;
}

type DbExecutor = BunSQLiteDatabase<typeof schema>;

export class ComponentVariantRepository extends BaseRepository<
  typeof componentVariant,
  ComponentVariantRow,
  NewComponentVariantRow
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, componentVariant, logger, "ComponentVariant");
  }

  async addVariant(
    componentId: string,
    input: CreateVariantInput,
  ): Promise<ComponentVariantRow> {
    return withQueryLogging(this.logger, this.entityName, "addVariant", async () => {
      await this.ensureComponentExists(componentId);
      const variantId = generateUUIDv7();
      const now = new Date();

      const hasVariants = await this.getVariantCount(componentId);
      const shouldBeDefault = input.isDefault || hasVariants === 0;

      await this.db.transaction(async (tx) => {
        if (shouldBeDefault) {
          await this.clearDefaultForComponent(componentId, tx as unknown as DbExecutor);
        }

        await tx.insert(componentVariant).values({
          ...input,
          id: variantId,
          componentId,
          isDefault: shouldBeDefault,
          createdAt: now,
          updatedAt: now,
        });

        if (shouldBeDefault) {
          await tx
            .update(component)
            .set({ defaultVariantId: variantId, updatedAt: now })
            .where(eq(component.id, componentId));
        }
      });

      return this.findByIdOrThrow(variantId);
    });
  }

  async updateVariant(
    variantId: string,
    input: UpdateVariantInput,
  ): Promise<ComponentVariantRow> {
    return withQueryLogging(this.logger, this.entityName, "updateVariant", async () => {
      const current = await this.findByIdOrThrow(variantId);
      const { isDefault, ...rest } = input;

      await this.db
        .update(componentVariant)
        .set({ ...rest, updatedAt: new Date() })
        .where(eq(componentVariant.id, variantId));

      if (isDefault === true) {
        await this.setDefaultVariant(current.componentId, variantId);
      }

      if (isDefault === false && current.isDefault) {
        const fallback = await this.findFirstNonDefaultVariant(
          current.componentId,
          variantId,
        );
        if (!fallback) {
          throw new DbConflictError("At least one default variant is required");
        }
        await this.setDefaultVariant(current.componentId, fallback.id);
      }

      return this.findByIdOrThrow(variantId);
    });
  }

  async removeVariant(variantId: string): Promise<void> {
    return withQueryLogging(this.logger, this.entityName, "removeVariant", async () => {
      const existing = await this.findByIdOrThrow(variantId);
      const count = await this.getVariantCount(existing.componentId);

      if (count <= 1) {
        throw new DbConflictError("Cannot remove the only variant of a component");
      }

      await this.db.transaction(async (tx) => {
        await tx.delete(componentVariant).where(eq(componentVariant.id, variantId));

        if (existing.isDefault) {
          const fallback = await tx
            .select({ id: componentVariant.id })
            .from(componentVariant)
            .where(eq(componentVariant.componentId, existing.componentId))
            .limit(1);

          const fallbackId = fallback[0]?.id;
          if (!fallbackId) {
            throw new DbConflictError("Component must retain at least one variant");
          }

          await this.clearDefaultForComponent(
            existing.componentId,
            tx as unknown as DbExecutor,
          );
          await tx
            .update(componentVariant)
            .set({ isDefault: true, updatedAt: new Date() })
            .where(eq(componentVariant.id, fallbackId));
          await tx
            .update(component)
            .set({ defaultVariantId: fallbackId, updatedAt: new Date() })
            .where(eq(component.id, existing.componentId));
        }
      });
    });
  }

  async setDefaultFootprint(
    variantId: string,
    defaultFootprintId: string | null,
  ): Promise<ComponentVariantRow> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "setDefaultFootprint",
      async () => {
        await this.findByIdOrThrow(variantId);
        await this.db
          .update(componentVariant)
          .set({ defaultFootprintId, updatedAt: new Date() })
          .where(eq(componentVariant.id, variantId));
        return this.findByIdOrThrow(variantId);
      },
    );
  }

  async setDefaultVariant(
    componentId: string,
    variantId: string,
  ): Promise<ComponentVariantRow> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "setDefaultVariant",
      async () => {
        await this.ensureVariantBelongsToComponent(componentId, variantId);

        await this.db.transaction(async (tx) => {
          await this.clearDefaultForComponent(componentId, tx as unknown as DbExecutor);
          await tx
            .update(componentVariant)
            .set({ isDefault: true, updatedAt: new Date() })
            .where(eq(componentVariant.id, variantId));
          await tx
            .update(component)
            .set({ defaultVariantId: variantId, updatedAt: new Date() })
            .where(eq(component.id, componentId));
        });

        return this.findByIdOrThrow(variantId);
      },
    );
  }

  private async ensureComponentExists(componentId: string): Promise<void> {
    const found = await this.db
      .select({ id: component.id })
      .from(component)
      .where(eq(component.id, componentId))
      .limit(1);
    if (!found[0]) {
      throw new DbNotFoundError("Component not found", "Component", componentId);
    }
  }

  private async ensureVariantBelongsToComponent(
    componentId: string,
    variantId: string,
  ): Promise<void> {
    const found = await this.db
      .select({ id: componentVariant.id })
      .from(componentVariant)
      .where(
        and(
          eq(componentVariant.id, variantId),
          eq(componentVariant.componentId, componentId),
        ),
      )
      .limit(1);

    if (!found[0]) {
      throw new DbNotFoundError(
        "Variant not found for component",
        "ComponentVariant",
        variantId,
      );
    }
  }

  private async clearDefaultForComponent(
    componentId: string,
    tx: DbExecutor,
  ): Promise<void> {
    await tx
      .update(componentVariant)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(componentVariant.componentId, componentId));
  }

  private async getVariantCount(componentId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(componentVariant)
      .where(eq(componentVariant.componentId, componentId));

    return Number(rows[0]?.count ?? 0);
  }

  private async findFirstNonDefaultVariant(
    componentId: string,
    excludedVariantId: string,
  ): Promise<{ id: string } | null> {
    const rows = await this.db
      .select({ id: componentVariant.id })
      .from(componentVariant)
      .where(
        and(
          eq(componentVariant.componentId, componentId),
          sql`${componentVariant.id} != ${excludedVariantId}`,
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }
}

export class ComponentRepository extends BaseRepository<
  typeof component,
  ComponentRow,
  NewComponentRow
> {
  private variantsRepo: ComponentVariantRepository;

  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, component, logger, "Component");
    this.variantsRepo = new ComponentVariantRepository(db, logger);
  }

  async createComponent(input: CreateComponentInput): Promise<ComponentWithVariants> {
    return withQueryLogging(this.logger, this.entityName, "createComponent", async () => {
      if (input.variants.length === 0) {
        throw new DbConflictError("Component must include at least one variant");
      }

      const componentId = generateUUIDv7();
      const now = new Date();
      const defaultIndex = Math.max(
        0,
        input.variants.findIndex((variant) => variant.isDefault),
      );

      await this.db.transaction(async (tx) => {
        await tx.insert(component).values({
          id: componentId,
          canonicalKey: input.canonicalKey,
          displayLabel: input.displayLabel,
          description: input.description ?? "",
          scope: "workspace",
          symbolData: input.symbolData,
          categoryPath: input.categoryPath ?? null,
          tags: input.tags ?? [],
          defaultVariantId: null,
          createdAt: now,
          updatedAt: now,
        });

        let defaultVariantId: string | null = null;
        for (let i = 0; i < input.variants.length; i += 1) {
          const variant = input.variants[i]!;
          const variantId = generateUUIDv7();
          const isDefault = i === defaultIndex;

          await tx.insert(componentVariant).values({
            ...variant,
            id: variantId,
            componentId,
            isDefault,
            createdAt: now,
            updatedAt: now,
          });

          if (isDefault) {
            defaultVariantId = variantId;
          }
        }

        await tx
          .update(component)
          .set({ defaultVariantId, updatedAt: new Date() })
          .where(eq(component.id, componentId));
      });

      return this.getComponentOrThrow(componentId);
    });
  }

  async getComponent(componentId: string): Promise<ComponentWithVariants | null> {
    return withQueryLogging(this.logger, this.entityName, "getComponent", async () => {
      return this.getComponentById(componentId);
    });
  }

  async updateComponent(
    componentId: string,
    input: UpdateComponentInput,
  ): Promise<ComponentWithVariants> {
    return withQueryLogging(this.logger, this.entityName, "updateComponent", async () => {
      await this.findByIdOrThrow(componentId);
      const { defaultVariantId, ...componentUpdates } = input;

      if (Object.keys(componentUpdates).length > 0) {
        await this.db
          .update(component)
          .set({ ...componentUpdates, updatedAt: new Date() })
          .where(eq(component.id, componentId));
      }

      if (defaultVariantId) {
        await this.setDefaultVariant(componentId, defaultVariantId);
      }

      return this.getComponentOrThrow(componentId);
    });
  }

  async deleteComponent(componentId: string): Promise<void> {
    return withQueryLogging(this.logger, this.entityName, "deleteComponent", async () => {
      await this.findByIdOrThrow(componentId);
      const usageCount = await this.getUsageCount(componentId);

      if (usageCount > 0) {
        throw new DbConflictError(
          `Component is in use by ${usageCount} design(s)`,
          "Component",
          componentId,
        );
      }

      await this.db.delete(component).where(eq(component.id, componentId));
    });
  }

  async listComponents(
    filters: ComponentListFilters = {},
  ): Promise<ComponentWithVariants[]> {
    return withQueryLogging(this.logger, this.entityName, "listComponents", async () => {
      const conditions = [eq(component.scope, "workspace")];

      if (filters.search) {
        conditions.push(
          or(
            like(component.displayLabel, `%${filters.search}%`),
            like(component.canonicalKey, `%${filters.search}%`),
            like(component.description, `%${filters.search}%`),
          )!,
        );
      }

      if (filters.categoryPath) {
        conditions.push(like(component.categoryPath, `${filters.categoryPath}%`));
      }

      if (filters.tags && filters.tags.length > 0) {
        const tagConditions = filters.tags.map((tag) =>
          like(component.tags, `%"${tag}"%`),
        );
        conditions.push(or(...tagConditions)!);
      }

      if (filters.mountType) {
        const ids = await this.db
          .selectDistinct({ id: component.id })
          .from(component)
          .innerJoin(
            componentVariant,
            eq(componentVariant.componentId, component.id),
          )
          .where(
            and(
              eq(component.scope, "workspace"),
              eq(componentVariant.mountType, filters.mountType),
            ),
          );

        if (ids.length === 0) {
          return [];
        }

        const idPredicates = ids.map((row) => eq(component.id, row.id));
        conditions.push(or(...idPredicates)!);
      }

      const components = await this.db
        .select()
        .from(component)
        .where(and(...conditions));

      const result = await Promise.all(
        components.map(async (row) => this.getComponentOrThrow(row.id)),
      );

      return result;
    });
  }

  async setDefaultVariant(
    componentId: string,
    variantId: string,
  ): Promise<ComponentWithVariants> {
    return withQueryLogging(this.logger, this.entityName, "setDefaultVariant", async () => {
      await this.variantsRepo.setDefaultVariant(componentId, variantId);
      return this.getComponentOrThrow(componentId);
    });
  }

  async recordUsage(input: ComponentUsageInput): Promise<void> {
    return withQueryLogging(this.logger, this.entityName, "recordUsage", async () => {
      await this.findByIdOrThrow(input.componentId);

      const variant = await this.variantsRepo.findByIdOrThrow(input.variantId);
      if (variant.componentId !== input.componentId) {
        throw new DbConflictError(
          "Variant does not belong to component",
          "ComponentVariant",
          input.variantId,
        );
      }

      await this.db
        .insert(componentUsage)
        .values({
          id: generateUUIDv7(),
          componentId: input.componentId,
          designId: input.designId,
          variantId: input.variantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing({
          target: [
            componentUsage.designId,
            componentUsage.componentId,
            componentUsage.variantId,
          ],
        });
    });
  }

  async removeUsage(input: {
    componentId: string;
    designId: string;
    variantId?: string;
  }): Promise<void> {
    return withQueryLogging(this.logger, this.entityName, "removeUsage", async () => {
      const whereCondition = input.variantId
        ? and(
            eq(componentUsage.componentId, input.componentId),
            eq(componentUsage.designId, input.designId),
            eq(componentUsage.variantId, input.variantId),
          )
        : and(
            eq(componentUsage.componentId, input.componentId),
            eq(componentUsage.designId, input.designId),
          );

      await this.db.delete(componentUsage).where(whereCondition!);
    });
  }

  async getUsageCount(componentId: string): Promise<number> {
    return withQueryLogging(this.logger, this.entityName, "getUsageCount", async () => {
      const rows = await this.db
        .select({ count: sql<number>`count(distinct ${componentUsage.designId})` })
        .from(componentUsage)
        .innerJoin(
          design,
          and(
            eq(design.id, componentUsage.designId),
            isNull(design.deletedAt),
          ),
        )
        .where(eq(componentUsage.componentId, componentId));

      return Number(rows[0]?.count ?? 0);
    });
  }

  get variants(): ComponentVariantRepository {
    return this.variantsRepo;
  }

  private async getComponentById(
    componentId: string,
  ): Promise<ComponentWithVariants | null> {
    const found = await this.db
      .select()
      .from(component)
      .where(eq(component.id, componentId))
      .limit(1);

    const componentRow = found[0];
    if (!componentRow) {
      return null;
    }

    const variants = await this.db
      .select()
      .from(componentVariant)
      .where(eq(componentVariant.componentId, componentId));

    return { component: componentRow, variants };
  }

  private async getComponentOrThrow(
    componentId: string,
  ): Promise<ComponentWithVariants> {
    const result = await this.getComponentById(componentId);
    if (!result) {
      throw new DbNotFoundError("Component not found", "Component", componentId);
    }
    return result;
  }
}
