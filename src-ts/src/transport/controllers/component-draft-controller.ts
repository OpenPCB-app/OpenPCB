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
      const family = await this.familyRepo.create({
        canonicalKey: payload.displayLabel.toLowerCase().replace(/\s+/g, "_"),
        displayLabel: payload.displayLabel,
        description: payload.description,
        scope: "workspace",
        symbolData: payload.symbolData as unknown as Record<string, unknown>,
        defaultPackageVariantId: payload.defaultPackageVariantId,
      });
      familyId = family.id;
    } else {
      await this.familyRepo.update(familyId, {
        displayLabel: payload.displayLabel,
        description: payload.description,
        symbolData: payload.symbolData as unknown as Record<string, unknown>,
        defaultPackageVariantId: payload.defaultPackageVariantId,
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
