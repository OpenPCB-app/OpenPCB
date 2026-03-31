import { describe, it, expect, beforeEach } from "bun:test";
import { ToolRegistry } from "../../tool-registry";
import { ToolCatalog } from "../../tool-catalog";
import * as coreTools from "../index";
import type { ToolHandler } from "@shared/types/tool.types";

describe("Core Tools Registration", () => {
  let registry: ToolRegistry;
  const noopHandler: ToolHandler = {
    execute: async () => ({ success: true }),
  };

  beforeEach(() => {
    ToolCatalog.getInstance().clear();
    registry = new ToolRegistry();
  });

  const expectedTools = [
    { name: "core.get_context", spec: coreTools.getContextToolSpec },
    { name: "core.list_chats", spec: coreTools.listChatsToolSpec },
    { name: "core.list_projects", spec: coreTools.listProjectsToolSpec },
    { name: "core.get_project", spec: coreTools.getProjectToolSpec },
    { name: "core.list_files", spec: coreTools.listFilesToolSpec },
    { name: "core.list_bookmarks", spec: coreTools.listBookmarksSpec },
    { name: "core.list_favorites", spec: coreTools.listFavoritesSpec },
    { name: "core.search", spec: coreTools.searchToolSpec },
  ];

  it("should register all 8 core tools", () => {
    for (const { spec } of expectedTools) {
      registry.register(spec, noopHandler);
    }

    for (const { name } of expectedTools) {
      expect(registry.has(name)).toBe(true);
    }
  });

  it("should have core scope for all tools", () => {
    for (const { spec } of expectedTools) {
      registry.register(spec, noopHandler);
    }

    for (const { name } of expectedTools) {
      const tool = registry.get(name);
      expect(tool.spec?.scope).toBe("core");
    }
  });

  it("should have workspace context guard for all tools", () => {
    for (const { spec } of expectedTools) {
      registry.register(spec, noopHandler);
    }

    for (const { name } of expectedTools) {
      const tool = registry.get(name);
      const hasWorkspaceGuard = tool.spec?.guards?.some(
        (g) => g.type === "workspace-context"
      );
      expect(hasWorkspaceGuard).toBe(true);
    }
  });
});
