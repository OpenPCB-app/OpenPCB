import { describe, it, expect, beforeEach } from "bun:test";
import { createMockDatabaseAccess, type MockDatabaseAccess } from "../../../../../../test/helpers/mock-db";
import { createGetContextHandler, getContextToolSpec } from "../get-context";
import type { ToolHandler, ToolResult } from "@shared/types/tool.types";
import type { DatabaseAccess } from "../../../../db";

interface GetContextData {
  workspace: { id: string; name: string };
  project?: { id: string; name: string; description: string | null; status: string };
  chat?: { id: string; title: string | null };
}

describe("core.get_context", () => {
  let db: MockDatabaseAccess;
  let handler: ToolHandler;

  beforeEach(() => {
    db = createMockDatabaseAccess();
    handler = createGetContextHandler(db as unknown as DatabaseAccess);
    
    // Seed data
    db._data.workspaces.set("ws-1", { id: "ws-1", name: "Workspace 1" });
    db._data.projects.set("proj-1", { id: "proj-1", workspaceId: "ws-1", name: "Project 1", description: "Desc 1", status: "active" });
    db._data.chats.set("chat-1", { id: "chat-1", workspaceId: "ws-1", title: "Chat 1" });
  });

  describe("ToolSpec", () => {
    it("should have correct metadata", () => {
      expect(getContextToolSpec.name).toBe("core.get_context");
      expect(getContextToolSpec.scope).toBe("core");
      expect(getContextToolSpec.guards).toBeDefined();
      expect(getContextToolSpec.guards?.some(g => g.type === "workspace-context")).toBe(true);
    });
  });

  describe("handler", () => {
    it("should return workspace context", async () => {
      const result = await handler.execute({ workspace_id: "ws-1" });
      
      expect(result.success).toBe(true);
      const data = result.data as GetContextData;
      expect(data.workspace).toEqual({ id: "ws-1", name: "Workspace 1" });
      expect(data.project).toBeUndefined();
      expect(data.chat).toBeUndefined();
    });

    it("should return project context if project_id provided", async () => {
      const result = await handler.execute({ workspace_id: "ws-1", project_id: "proj-1" });
      
      expect(result.success).toBe(true);
      const data = result.data as GetContextData;
      expect(data.workspace).toEqual({ id: "ws-1", name: "Workspace 1" });
      expect(data.project).toEqual({ id: "proj-1", name: "Project 1", description: "Desc 1", status: "active" });
    });

    it("should return chat context if chat_id provided", async () => {
      const result = await handler.execute({ workspace_id: "ws-1", chat_id: "chat-1" });
      
      expect(result.success).toBe(true);
      const data = result.data as GetContextData;
      expect(data.workspace).toEqual({ id: "ws-1", name: "Workspace 1" });
      expect(data.chat).toEqual({ id: "chat-1", title: "Chat 1" });
    });

    it("should apply field filtering", async () => {
      const result = await handler.execute({ 
        workspace_id: "ws-1", 
        project_id: "proj-1",
        fields: ["name", "status"] 
      });
      
      expect(result.success).toBe(true);
      const data = result.data as Record<string, any>;
      expect(data.workspace).toEqual({ name: "Workspace 1" });
      expect(data.project).toEqual({ name: "Project 1", status: "active" });
    });

    it("should return error if workspace not found", async () => {
      const result = await handler.execute({ workspace_id: "non-existent" });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });

    it("should return error if project not found", async () => {
      const result = await handler.execute({ workspace_id: "ws-1", project_id: "non-existent" });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });

    it("should return error if chat not found", async () => {
      const result = await handler.execute({ workspace_id: "ws-1", chat_id: "non-existent" });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });

    it("should return error if project belongs to different workspace", async () => {
      db._data.workspaces.set("ws-2", { id: "ws-2", name: "Workspace 2" });
      db._data.projects.set("proj-2", { id: "proj-2", workspaceId: "ws-2", name: "Project 2", status: "active" });
      
      const result = await handler.execute({ workspace_id: "ws-1", project_id: "proj-2" });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("FORBIDDEN");
        expect(result.error.message).toContain("does not belong to workspace");
      }
    });

    it("should return error if chat belongs to different workspace", async () => {
      db._data.workspaces.set("ws-2", { id: "ws-2", name: "Workspace 2" });
      db._data.chats.set("chat-2", { id: "chat-2", workspaceId: "ws-2", title: "Chat 2" });
      
      const result = await handler.execute({ workspace_id: "ws-1", chat_id: "chat-2" });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("FORBIDDEN");
        expect(result.error.message).toContain("does not belong to workspace");
      }
    });
  });
});
