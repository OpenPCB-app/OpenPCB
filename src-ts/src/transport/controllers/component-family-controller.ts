import type { RouteContext } from "../router";
import type { ComponentFamilyRepository } from "../../db/repositories/component-family-repository";
import { ResponseBuilder } from "../../core/utils/response-builder";

export class ComponentFamilyController {
  constructor(private repo: ComponentFamilyRepository) {}

  async delete(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");

    const family = await this.repo.findById(id);
    if (!family) {
      return ResponseBuilder.notFound("Component family");
    }

    if (family.scope !== "workspace") {
      return ResponseBuilder.error(
        "CANNOT_DELETE_BUILT_IN",
        "Built-in components cannot be deleted",
        403,
      );
    }

    await this.repo.softDelete(id);
    return ResponseBuilder.success({ deleted: true });
  }

  async bulkDelete(ctx: RouteContext): Promise<Response> {
    const body = (await ctx.req.json()) as { ids: string[] };
    const ids = body?.ids ?? [];

    if (ids.length === 0) {
      return ResponseBuilder.error("NO_IDS", "No component IDs provided", 400);
    }

    const deletableIds: string[] = [];
    let skippedBuiltInCount = 0;
    let skippedNotFoundCount = 0;

    for (const id of ids) {
      const family = await this.repo.findById(id);
      if (!family) {
        skippedNotFoundCount++;
        continue;
      }

      if (family.scope === "workspace") {
        deletableIds.push(id);
        continue;
      }

      skippedBuiltInCount++;
    }

    for (const id of deletableIds) {
      await this.repo.softDelete(id);
    }

    return ResponseBuilder.success({
      deleted: true,
      deletedCount: deletableIds.length,
      skippedCount: ids.length - deletableIds.length,
      skippedBuiltInCount,
      skippedNotFoundCount,
    });
  }

  async update(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const body = (await ctx.req.json()) as {
      displayLabel?: string;
      description?: string;
      categoryPath?: string;
      tags?: string[];
    };

    const family = await this.repo.findById(id);
    if (!family) {
      return ResponseBuilder.notFound("Component family");
    }

    if (family.scope !== "workspace") {
      return ResponseBuilder.error(
        "CANNOT_EDIT_BUILT_IN",
        "Built-in components cannot be edited",
        403,
      );
    }

    const updateData: Record<string, unknown> = {};
    if (body.displayLabel !== undefined)
      updateData.displayLabel = body.displayLabel;
    if (body.description !== undefined)
      updateData.description = body.description;
    if (body.categoryPath !== undefined)
      updateData.categoryPath = body.categoryPath;
    if (body.tags !== undefined) updateData.tags = body.tags;

    const updated = await this.repo.update(id, updateData);
    return ResponseBuilder.success({ family: updated });
  }

  async list(ctx: RouteContext): Promise<Response> {
    const scope = ctx.query.get("scope") ?? undefined;
    const categoryPath = ctx.query.get("categoryPath") ?? undefined;
    const tagsParam = ctx.query.get("tags");
    const tags = tagsParam ? tagsParam.split(",") : undefined;
    const mountType = ctx.query.get("mountType") ?? undefined;
    const search = ctx.query.get("search") ?? undefined;

    // Use new filtered query if any filters are present
    if (scope || categoryPath || tags || mountType || search) {
      const families = await this.repo.findWithFilters({
        scope,
        categoryPath,
        tags,
        mountType,
        search,
      });
      return ResponseBuilder.success({ families });
    }

    // Default: return all active families
    const families = await this.repo.findActive();
    return ResponseBuilder.success({ families });
  }

  async get(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const { family, variants, footprints, models, offerings } =
      await this.repo.findByIdWithRelations(id);

    // Nest footprints, models, and offerings into variants
    const packageVariants = variants.map((v) => ({
      ...v,
      footprintOptions: footprints
        .filter((fp) => fp.variantId === v.id)
        .map((fp) => ({
          ...fp,
          model3dOptions: models.filter((m) => m.footprintOptionId === fp.id),
        })),
      offerings: offerings.filter((o) => o.variantId === v.id),
    }));

    return ResponseBuilder.success({
      family: { ...family, packageVariants },
    });
  }

  async getFull(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const aggregate = await this.repo.findByIdWithRelations(id);
    return ResponseBuilder.success(aggregate);
  }

  async getCategories(ctx: RouteContext): Promise<Response> {
    const families = await this.repo.findActive();

    // Build category tree from categoryPath values
    const categoryMap = new Map<
      string,
      { path: string; label: string; count: number }
    >();

    for (const family of families) {
      const path = family.categoryPath;
      if (!path) continue;

      // Count each path segment
      const parts = path.split("/");
      let currentPath = "";
      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const existing = categoryMap.get(currentPath);
        if (existing) {
          existing.count++;
        } else {
          categoryMap.set(currentPath, {
            path: currentPath,
            label: part,
            count: 1,
          });
        }
      }
    }

    // Convert to tree structure
    const categories = buildCategoryTree(Array.from(categoryMap.values()));

    return ResponseBuilder.success({ categories });
  }
}

interface CategoryNode {
  path: string;
  label: string;
  count: number;
  children: CategoryNode[];
}

function buildCategoryTree(
  items: Array<{ path: string; label: string; count: number }>,
): CategoryNode[] {
  const root: CategoryNode[] = [];
  const nodeMap = new Map<string, CategoryNode>();

  // Sort by path to ensure parents come before children
  items.sort((a, b) => a.path.localeCompare(b.path));

  for (const item of items) {
    const node: CategoryNode = {
      path: item.path,
      label: item.label,
      count: item.count,
      children: [],
    };
    nodeMap.set(item.path, node);

    // Find parent
    const parts = item.path.split("/");
    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = nodeMap.get(parentPath);
      if (parent) {
        parent.children.push(node);
      }
    }
  }

  return root;
}
