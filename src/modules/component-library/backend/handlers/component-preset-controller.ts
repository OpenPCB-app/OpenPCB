import type { RouteContext } from "../router";
import type { PresetCatalogRepository } from "../../db/repositories/preset-catalog-repository";
import { ResponseBuilder } from "../../core/utils/response-builder";

export class ComponentPresetController {
  constructor(private repo: PresetCatalogRepository) {}

  async list(ctx: RouteContext): Promise<Response> {
    const scope = ctx.query.get("scope");

    let presets;
    if (scope) {
      presets = await this.repo.findByScope(scope);
    } else {
      presets = await this.repo.findMany();
    }

    // Attach variants to each preset
    const presetsWithVariants = await Promise.all(
      presets.map(async (preset) => {
        const variants = await this.repo.findVariantsByCatalog(preset.id);
        return { ...preset, variants };
      }),
    );

    return ResponseBuilder.success({ presets: presetsWithVariants });
  }

  async duplicate(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const body = await ctx.req.json();
    const name = body.name ?? "Copy";
    const catalog = await this.repo.duplicateToWorkspace(id, name);
    return ResponseBuilder.created({ catalog });
  }
}
