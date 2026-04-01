import { describe, expect, it, mock } from "bun:test";
import type { RouteContext } from "../router";
import { ComponentFamilyController } from "./component-family-controller";
import type { ComponentFamilyRepository } from "../../db/repositories/component-family-repository";

function createContext(opts: {
  id?: string;
  query?: Record<string, string>;
}): RouteContext {
  const query = new URLSearchParams(opts.query ?? {});
  return {
    req: { url: "http://localhost/api/components/families" } as Request,
    params: {
      getOrThrow: (key: string) => {
        if (key === "id" && opts.id) return opts.id;
        throw new Error(`Missing param: ${key}`);
      },
      get: (key: string) => (key === "id" ? opts.id : undefined),
    } as RouteContext["params"],
    query,
    url: new URL("http://localhost/api/components/families"),
  };
}

function createRepoMock(): ComponentFamilyRepository {
  const families = [
    {
      id: "fam-1",
      canonicalKey: "resistor",
      displayLabel: "Resistor",
      description: "Generic resistor",
      scope: "built_in",
      symbolData: {},
      defaultPackageVariantId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    },
    {
      id: "fam-2",
      canonicalKey: "capacitor",
      displayLabel: "Ceramic Capacitor",
      description: "MLCC",
      scope: "workspace",
      symbolData: {},
      defaultPackageVariantId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    },
  ];

  return {
    findActive: mock(async () => families),
    findByScope: mock(async (scope: string) =>
      families.filter((f) => f.scope === scope),
    ),
    search: mock(async (q: string) =>
      families.filter((f) =>
        f.displayLabel.toLowerCase().includes(q.toLowerCase()),
      ),
    ),
    findWithFilters: mock(async (filters: any) => {
      let filtered = [...families];
      if (filters.scope) {
        filtered = filtered.filter((f) => f.scope === filters.scope);
      }
      if (filters.search) {
        filtered = filtered.filter((f) =>
          f.displayLabel.toLowerCase().includes(filters.search.toLowerCase()),
        );
      }
      return filtered;
    }),
    findByIdOrThrow: mock(async (id: string) => {
      const f = families.find((f) => f.id === id);
      if (!f) throw new Error("Not found");
      return f;
    }),
    findVariantsByFamily: mock(async () => [
      { id: "var-1", familyId: "fam-1", canonicalCode: "0603" },
    ]),
    findByIdWithRelations: mock(async (id: string) => {
      const family = families.find((f) => f.id === id);
      if (!family) throw new Error("Not found");
      return {
        family,
        variants: [{ id: "var-1", familyId: id, canonicalCode: "0603" }],
        footprints: [],
        models: [],
        offerings: [],
      };
    }),
  } as unknown as ComponentFamilyRepository;
}

describe("ComponentFamilyController", () => {
  it("lists all active families", async () => {
    const repo = createRepoMock();
    const ctrl = new ComponentFamilyController(repo);
    const res = await ctrl.list(createContext({}));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.families).toHaveLength(2);
  });

  it("filters families by scope", async () => {
    const repo = createRepoMock();
    const ctrl = new ComponentFamilyController(repo);
    const res = await ctrl.list(
      createContext({ query: { scope: "built_in" } }),
    );
    const body = await res.json();
    expect(body.data.families).toHaveLength(1);
    expect(body.data.families[0].scope).toBe("built_in");
  });

  it("searches families", async () => {
    const repo = createRepoMock();
    const ctrl = new ComponentFamilyController(repo);
    const res = await ctrl.list(
      createContext({ query: { search: "ceramic" } }),
    );
    const body = await res.json();
    expect(body.data.families).toHaveLength(1);
    expect(body.data.families[0].canonicalKey).toBe("capacitor");
  });

  it("gets family by ID with variants", async () => {
    const repo = createRepoMock();
    const ctrl = new ComponentFamilyController(repo);
    const res = await ctrl.get(createContext({ id: "fam-1" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.family.id).toBe("fam-1");
    expect(body.data.family.packageVariants).toHaveLength(1);
  });

  it("deletes workspace component", async () => {
    const repo = createRepoMock();
    repo.softDelete = mock(async () => {});
    repo.findById = mock(async (id: string) => {
      const families = [
        { id: "fam-1", scope: "built_in" },
        { id: "fam-2", scope: "workspace" },
      ];
      return (families.find((f) => f.id === id) || null) as unknown as Awaited<
        ReturnType<ComponentFamilyRepository["findById"]>
      >;
    });
    const ctrl = new ComponentFamilyController(repo);
    const res = await ctrl.delete(createContext({ id: "fam-2" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.deleted).toBe(true);
  });

  it("prevents deleting built-in components", async () => {
    const repo = createRepoMock();
    repo.findById = mock(async (id: string) => {
      const families = [
        { id: "fam-1", scope: "built_in" },
        { id: "fam-2", scope: "workspace" },
      ];
      return (families.find((f) => f.id === id) || null) as unknown as Awaited<
        ReturnType<ComponentFamilyRepository["findById"]>
      >;
    });
    const ctrl = new ComponentFamilyController(repo);
    const res = await ctrl.delete(createContext({ id: "fam-1" }));
    expect(res.status).toBe(403);
  });

  it("updates workspace component", async () => {
    const repo = createRepoMock();
    repo.findById = mock(
      async (id: string) =>
        ({
          id,
          scope: "workspace",
          displayLabel: "Old Name",
        }) as unknown as Awaited<
          ReturnType<ComponentFamilyRepository["findById"]>
        >,
    );
    repo.update = mock(
      async (id: string, data: unknown) =>
        ({
          id,
          ...data,
        }) as Awaited<ReturnType<ComponentFamilyRepository["update"]>>,
    );
    const ctrl = new ComponentFamilyController(repo);
    const res = await ctrl.update(
      createMockContextWithBody({ id: "fam-2" }, { displayLabel: "New Name" }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.family.displayLabel).toBe("New Name");
  });

  it("bulk deletes workspace components", async () => {
    const repo = createRepoMock();
    repo.softDelete = mock(async () => {});
    repo.findById = mock(async (id: string) => {
      const families = [
        { id: "fam-1", scope: "built_in" },
        { id: "fam-2", scope: "workspace" },
      ];
      return (families.find((f) => f.id === id) || null) as unknown as Awaited<
        ReturnType<ComponentFamilyRepository["findById"]>
      >;
    });
    const ctrl = new ComponentFamilyController(repo);
    const res = await ctrl.bulkDelete(
      createMockContextWithBody({}, { ids: ["fam-1", "fam-2"] }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.deletedCount).toBe(1);
    expect(body.data.skippedCount).toBe(1);
  });
});

function createMockContextWithBody(
  opts: { id?: string; query?: Record<string, string> },
  body: unknown,
): RouteContext {
  const query = new URLSearchParams(opts.query ?? {});
  return {
    req: {
      url: "http://localhost/api/components/families",
      json: async () => body,
    } as Request,
    params: {
      getOrThrow: (key: string) => {
        if (key === "id" && opts.id) return opts.id;
        throw new Error(`Missing param: ${key}`);
      },
      get: (key: string) => (key === "id" ? opts.id : undefined),
    } as RouteContext["params"],
    query,
    url: new URL("http://localhost/api/components/families"),
  };
}
