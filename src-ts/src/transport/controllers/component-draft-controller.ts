import type { RouteContext } from "../router";
import type { ComponentDraftRepository } from "../../db/repositories/component-draft-repository";
import type { ComponentFamilyRepository } from "../../db/repositories/component-family-repository";
import type { IComponentValidationService } from "../../domain/services/component-validation-service";
import type { ComponentDraftPayload } from "../../core/schemas/component-semantics";
import { ResponseBuilder } from "../../core/utils/response-builder";

export class ComponentDraftController {
  constructor(
    private draftRepo: ComponentDraftRepository,
    private familyRepo: ComponentFamilyRepository,
    private validationService: IComponentValidationService,
  ) {}

  async list(_ctx: RouteContext): Promise<Response> {
    const drafts = await this.draftRepo.findActive();
    return ResponseBuilder.success({ drafts });
  }

  async create(ctx: RouteContext): Promise<Response> {
    const body = await ctx.req.json();
    const draft = await this.draftRepo.create(body);
    return ResponseBuilder.created({ draft });
  }

  async update(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const body = await ctx.req.json();
    const draft = await this.draftRepo.update(id, body);
    return ResponseBuilder.success({ draft });
  }

  async patch(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const body = await ctx.req.json();

    // Partial update for auto-save - only update provided fields
    // Supports debounced saves from UI
    const existing = await this.draftRepo.findByIdOrThrow(id);

    const updates: any = {};
    if (body.familyId !== undefined) updates.familyId = body.familyId;
    if (body.payload !== undefined) {
      // Merge payload if it's a partial update
      updates.payload =
        typeof body.payload === "object"
          ? { ...(existing.payload as object), ...body.payload }
          : body.payload;
    }

    const draft = await this.draftRepo.update(id, updates);
    return ResponseBuilder.success({ draft });
  }

  async validate(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const draft = await this.draftRepo.findByIdOrThrow(id);
    const payload = draft.payload as unknown as ComponentDraftPayload;

    const result = this.validationService.validateForPublish(payload);
    return ResponseBuilder.success(result);
  }

  async discard(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    await this.draftRepo.softDelete(id);
    return ResponseBuilder.success({ deleted: true });
  }

  async publish(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const draft = await this.draftRepo.findByIdOrThrow(id);
    const payload = draft.payload as unknown as ComponentDraftPayload;

    const result = this.validationService.validateForPublish(payload);
    if (!result.canPublish) {
      return ResponseBuilder.error(
        "VALIDATION_FAILED",
        "Draft has validation blockers",
        422,
        result,
      );
    }

    // Determine family ID: existing or create new
    let familyId = draft.familyId;
    if (!familyId) {
      const { family, variants } = await this.familyRepo.createFamilyWithHierarchy({
        family: {
          canonicalKey: payload.displayLabel.toLowerCase().replace(/\s+/g, "_"),
          displayLabel: payload.displayLabel,
          description: payload.description,
          scope: "workspace",
          symbolData: payload.symbolData as unknown as Record<string, unknown>,
          defaultPackageVariantId: payload.defaultPackageVariantId,
          categoryPath:
            typeof payload.symbolData.properties.__openpcbCategoryPath === "string"
              ? payload.symbolData.properties.__openpcbCategoryPath
              : null,
          tags: [],
        },
        variants: payload.packageVariants.map((variant) => ({
          variant: {
            canonicalCode: variant.canonicalCode,
            humanLabel: variant.humanLabel,
            imperialAlias: variant.imperialAlias,
            metricAlias: variant.metricAlias,
            mountType: variant.mountType,
            dimensions: variant.dimensions,
            isDefault: variant.isDefault,
            pinRemapTable: variant.pinRemapTable,
            defaultFootprintOptionId: variant.defaultFootprintOptionId,
            deletedAt: null,
          },
          footprints: variant.footprintOptions.map((footprint) => ({
            footprint: {
              label: footprint.label,
              isDefault: footprint.isDefault,
              kicadPayload: footprint.kicadPayload as Record<string, unknown>,
              densityLevel: footprint.densityLevel ?? null,
              ipcName: footprint.ipcName ?? null,
              defaultModel3dOptionId: footprint.defaultModel3dOptionId,
              deletedAt: null,
            },
            models: footprint.model3dOptions.map((model) => ({
              fileName: model.fileName,
              stepAssetPath: model.stepAssetPath,
              gltfPreviewPath: model.gltfPreviewPath,
              isDefault: model.isDefault,
              linkStatus: model.linkStatus,
            })),
          })),
        })),
      });

      for (let i = 0; i < payload.packageVariants.length; i++) {
        const variant = payload.packageVariants[i];
        const createdVariant = variants[i];
        if (!variant || !createdVariant) continue;

        for (const offering of variant.offerings) {
          await this.familyRepo.createOffering({
            variantId: createdVariant.id,
            mpn: offering.mpn,
            manufacturer: offering.manufacturer,
            datasheetUrl: offering.datasheetUrl,
          });
        }
      }

      familyId = family.id;
    } else {
      await this.familyRepo.update(familyId, {
        displayLabel: payload.displayLabel,
        description: payload.description,
        symbolData: payload.symbolData as unknown as Record<string, unknown>,
        defaultPackageVariantId: payload.defaultPackageVariantId,
        categoryPath:
          typeof payload.symbolData.properties.__openpcbCategoryPath === "string"
            ? payload.symbolData.properties.__openpcbCategoryPath
            : null,
      });
    }

    // Create revision
    const latestRevision = await this.familyRepo.findLatestRevision(familyId);
    const revisionNumber = latestRevision
      ? latestRevision.revisionNumber + 1
      : 1;

    const revision = await this.familyRepo.createRevision({
      familyId,
      revisionNumber,
      snapshot: payload as unknown as Record<string, unknown>,
      publishedAt: new Date().toISOString(),
    });

    // Soft-delete the draft after publish
    await this.draftRepo.softDelete(id);

    return ResponseBuilder.success({ familyId, revision });
  }
}
