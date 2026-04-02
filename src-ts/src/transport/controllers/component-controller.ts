import type { RouteContext } from "../router";
import {
  type ComponentListFilters,
  type ComponentRepository,
  type ComponentWithVariants,
  type CreateComponentInput,
  type CreateVariantInput,
  type UpdateComponentInput,
  type UpdateVariantInput,
} from "../../db/repositories/component-repository";
import type { FootprintOption } from "../../db/schema/component-variant";
import {
  DbConflictError,
  DbNotFoundError,
  UniqueConstraintError,
} from "../../db/errors";
import { ResponseBuilder } from "../../core/utils/response-builder";

type ComponentRequestVariant = {
  id?: string;
  canonicalCode?: string;
  humanLabel?: string;
  imperialAlias?: string | null;
  metricAlias?: string | null;
  mountType?: "smd" | "through_hole" | "virtual";
  dimensions?: {
    lengthMm: number;
    widthMm: number;
    heightMm: number | null;
  } | null;
  isDefault?: boolean;
  pinRemapTable?: Record<string, string> | null;
  footprintOptions?: Array<{
    id: string;
    variantId?: string;
    label?: string;
    isDefault?: boolean;
    kicadPayload?: Record<string, unknown> | null;
    model3dOptions?: unknown[];
    densityLevel?: "most" | "nominal" | "least" | null;
    ipcName?: string | null;
  }>;
  defaultFootprintOptionId?: string | null;
};

type ComponentRequestBody = {
  canonicalKey?: string;
  displayLabel?: string;
  description?: string;
  symbolData?: Record<string, unknown>;
  categoryPath?: string | null;
  tags?: string[];
  defaultVariantId?: string | null;
  variants?: ComponentRequestVariant[];
};

export class ComponentController {
  constructor(private repo: ComponentRepository) {}

  async listComponents(ctx: RouteContext): Promise<Response> {
    try {
      const filters: ComponentListFilters = {
        search: ctx.query.get("search") ?? undefined,
        categoryPath: ctx.query.get("categoryPath") ?? undefined,
        mountType:
          (ctx.query.get("mountType") as ComponentListFilters["mountType"]) ??
          undefined,
        tags: ctx.query.get("tags")?.split(",").filter(Boolean),
      };

      const components = await this.repo.listComponents(filters);
      return ResponseBuilder.success({
        components: components.map((component) =>
          serializeComponent(component),
        ),
      });
    } catch (error) {
      return this.handleRepositoryError(error, "Component");
    }
  }

  async getComponent(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");

    try {
      const component = await this.repo.getComponent(id);
      if (!component) {
        return ResponseBuilder.notFound("Component", id);
      }

      return ResponseBuilder.success({
        component: serializeComponent(component),
      });
    } catch (error) {
      return this.handleRepositoryError(error, "Component", id);
    }
  }

  async createComponent(ctx: RouteContext): Promise<Response> {
    try {
      const body = (await ctx.req.json()) as ComponentRequestBody;
      const component = await this.repo.createComponent(
        parseCreateComponentInput(body),
      );
      return ResponseBuilder.created({
        component: serializeComponent(component),
      });
    } catch (error) {
      return this.handleRepositoryError(error, "Component");
    }
  }

  async updateComponent(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");

    try {
      const body = (await ctx.req.json()) as ComponentRequestBody;
      const component = await this.repo.updateComponent(
        id,
        parseUpdateComponentInput(body),
      );
      return ResponseBuilder.success({
        component: serializeComponent(component),
      });
    } catch (error) {
      return this.handleRepositoryError(error, "Component", id);
    }
  }

  async deleteComponent(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const forceUsedDelete = ctx.query.get("force") === "true";

    try {
      const impact = await this.repo.getDeleteImpact(id);
      if (impact.usageCount > 0 && !forceUsedDelete) {
        return ResponseBuilder.conflict(
          `Component is in use by ${impact.usageCount} design(s)`,
          {
            resource: "Component",
            id,
            usageCount: impact.usageCount,
            designNames: impact.designNames,
          },
        );
      }

      await this.repo.deleteComponent(id);
      return ResponseBuilder.success({
        deleted: true,
        usageCount: impact.usageCount,
        designNames: impact.designNames,
      });
    } catch (error) {
      return this.handleRepositoryError(error, "Component", id);
    }
  }

