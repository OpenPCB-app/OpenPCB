import { describe, expect, it, mock } from "bun:test";
import type { RouteContext } from "../router";
import { ComponentDraftController } from "./component-draft-controller";
import type { ComponentDraftRepository } from "../../db/repositories/component-draft-repository";
import type { ComponentFamilyRepository } from "../../db/repositories/component-family-repository";
import type { IComponentValidationService } from "../../domain/services/component-validation-service";
import type { ComponentDraftPayload } from "../../core/schemas/component-semantics";

function createContext(opts: { id?: string; body?: unknown }): RouteContext {
  return {
    req: {
      url: "http://localhost/api/components/drafts",
      json: async () => opts.body,
    } as Request,
    params: {
      getOrThrow: (key: string) => {
        if (key === "id" && opts.id) return opts.id;
        throw new Error(`Missing param: ${key}`);
      },
      get: (key: string) => (key === "id" ? opts.id : undefined),
    } as RouteContext["params"],
    query: new URLSearchParams(),
    url: new URL("http://localhost/api/components/drafts"),
  };
}

function validPayload(): ComponentDraftPayload {
  return {
    displayLabel: "Resistor",
    description: "Generic resistor",
    symbolData: {
      referencePrefix: "R",
      pinDefinitions: [
        { name: "1", electricalType: "passive" },
        { name: "2", electricalType: "passive" },
      ],
      properties: {},
    },
    packageVariants: [
      {
        id: "var-1",
        familyId: "fam-1",
        canonicalCode: "0603",
        humanLabel: "0603",
        imperialAlias: null,
        metricAlias: null,
        mountType: "smd",
        dimensions: null,
        isDefault: true,
        pinRemapTable: null,
        footprintOptions: [
          {
            id: "fp-1",
            variantId: "var-1",
            label: "Nominal",
            isDefault: true,
            kicadPayload: {},
            model3dOptions: [],
            defaultModel3dOptionId: null,
          },
        ],
        defaultFootprintOptionId: "fp-1",
        offerings: [],
      },
    ],
    defaultPackageVariantId: "var-1",
  };
}

function createDraftRepo(): ComponentDraftRepository {
  const drafts: Record<string, unknown> = {};
  return {
    create: mock(async (data: Record<string, unknown>) => {
      const id = "draft-1";
      const row = {
        id,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      drafts[id] = row;
      return row;
    }),
    update: mock(async (id: string, data: Record<string, unknown>) => {
      const existing = drafts[id] ?? {
        id,
        createdAt: new Date(),
        deletedAt: null,
      };
      const updated = { ...existing, ...data, updatedAt: new Date() };
      drafts[id] = updated;
      return updated;
    }),
    findByIdOrThrow: mock(async (id: string) => {
      if (!drafts[id]) {
        // Return a default draft for publish tests
        return {
          id,
          familyId: null,
          wizardStep: 0,
          payload: validPayload(),
          warnings: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        };
      }
      return drafts[id];
    }),
    softDelete: mock(async () => {}),
  } as unknown as ComponentDraftRepository;
}

function createFamilyRepo(): ComponentFamilyRepository {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      id: "fam-new",
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    })),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      id,
      ...data,
    })),
    findLatestRevision: mock(async () => null),
    createRevision: mock(async (data: Record<string, unknown>) => ({
      id: "rev-1",
      ...data,
    })),
  } as unknown as ComponentFamilyRepository;
}

function createValidationService(
  canPublish = true,
): IComponentValidationService {
  return {
    validateForPublish: mock(() => ({
      blockers: canPublish
        ? []
        : [
            {
              code: "no_default_variant",
              message: "No default",
              entityId: null,
              entityType: "family",
            },
          ],
      warnings: [],
      canPublish,
    })),
  };
}

describe("ComponentDraftController", () => {
  it("creates a draft", async () => {
    const ctrl = new ComponentDraftController(
      createDraftRepo(),
      createFamilyRepo(),
      createValidationService(),
    );
    const res = await ctrl.create(
      createContext({
        body: {
          familyId: null,
          payload: validPayload(),
          wizardStep: 0,
          warnings: [],
        },
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.draft.id).toBe("draft-1");
  });

  it("updates a draft", async () => {
    const draftRepo = createDraftRepo();
    const ctrl = new ComponentDraftController(
      draftRepo,
      createFamilyRepo(),
      createValidationService(),
    );
    const res = await ctrl.update(
      createContext({ id: "draft-1", body: { wizardStep: 2 } }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("discards a draft", async () => {
    const draftRepo = createDraftRepo();
    const ctrl = new ComponentDraftController(
      draftRepo,
      createFamilyRepo(),
      createValidationService(),
    );
    const res = await ctrl.discard(createContext({ id: "draft-1" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.deleted).toBe(true);
    expect(draftRepo.softDelete).toHaveBeenCalled();
  });

  it("publishes draft with valid payload", async () => {
    const familyRepo = createFamilyRepo();
    const ctrl = new ComponentDraftController(
      createDraftRepo(),
      familyRepo,
      createValidationService(true),
    );
    const res = await ctrl.publish(createContext({ id: "draft-1" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.familyId).toBe("fam-new");
    expect(body.data.revision.id).toBe("rev-1");
    expect(familyRepo.createRevision).toHaveBeenCalled();
  });

  it("rejects publish without default package variant", async () => {
    const ctrl = new ComponentDraftController(
      createDraftRepo(),
      createFamilyRepo(),
      createValidationService(false),
    );
    const res = await ctrl.publish(createContext({ id: "draft-1" }));
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("patches draft with partial update (auto-save)", async () => {
    const draftRepo = createDraftRepo();
    // Seed a draft with initial payload
    await draftRepo.update("draft-1", {
      payload: { displayLabel: "Original", description: "Old" },
    });

    const ctrl = new ComponentDraftController(
      draftRepo,
      createFamilyRepo(),
      createValidationService(),
    );

    const res = await ctrl.patch(
      createContext({
        id: "draft-1",
        body: { payload: { displayLabel: "Updated" } },
      }),
    );

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.draft.payload.displayLabel).toBe("Updated");
    expect(body.data.draft.payload.description).toBe("Old"); // Preserved
  });

  it("validates draft and returns blockers/warnings", async () => {
    const ctrl = new ComponentDraftController(
      createDraftRepo(),
      createFamilyRepo(),
      createValidationService(false),
    );

    const res = await ctrl.validate(createContext({ id: "draft-1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.canPublish).toBe(false);
    expect(body.data.blockers).toHaveLength(1);
    expect(body.data.warnings).toHaveLength(0);
  });
});
