import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { CreatePageParams } from "../../../../../modules/knowledge/shared/types";
import type { PageService } from "../../../../../modules/knowledge/ts/services/page-service";
import {
  createCreatePageToolHandler,
  createPageToolSpec,
} from "../../../../../modules/knowledge/ts/tools/create-page-tool";
import { ToolCatalog } from "./tool-catalog";
import { ToolRegistry } from "./tool-registry";

type MockPage = {
  id: string;
  title: string;
  workspace_id: string;
};

type MockPageService = {
  createPage: ReturnType<typeof mock<(params: CreatePageParams) => Promise<MockPage>>>;
  updatePageContent: ReturnType<
    typeof mock<(pageId: string, content: unknown) => Promise<{ id: string; content: unknown }>>
  >;
};

function createMockPageService(): MockPageService {
  return {
    createPage: mock(async (params: CreatePageParams) => ({
      id: "page-1",
      title: params.title,
      workspace_id: params.workspace_id,
    })),
    updatePageContent: mock(async (pageId: string, content: unknown) => ({
      id: pageId,
      content,
    })),
  };
}

describe("create-page-tool", () => {
  beforeEach(() => {
    ToolCatalog.reset();
  });

  describe("ToolSpec structure", () => {
    it("createPageToolSpec has correct shape", () => {
      expect(createPageToolSpec.name).toBe("knowledge.create_page");
      expect(createPageToolSpec.scope).toBe("module");
      expect(createPageToolSpec.version).toBe("1.0");

      const schema = createPageToolSpec.inputSchema as {
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
      };

      expect(schema.type).toBe("object");
      expect(schema.properties).toHaveProperty("title");
      expect(schema.required).toEqual(expect.arrayContaining(["title"]));
    });

    it("createPageToolSpec has workspace-context guard", async () => {
      expect(createPageToolSpec.guards.length).toBeGreaterThan(0);
      const workspaceGuard = createPageToolSpec.guards.find(
        (guard) => guard.type === "workspace-context",
      );

      expect(workspaceGuard).toBeDefined();
      expect(await workspaceGuard?.validate({ workspaceId: "ws-1" })).toEqual({
        pass: true,
      });
      expect(await workspaceGuard?.validate({})).toEqual({
        pass: false,
        error: "Workspace context is required",
      });
    });
  });

  describe("ToolRegistry integration", () => {
    it("registers ToolSpec and converts to ToolDefinition", () => {
      const registry = new ToolRegistry();
      registry.register(createPageToolSpec, { execute: async () => ({ ok: true }) }, { moduleId: "knowledge" });

      expect(registry.has("knowledge.create_page")).toBe(true);
      expect(registry.get("knowledge.create_page").definition.function.name).toBe(
        "knowledge.create_page",
      );
    });

    it("namespace validation passes for matching moduleId", () => {
      const registry = new ToolRegistry();

      expect(() => {
        registry.register(
          createPageToolSpec,
          { execute: async () => ({ ok: true }) },
          { moduleId: "knowledge" },
        );
      }).not.toThrow();
    });

    it("namespace validation fails for wrong moduleId", () => {
      const registry = new ToolRegistry();

      expect(() => {
        registry.register(
          createPageToolSpec,
          { execute: async () => ({ ok: true }) },
          { moduleId: "other" },
        );
      }).toThrow(/invalid namespace/i);
    });

    it("unregister removes tool", () => {
      const registry = new ToolRegistry();
      registry.register(createPageToolSpec, { execute: async () => ({ ok: true }) }, { moduleId: "knowledge" });

      expect(registry.has("knowledge.create_page")).toBe(true);
      expect(registry.unregister("knowledge.create_page")).toBe(true);
      expect(registry.has("knowledge.create_page")).toBe(false);
    });

    it("double dispose does not throw", () => {
      const registry = new ToolRegistry();
      const dispose = registry.register(
        {
          type: "function",
          function: {
            name: "disposable.test",
            description: "test",
            parameters: { type: "object", properties: {} },
          },
        },
        { execute: async () => ({}) },
      );

      dispose();
      expect(() => dispose()).not.toThrow();
    });

    it("supports mixed ToolSpec and ToolDefinition registration", () => {
      const registry = new ToolRegistry();

      registry.register(
        {
          type: "function",
          function: {
            name: "legacy.tool",
            description: "legacy",
            parameters: { type: "object", properties: {} },
          },
        },
        { execute: async () => ({ legacy: true }) },
      );

      const spec = {
        name: "modern.tool",
        scope: "module" as const,
        version: "1.0",
        description: "modern",
        inputSchema: { type: "object", properties: {} },
        guards: [],
      };
      registry.register(spec, { execute: async () => ({ modern: true }) }, { moduleId: "modern" });

      expect(registry.get("legacy.tool")).toBeDefined();
      expect(registry.get("modern.tool")).toBeDefined();
      expect(registry.list()).toHaveLength(2);
    });
  });

  describe("handler behavior", () => {
    it("createCreatePageToolHandler returns executable handler", () => {
      const pageService = createMockPageService();

      const handler = createCreatePageToolHandler(pageService as unknown as PageService);

      expect(handler).toBeDefined();
      expect(typeof handler.execute).toBe("function");
    });

    it("throws on missing workspace_id", async () => {
      const pageService = createMockPageService();
      const handler = createCreatePageToolHandler(pageService as unknown as PageService);

      await expect(handler.execute({ title: "Test" })).rejects.toThrow("workspace_id required");
      expect(pageService.createPage).toHaveBeenCalledTimes(0);
    });

    it("throws on missing title", async () => {
      const pageService = createMockPageService();
      const handler = createCreatePageToolHandler(pageService as unknown as PageService);

      await expect(handler.execute({ workspace_id: "ws-1" })).rejects.toThrow("title required");
      expect(pageService.createPage).toHaveBeenCalledTimes(0);
    });

    it("calls pageService.createPage for valid args", async () => {
      const pageService = createMockPageService();
      const handler = createCreatePageToolHandler(pageService as unknown as PageService);

      const result = await handler.execute({
        workspace_id: "ws-1",
        title: "Test Page",
      });

      expect(pageService.createPage).toHaveBeenCalledTimes(1);
      expect(pageService.createPage).toHaveBeenCalledWith({
        workspace_id: "ws-1",
        title: "Test Page",
        project_id: undefined,
        parent_id: undefined,
        after_sibling_id: undefined,
      });
      expect(pageService.updatePageContent).toHaveBeenCalledTimes(0);
      expect(result).toEqual({
        page: {
          id: "page-1",
          title: "Test Page",
          workspace_id: "ws-1",
        },
      });
    });

    it("handles content_markdown via updatePageContent", async () => {
      const pageService = createMockPageService();
      const handler = createCreatePageToolHandler(pageService as unknown as PageService);

      const result = await handler.execute({
        workspace_id: "ws-1",
        title: "With Markdown",
        content_markdown: "# Heading\n\nBody",
      });

      expect(pageService.createPage).toHaveBeenCalledTimes(1);
      expect(pageService.updatePageContent).toHaveBeenCalledTimes(1);
      expect(pageService.updatePageContent).toHaveBeenCalledWith(
        "page-1",
        expect.objectContaining({
          engine: "tiptap",
          version: 1,
          data: expect.any(Object),
        }),
      );
      expect(result).toEqual({
        page: {
          id: "page-1",
          content: expect.any(Object),
        },
      });
    });
  });
});