  async getDeleteImpact(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");

    try {
      const impact = await this.repo.getDeleteImpact(id);
      return ResponseBuilder.success(impact);
    } catch (error) {
      return this.handleRepositoryError(error, "Component", id);
    }
  }

  async bulkDeleteComponents(ctx: RouteContext): Promise<Response> {
    const body = (await ctx.req.json()) as {
      ids?: string[];
      forceUsed?: boolean;
    };
    const ids = body.ids ?? [];
    const forceUsed = body.forceUsed === true;

    if (ids.length === 0) {
      return ResponseBuilder.badRequest("No component IDs provided");
    }

    const skippedUsed: Array<{
      id: string;
      usageCount: number;
      designNames: string[];
    }> = [];
    const deletedUsed: Array<{
      id: string;
      usageCount: number;
      designNames: string[];
    }> = [];

    let deletedCount = 0;
    let skippedNotFoundCount = 0;

    for (const id of ids) {
      const existing = await this.repo.getComponent(id);
      if (!existing) {
        skippedNotFoundCount++;
        continue;
      }

      const impact = await this.repo.getDeleteImpact(id);
      if (impact.usageCount > 0 && !forceUsed) {
        skippedUsed.push({
          id,
          usageCount: impact.usageCount,
          designNames: impact.designNames,
        });
        continue;
      }

      await this.repo.deleteComponent(id);
      deletedCount++;

      if (impact.usageCount > 0) {
        deletedUsed.push({
          id,
          usageCount: impact.usageCount,
          designNames: impact.designNames,
        });
      }
    }

    const skippedUsedCount = skippedUsed.length;
    const skippedCount = skippedNotFoundCount + skippedUsedCount;

    return ResponseBuilder.success({
      deleted: true,
      deletedCount,
      skippedCount,
      skippedNotFoundCount,
      skippedUsedCount,
      skippedUsed,
      deletedUsedCount: deletedUsed.length,
      deletedUsed,
    });
  }

  async addVariant(ctx: RouteContext): Promise<Response> {
    const componentId = ctx.params.getOrThrow("id");

    try {
      const body = (await ctx.req.json()) as ComponentRequestVariant;
      const variant = await this.repo.variants.addVariant(
        componentId,
        parseCreateVariantInput(body),
      );
      return ResponseBuilder.created({ variant: serializeVariant(variant) });
    } catch (error) {
      return this.handleRepositoryError(error, "Component", componentId);
    }
  }

  async updateVariant(ctx: RouteContext): Promise<Response> {
    const componentId = ctx.params.getOrThrow("id");
    const variantId = ctx.params.getOrThrow("variantId");

    try {
      await this.ensureVariantBelongsToComponent(componentId, variantId);
      const body = (await ctx.req.json()) as ComponentRequestVariant;
      const variant = await this.repo.variants.updateVariant(
        variantId,
        parseUpdateVariantInput(body),
      );
      return ResponseBuilder.success({ variant: serializeVariant(variant) });
    } catch (error) {
      return this.handleRepositoryError(error, "ComponentVariant", variantId);
    }
  }

  async removeVariant(ctx: RouteContext): Promise<Response> {
    const componentId = ctx.params.getOrThrow("id");
    const variantId = ctx.params.getOrThrow("variantId");

    try {
      await this.ensureVariantBelongsToComponent(componentId, variantId);
      await this.repo.variants.removeVariant(variantId);
      return ResponseBuilder.success({ deleted: true });
    } catch (error) {
      return this.handleRepositoryError(error, "ComponentVariant", variantId);
    }
  }

