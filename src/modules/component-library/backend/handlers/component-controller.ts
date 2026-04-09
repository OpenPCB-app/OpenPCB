import type { RouteContext } from "@shared/types/http";
import {
  type ComponentListFilters,
  type ComponentRepository,
  type ComponentWithVariants,
  type CreateComponentInput,
  type CreateVariantInput,
} from "../db/repositories/component-repository";
import type { FootprintOption } from "../db/schema/component-variant";
import {
  DbConflictError,
  DbNotFoundError,
  UniqueConstraintError,
} from "../db/errors";
import { ResponseBuilder } from "../core/utils/response-builder";

/**
 * ComponentController — first-pass minimal surface covering only the
 * create + list flows exercised by the New Component Wizard.
 *
 * Out of scope for this pass: update, delete, bulk delete, delete impact,
 * variant CRUD, preset import. Those live in the richer legacy controller
 * and will be reintroduced in a follow-up once the edit flow is back.
 */

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

const CANONICAL_KEY_RETRY_LIMIT = 20;

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
        components: components.map(serializeComponent),
      });
    } catch (error) {
      return this.handleRepositoryError(error, "Component");
    }
  }

  async createComponent(ctx: RouteContext): Promise<Response> {
    try {
      const body = (await ctx.req.json()) as ComponentRequestBody;
      const baseInput = parseCreateComponentInput(body);

      const component = await this.createWithCanonicalKeyFallback(baseInput);
      return ResponseBuilder.created({
        component: serializeComponent(component),
      });
    } catch (error) {
      return this.handleRepositoryError(error, "Component");
    }
  }

  /**
   * Publish with automatic canonicalKey disambiguation. Client-supplied keys
   * are attempted once; client omissions retry with `-2`, `-3`, … suffixes
   * on UniqueConstraintError. Caps at CANONICAL_KEY_RETRY_LIMIT.
   */
  private async createWithCanonicalKeyFallback(
    input: CreateComponentInput,
  ): Promise<ComponentWithVariants> {
    let attempt = 0;
    const baseKey = input.canonicalKey;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const candidate = attempt === 0 ? baseKey : `${baseKey}-${attempt + 1}`;
      try {
        return await this.repo.createComponent({
          ...input,
          canonicalKey: candidate,
        });
      } catch (error) {
        if (
          error instanceof UniqueConstraintError &&
          attempt < CANONICAL_KEY_RETRY_LIMIT
        ) {
          attempt += 1;
          continue;
        }
        throw error;
      }
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
      return ResponseBuilder.conflict(error.message, { resource, id });
    }

    console.error("[ComponentController] unhandled error:", error);
    return ResponseBuilder.internalError(
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

function parseCreateComponentInput(
  body: ComponentRequestBody,
): CreateComponentInput {
  const displayLabel = body.displayLabel?.trim() || "Untitled Component";
  const variants = body.variants ?? [];

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

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function serializeComponent(component: ComponentWithVariants) {
  return {
    ...component.component,
    variants: component.variants.map(serializeVariant),
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    typeof (properties as Record<string, unknown>).__openpcbCategoryPath ===
      "string"
  ) {
    return (properties as Record<string, string>).__openpcbCategoryPath;
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
