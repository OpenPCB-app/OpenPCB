import type { RouteContext } from "../router";
import type { ComponentFamilyRepository } from "../../db/repositories/component-family-repository";
import { ResponseBuilder } from "../../core/utils/response-builder";

export class ComponentFamilyController {
  constructor(private repo: ComponentFamilyRepository) {}

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
    const family = await this.repo.findByIdOrThrow(id);
    const variants = await this.repo.findVariantsByFamily(id);
    return ResponseBuilder.success({ family: { ...family, variants } });
  }

  async getFull(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const aggregate = await this.repo.findByIdWithRelations(id);
    return ResponseBuilder.success(aggregate);
  }

  async getCategories(ctx: RouteContext): Promise<Response> {
    const families = await this.repo.findActive();
    
    // Build category tree from categoryPath values
    const categoryMap = new Map<string, { path: string; label: string; count: number }>();
    
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