  async setDefaultVariant(ctx: RouteContext): Promise<Response> {
    const componentId = ctx.params.getOrThrow("id");

    try {
      const body = (await ctx.req.json()) as { variantId?: string };
      if (!body.variantId) {
        return ResponseBuilder.badRequest("variantId is required");
      }

      const component = await this.repo.setDefaultVariant(
        componentId,
        body.variantId,
      );
      return ResponseBuilder.success({
        component: serializeComponent(component),
      });
    } catch (error) {
      return this.handleRepositoryError(error, "Component", componentId);
    }
  }

  private async ensureVariantBelongsToComponent(
    componentId: string,
    variantId: string,
  ): Promise<void> {
    const component = await this.repo.getComponent(componentId);
    if (!component) {
      throw new DbNotFoundError(
        "Component not found",
        "Component",
        componentId,
      );
    }

    const belongsToComponent = component.variants.some(
      (variant) => variant.id === variantId,
    );
    if (!belongsToComponent) {
      throw new DbNotFoundError(
        "Variant not found for component",
        "ComponentVariant",
        variantId,
      );
    }
  }

  private handleRepositoryError(
    error: unknown,
    resource: string,
    id?: string,
  ): Response {
    if (error instanceof DbNotFoundError) {
      return ResponseBuilder.notFound(error.entity ?? resource, error.id ?? id);
    }

    if (
      error instanceof DbConflictError ||
      error instanceof UniqueConstraintError
    ) {
      return ResponseBuilder.conflict(error.message, {
        resource,
        id,
      });
    }

    throw error;
  }
}

function parseCreateComponentInput(
  body: ComponentRequestBody,
): CreateComponentInput {
  const displayLabel = body.displayLabel?.trim() || "Untitled Component";
  const variants = getRequestVariants(body);

  return {
    canonicalKey:
      body.canonicalKey?.trim() || generateCanonicalKey(displayLabel),
    displayLabel,
    description: body.description ?? "",
    symbolData: body.symbolData ?? createEmptySymbolData(),
    categoryPath: resolveCategoryPath(body.categoryPath, body.symbolData),
    tags: body.tags ?? [],
    variants:
      variants.length > 0
        ? variants.map(parseCreateVariantInput)
        : [createPlaceholderVariant(displayLabel)],
  };
}

function parseUpdateComponentInput(
  body: ComponentRequestBody,
): UpdateComponentInput {
  const updates: UpdateComponentInput = {};

  if (body.canonicalKey !== undefined) updates.canonicalKey = body.canonicalKey;
  if (body.displayLabel !== undefined) updates.displayLabel = body.displayLabel;
  if (body.description !== undefined) updates.description = body.description;
  if (body.symbolData !== undefined) updates.symbolData = body.symbolData;
  if (body.categoryPath !== undefined || body.symbolData !== undefined) {
    updates.categoryPath = resolveCategoryPath(
      body.categoryPath,
      body.symbolData,
    );
  }
  if (body.tags !== undefined) updates.tags = body.tags;

  if (body.defaultVariantId !== undefined) {
    updates.defaultVariantId = body.defaultVariantId;
  }

  return updates;
}

function parseCreateVariantInput(
  variant: ComponentRequestVariant,
): CreateVariantInput {
  const footprintOptions = getVariantFootprintOptions(variant);
  const defaultFootprintOptionId = getVariantDefaultFootprintOptionId(
    variant,
    footprintOptions,
  );

  return {
    canonicalCode: variant.canonicalCode?.trim() || "default",
    humanLabel: variant.humanLabel?.trim() || "Default",
    imperialAlias: variant.imperialAlias ?? null,
    metricAlias: variant.metricAlias ?? null,
    mountType: variant.mountType ?? "smd",
    dimensions: variant.dimensions ?? null,
    isDefault: variant.isDefault ?? false,
    pinRemapTable: variant.pinRemapTable ?? null,
    footprintOptions,
    defaultFootprintOptionId,
  };
}

