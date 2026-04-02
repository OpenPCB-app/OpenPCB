import { describe, expect, it, mock } from "bun:test";
import type { RouteContext } from "../router";
import { DbConflictError } from "../../db/errors";
import type { ComponentRepository } from "../../db/repositories/component-repository";
import { ComponentController } from "./component-controller";

function createContext(opts: {
  id?: string;
  variantId?: string;
  body?: unknown;
  query?: Record<string, string>;
}): RouteContext {
  const query = new URLSearchParams(opts.query ?? {});

  return {
    req: {
      url: "http://localhost/api/components",
      json: async () => opts.body,
    } as Request,
    params: {
      getOrThrow: (key: string) => {
        if (key === "id" && opts.id) return opts.id;
        if (key === "variantId" && opts.variantId) return opts.variantId;
        throw new Error(`Missing param: ${key}`);
      },
      get: (key: string) => {
        if (key === "id") return opts.id;
        if (key === "variantId") return opts.variantId;
        return undefined;
      },
    } as RouteContext["params"],
    query,
    url: new URL(`http://localhost/api/components${query.toString() ? `?${query}` : ""}`),
  };
}

function createAggregate(overrides?: {
  component?: Record<string, unknown>;
  variants?: Array<Record<string, unknown>>;
}) {
  return {
    component: {
      id: "component-1",
      canonicalKey: "resistor",
      displayLabel: "Resistor",
      description: "Generic resistor",
      scope: "workspace",
      symbolData: { referencePrefix: "R", pinDefinitions: [], properties: {} },
      defaultVariantId: "variant-1",
      categoryPath: "passives/resistors",
      tags: ["passive"],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides?.component,
    },
    variants: [
      {
        id: "variant-1",
        componentId: "component-1",
        canonicalCode: "0603",
        humanLabel: "0603",
        imperialAlias: null,
        metricAlias: null,
        mountType: "smd",
        dimensions: null,
        isDefault: true,
        pinRemapTable: null,
        footprintPayload: { name: "R_0603" },
        defaultFootprintId: "footprint-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      ...(overrides?.variants ?? []),
    ],
  };
}

function createRepoMock(): ComponentRepository {
  const aggregate = createAggregate();
  const secondVariant = {
    id: "variant-2",
    componentId: "component-1",
    canonicalCode: "0805",
    humanLabel: "0805",
    imperialAlias: null,
    metricAlias: null,
    mountType: "smd",
    dimensions: null,
    isDefault: false,
    pinRemapTable: null,
    footprintPayload: { name: "R_0805" },
    defaultFootprintId: "footprint-2",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    listComponents: mock(async () => [aggregate]),
    getComponent: mock(async (id: string) => (id === "component-1" ? aggregate : null)),
    createComponent: mock(async () => aggregate),
    updateComponent: mock(async (_id: string, input: Record<string, unknown>) =>
      createAggregate({ component: input }),
    ),
    deleteComponent: mock(async (id: string) => {
      void id;
    }),
    getDeleteImpact: mock(async (id: string) => {
      if (id === "component-used") {
        return {
          usageCount: 2,
          designNames: ["Design A", "Design B"],
        };
      }

      return {
        usageCount: 0,
        designNames: [],
      };
    }),
    setDefaultVariant: mock(async (_id: string, variantId: string) =>
      createAggregate({ component: { defaultVariantId: variantId } }),
    ),
    variants: {
      addVariant: mock(async () => secondVariant),
      updateVariant: mock(async (variantId: string, input: Record<string, unknown>) => ({
        ...secondVariant,
        id: variantId,
        ...input,
      })),
      removeVariant: mock(async (variantId: string) => {
        if (variantId === "variant-only") {
          throw new DbConflictError("Cannot remove the only variant of a component");
        }
      }),
    },
  } as unknown as ComponentRepository;
}

describe("ComponentController", () => {
  it("lists workspace components with v1 filters", async () => {
    const repo = createRepoMock();
    const ctrl = new ComponentController(repo);
    const res = await ctrl.listComponents(createContext({ query: { search: "Resistor" } }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.components).toHaveLength(1);
    expect(body.data.components[0].variants).toHaveLength(1);
    expect(repo.listComponents).toHaveBeenCalledWith({
      search: "Resistor",
      categoryPath: undefined,
      mountType: undefined,
      tags: undefined,
    });
  });

  it("gets component with variants", async () => {
    const ctrl = new ComponentController(createRepoMock());
    const res = await ctrl.getComponent(createContext({ id: "component-1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.component.id).toBe("component-1");
    expect(body.data.component.defaultVariantId).toBe("variant-1");
  });

  it("creates component", async () => {
    const repo = createRepoMock();
    const ctrl = new ComponentController(repo);
    const res = await ctrl.createComponent(
      createContext({
        body: {
          displayLabel: "Resistor",
          symbolData: { referencePrefix: "R", pinDefinitions: [], properties: {} },
          variants: [
            {
              canonicalCode: "0603",
              humanLabel: "0603",
              mountType: "smd",
              isDefault: true,
              footprintOptions: [{ id: "footprint-1", isDefault: true, kicadPayload: {} }],
            },
          ],
        },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.component.displayLabel).toBe("Resistor");
    expect(repo.createComponent).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalKey: "resistor",
        displayLabel: "Resistor",
        variants: [
          expect.objectContaining({
            canonicalCode: "0603",
            humanLabel: "0603",
            mountType: "smd",
            isDefault: true,
            defaultFootprintId: "footprint-1",
            footprintPayload: {},
          }),
        ],
      }),
    );
  });

  it("updates component metadata", async () => {
    const repo = createRepoMock();
    const ctrl = new ComponentController(repo);
    const res = await ctrl.updateComponent(
      createContext({
        id: "component-1",
        body: {
          displayLabel: "Updated Resistor",
          defaultVariantId: "variant-2",
        },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.component.displayLabel).toBe("Updated Resistor");
    expect(repo.updateComponent).toHaveBeenCalledWith("component-1", {
      displayLabel: "Updated Resistor",
      defaultVariantId: "variant-2",
    });
  });

  it("deletes an unused component", async () => {
    const repo = createRepoMock();
    const ctrl = new ComponentController(repo);
    const res = await ctrl.deleteComponent(createContext({ id: "component-1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.deleted).toBe(true);
    expect(repo.deleteComponent).toHaveBeenCalledWith("component-1");
  });

  it("returns conflict when deleting used component", async () => {
    const repo = createRepoMock();
    const ctrl = new ComponentController(repo);
    const res = await ctrl.deleteComponent(createContext({ id: "component-used" }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
    expect(repo.deleteComponent).not.toHaveBeenCalled();
  });

  it("deletes used component when force=true", async () => {
    const repo = createRepoMock();
    const ctrl = new ComponentController(repo);
    const res = await ctrl.deleteComponent(
      createContext({ id: "component-used", query: { force: "true" } }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.usageCount).toBe(2);
    expect(repo.deleteComponent).toHaveBeenCalledWith("component-used");
  });

  it("adds variant", async () => {
    const repo = createRepoMock();
    const ctrl = new ComponentController(repo);
    const res = await ctrl.addVariant(
      createContext({
        id: "component-1",
        body: {
          canonicalCode: "0805",
          humanLabel: "0805",
          mountType: "smd",
          footprintOptions: [{ id: "footprint-2", isDefault: true, kicadPayload: {} }],
        },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.variant.id).toBe("variant-2");
    expect(repo.variants.addVariant).toHaveBeenCalledWith(
      "component-1",
      expect.objectContaining({
        canonicalCode: "0805",
        humanLabel: "0805",
        mountType: "smd",
        defaultFootprintId: "footprint-2",
        footprintPayload: {},
      }),
    );
  });

  it("updates variant", async () => {
    const repo = createRepoMock();
    const ctrl = new ComponentController(repo);
    const res = await ctrl.updateVariant(
      createContext({
        id: "component-1",
        variantId: "variant-1",
        body: { humanLabel: "0603 metric", isDefault: true },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.variant.humanLabel).toBe("0603 metric");
    expect(repo.variants.updateVariant).toHaveBeenCalledWith("variant-1", {
      humanLabel: "0603 metric",
      isDefault: true,
    });
  });

  it("removes a non-final variant", async () => {
    const repo = createRepoMock();
    const ctrl = new ComponentController(repo);
    const res = await ctrl.removeVariant(
      createContext({ id: "component-1", variantId: "variant-1" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.deleted).toBe(true);
    expect(repo.variants.removeVariant).toHaveBeenCalledWith("variant-1");
  });

  it("blocks removing the final variant", async () => {
    const repo = createRepoMock();
    repo.getComponent = mock(async (id: string) =>
      id === "component-1"
        ? createAggregate({
            variants: [
              {
                id: "variant-only",
                componentId: "component-1",
                canonicalCode: "0603",
                humanLabel: "0603",
                imperialAlias: null,
                metricAlias: null,
                mountType: "smd",
                dimensions: null,
                isDefault: true,
                pinRemapTable: null,
                footprintPayload: {},
                defaultFootprintId: null,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          })
        : null,
    ) as ComponentRepository["getComponent"];

    const ctrl = new ComponentController(repo);
    const res = await ctrl.removeVariant(
      createContext({ id: "component-1", variantId: "variant-only" }),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
  });

  it("sets default variant", async () => {
    const ctrl = new ComponentController(createRepoMock());
    const res = await ctrl.setDefaultVariant(
      createContext({ id: "component-1", body: { variantId: "variant-2" } }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.component.defaultVariantId).toBe("variant-2");
  });
});
