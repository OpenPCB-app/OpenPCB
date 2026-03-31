import { describe, test, expect } from "bun:test";
import {
  createSearchPagesToolHandler,
  searchPagesToolSpec,
} from "./search-pages-tool";

function makeSearchService(
  overrides: Partial<{
    searchByTitle: (
      wsId: string,
      query: string,
      scope: string,
      limit: number,
    ) => Promise<unknown[]>;
    isAncestor: (ancestorId: string, nodeId: string) => Promise<boolean>;
  }> = {},
) {
  return {
    searchByTitle:
      overrides.searchByTitle ??
      (async () => [
        {
          id: "page-1",
          title: "Getting Started",
          icon: "🚀",
          breadcrumb: ["Root", "Getting Started"],
          updated_at: new Date("2026-02-18T10:00:00.000Z"),
        },
        {
          id: "page-2",
          title: "API Guide",
          icon: null,
          breadcrumb: ["Root", "Docs", "API Guide"],
          updated_at: new Date("2026-02-17T08:00:00.000Z"),
        },
      ]),
    getScopeRepository: () => ({
      isAncestor:
        overrides.isAncestor ??
        (async (ancestorId: string, nodeId: string) =>
          ancestorId === "page-1" && nodeId === "page-2"),
    }),
  } as any;
}

function makeContext(workspaceId = "ws-1") {
  return {
    taskId: "task-1",
    activeContext: {
      workspaceId,
      activeTarget: {
        targetType: "knowledge.page",
        targetId: "page-1",
      },
    },
  };
}

describe("knowledge.search_pages tool", () => {
  test("registers as a module-scoped knowledge tool", () => {
    expect(searchPagesToolSpec.name).toBe("knowledge.search_pages");
    expect(searchPagesToolSpec.scope).toBe("module");
    expect(searchPagesToolSpec.version).toBe("1.0");
  });

  test("returns scope-filtered results with breadcrumbs", async () => {
    const handler = createSearchPagesToolHandler(makeSearchService());

    const result = (await handler.execute(
      { query: "getting started" },
      makeContext(),
    )) as {
      success: boolean;
      results: Array<{ id: string; title: string; breadcrumb: string[] }>;
      count: number;
      query: string;
    };

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.query).toBe("getting started");
    expect(result.results[0]).toMatchObject({
      id: "page-1",
      title: "Getting Started",
      icon: "🚀",
      breadcrumb: ["Root", "Getting Started"],
    });
    expect(result.results[1]).toMatchObject({
      id: "page-2",
      title: "API Guide",
      icon: null,
    });
  });

  test("filters out pages outside active scope", async () => {
    const handler = createSearchPagesToolHandler(
      makeSearchService({
        searchByTitle: async () => [
          {
            id: "outside-page",
            title: "Outside",
            icon: null,
            breadcrumb: ["Outside"],
            updated_at: new Date("2026-02-17T08:00:00.000Z"),
          },
        ],
        isAncestor: async () => false,
      }),
    );

    const result = (await handler.execute(
      { query: "outside" },
      makeContext(),
    )) as { success: boolean; count: number; results: unknown[] };

    expect(result.success).toBe(true);
    expect(result.count).toBe(0);
    expect(result.results).toEqual([]);
  });

  test("allows exact mentioned page outside subtree", async () => {
    const handler = createSearchPagesToolHandler(
      makeSearchService({
        searchByTitle: async () => [
          {
            id: "outside-page",
            title: "Outside",
            icon: null,
            breadcrumb: ["Outside"],
            updated_at: new Date("2026-02-17T08:00:00.000Z"),
          },
        ],
        isAncestor: async () => false,
      }),
    );

    const result = (await handler.execute(
      { query: "outside" },
      {
        ...makeContext(),
        activeContext: {
          ...makeContext().activeContext,
          knowledgeScope: {
            rootPageId: "page-1",
            mentionedPageIds: ["outside-page"],
            grantMode: "exact",
            grantLifetime: "turn",
          },
        },
      },
    )) as { success: boolean; count: number; results: Array<{ id: string }> };

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.results[0]?.id).toBe("outside-page");
  });

  test("rejects missing workspace", async () => {
    const handler = createSearchPagesToolHandler(makeSearchService());

    const result = (await handler.execute(
      { query: "test" },
      { taskId: "t", activeContext: {} },
    )) as { success: boolean; error: { code: string } };

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("MISSING_WORKSPACE");
  });

  test("rejects query shorter than 2 chars", async () => {
    const handler = createSearchPagesToolHandler(makeSearchService());

    const result = (await handler.execute(
      { query: "a" },
      makeContext(),
    )) as { success: boolean; error: { code: string } };

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("INVALID_QUERY");
  });

  test("rejects missing query", async () => {
    const handler = createSearchPagesToolHandler(makeSearchService());

    const result = (await handler.execute(
      {},
      makeContext(),
    )) as { success: boolean; error: { code: string } };

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("INVALID_QUERY");
  });

  test("respects limit parameter", async () => {
    let capturedLimit = 0;
    const handler = createSearchPagesToolHandler(
      makeSearchService({
        searchByTitle: async (_wsId, _query, _scope, limit) => {
          capturedLimit = limit;
          return [];
        },
      }),
    );

    await handler.execute({ query: "test", limit: 5 }, makeContext());

    expect(capturedLimit).toBe(5);
  });

  test("clamps limit to max 50", async () => {
    let capturedLimit = 0;
    const handler = createSearchPagesToolHandler(
      makeSearchService({
        searchByTitle: async (_wsId, _query, _scope, limit) => {
          capturedLimit = limit;
          return [];
        },
      }),
    );

    await handler.execute({ query: "test", limit: 100 }, makeContext());

    expect(capturedLimit).toBe(50);
  });

  test("uses default limit of 10", async () => {
    let capturedLimit = 0;
    const handler = createSearchPagesToolHandler(
      makeSearchService({
        searchByTitle: async (_wsId, _query, _scope, limit) => {
          capturedLimit = limit;
          return [];
        },
      }),
    );

    await handler.execute({ query: "test" }, makeContext());

    expect(capturedLimit).toBe(10);
  });

  test("returns empty results gracefully", async () => {
    const handler = createSearchPagesToolHandler(
      makeSearchService({
        searchByTitle: async () => [],
      }),
    );

    const result = (await handler.execute(
      { query: "nonexistent" },
      makeContext(),
    )) as { success: boolean; results: unknown[]; count: number };

    expect(result.success).toBe(true);
    expect(result.count).toBe(0);
    expect(result.results).toEqual([]);
  });

  test("handles search service errors", async () => {
    const handler = createSearchPagesToolHandler(
      makeSearchService({
        searchByTitle: async () => {
          throw new Error("DB connection lost");
        },
      }),
    );

    const result = (await handler.execute(
      { query: "test query" },
      makeContext(),
    )) as { success: boolean; error: { code: string; message: string } };

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("SEARCH_FAILED");
    expect(result.error.message).toBe("DB connection lost");
  });
});