function parseUpdateVariantInput(
  variant: ComponentRequestVariant,
): UpdateVariantInput {
  const updates: UpdateVariantInput = {};

  if (variant.canonicalCode !== undefined)
    updates.canonicalCode = variant.canonicalCode;
  if (variant.humanLabel !== undefined) updates.humanLabel = variant.humanLabel;
  if (variant.imperialAlias !== undefined)
    updates.imperialAlias = variant.imperialAlias;
  if (variant.metricAlias !== undefined)
    updates.metricAlias = variant.metricAlias;
  if (variant.mountType !== undefined) updates.mountType = variant.mountType;
  if (variant.dimensions !== undefined) updates.dimensions = variant.dimensions;
  if (variant.isDefault !== undefined) updates.isDefault = variant.isDefault;
  if (variant.pinRemapTable !== undefined)
    updates.pinRemapTable = variant.pinRemapTable;
  if (variant.footprintOptions !== undefined) {
    updates.footprintOptions = getVariantFootprintOptions(variant);
    updates.defaultFootprintOptionId = getVariantDefaultFootprintOptionId(
      variant,
      updates.footprintOptions,
    );
  }

  return updates;
}

function serializeComponent(component: ComponentWithVariants) {
  const variants = component.variants.map((variant) =>
    serializeVariant(variant),
  );

  return {
    ...component.component,
    variants,
    defaultVariantId: component.component.defaultVariantId,
  };
}

function serializeVariant(variant: ComponentWithVariants["variants"][number]) {
  return {
    ...variant,
    footprintOptions: variant.footprintOptions ?? [],
    defaultFootprintOptionId: variant.defaultFootprintOptionId ?? null,
  };
}

function getRequestVariants(
  body: ComponentRequestBody,
): ComponentRequestVariant[] {
  return body.variants ?? [];
}

function getVariantFootprintOptions(
  variant: ComponentRequestVariant,
): FootprintOption[] {
  return (variant.footprintOptions ?? []).map((opt) => ({
    id: opt.id,
    variantId: opt.variantId ?? "",
    label: opt.label ?? "Default",
    isDefault: opt.isDefault ?? false,
    kicadPayload: opt.kicadPayload ?? null,
    model3dOptions: opt.model3dOptions ?? [],
    densityLevel: opt.densityLevel ?? null,
    ipcName: opt.ipcName ?? null,
  }));
}

function getVariantDefaultFootprintOptionId(
  variant: ComponentRequestVariant,
  footprintOptions: FootprintOption[],
): string | null {
  if (variant.defaultFootprintOptionId !== undefined) {
    return variant.defaultFootprintOptionId;
  }

  const defaultOption = footprintOptions.find((opt) => opt.isDefault);
  return defaultOption?.id ?? footprintOptions[0]?.id ?? null;
}

function createEmptySymbolData(): Record<string, unknown> {
  return {
    referencePrefix: "U",
    pinDefinitions: [],
    properties: {},
    unitCount: 1,
    bodyGraphics: [],
    rawKicadSource: null,
  };
}

function createPlaceholderVariant(displayLabel: string): CreateVariantInput {
  return {
    canonicalCode: "default",
    humanLabel: displayLabel || "Default",
    imperialAlias: null,
    metricAlias: null,
    mountType: "smd",
    dimensions: null,
    isDefault: true,
    pinRemapTable: null,
    footprintOptions: [],
    defaultFootprintOptionId: null,
  };
}

function resolveCategoryPath(
  categoryPath: string | null | undefined,
  symbolData: Record<string, unknown> | undefined,
): string | null {
  if (categoryPath !== undefined) {
    return categoryPath;
  }

  const properties = symbolData?.properties;
  if (
    properties &&
    typeof properties === "object" &&
    "__openpcbCategoryPath" in properties &&
    typeof properties.__openpcbCategoryPath === "string"
  ) {
    return properties.__openpcbCategoryPath;
  }

  return null;
}

function generateCanonicalKey(displayLabel: string): string {
  const base = displayLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (base.length > 0) {
    return base;
  }

  return `component-${crypto.randomUUID().slice(0, 8)}`;
}
