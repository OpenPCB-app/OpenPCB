import { describe, it, expect, beforeEach } from "bun:test";
import { createMockDatabaseAccess, type MockDatabaseAccess } from "../../../../../../test/helpers/mock-db";
import { createListChatsHandler, listChatsToolSpec } from "../list-chats";
import type { ToolHandler } from "@shared/types/tool.types";
import type { DatabaseAccess } from "../../../../db";

describe("core.list_chats", () => {
  let db: MockDatabaseAccess;
  let handler: ToolHandler;

  beforeEach(() => {
    db = createMockDatabaseAccess();
    handler = createListChatsHandler(db as unknown as DatabaseAccess);
    
    const now = new Date();
    for (let i = 1; i <= 50; i++) {
      db._data.chats.set(`chat-${i}`, {
        id: `chat-${i}`,
        workspaceId: "ws-1",
        projectId: i <= 10 ? "proj-1" : null,
        folderId: i > 10 && i <= 20 ? "folder-1" : null,
        title: `Chat ${i}`,
        isPinned: i <= 5,
        isArchived: i > 40 && i <= 45,
        category: i > 45 ? "special" : "general",
        lastMessageAt: new Date(now.getTime() - i * 1000),
        deletedAt: null,
      });
    }
  });

  describe("ToolSpec", () => {
    it("should have correct metadata", () => {
      expect(listChatsToolSpec.name).toBe("core.list_chats");
      expect(listChatsToolSpec.scope).toBe("core");
      expect(listChatsToolSpec.guards?.some(g => g.type === "workspace-context")).toBe(true);
    });
  });

  describe("handler", () => {
    it("should list chats with default limit", async () => {
      const result = await handler.execute({ workspace_id: "ws-1" });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items).toHaveLength(20);
      expect(data.items[0].id).toBe("chat-1");
      expect(data.hasMore).toBe(true);
      expect(data.nextCursor).toBe("chat-20");
    });

    it("should filter by project_id", async () => {
      const result = await handler.execute({ workspace_id: "ws-1", project_id: "proj-1" });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items).toHaveLength(10);
      expect(data.items.every((c: any) => c.projectId === "proj-1")).toBe(true);
    });

    it("should filter by folder_id", async () => {
      const result = await handler.execute({ workspace_id: "ws-1", folder_id: "folder-1" });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items).toHaveLength(10);
      expect(data.items.every((c: any) => c.folderId === "folder-1")).toBe(true);
    });

    it("should filter by is_pinned", async () => {
      const result = await handler.execute({ workspace_id: "ws-1", is_pinned: true });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items).toHaveLength(5);
      expect(data.items.every((c: any) => c.isPinned === true)).toBe(true);
    });

    it("should filter by is_archived", async () => {
      const result = await handler.execute({ workspace_id: "ws-1", is_archived: true });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items).toHaveLength(5);
      expect(data.items.every((c: any) => c.isArchived === true)).toBe(true);
    });

    it("should filter by category", async () => {
      const result = await handler.execute({ workspace_id: "ws-1", category: "special" });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items).toHaveLength(5);
      expect(data.items.every((c: any) => c.category === "special")).toBe(true);
    });

    it("should handle pagination with cursor", async () => {
      const firstPage = await handler.execute({ workspace_id: "ws-1", limit: 10 });
      const firstData = firstPage.data as any;
      
      const secondPage = await handler.execute({ 
        workspace_id: "ws-1", 
        limit: 10, 
        cursor: firstData.nextCursor 
      });
      
      expect(secondPage.success).toBe(true);
      const secondData = secondPage.data as any;
      expect(secondData.items).toHaveLength(10);
      expect(secondData.items[0].id).toBe("chat-11");
    });

    it("should apply field selection", async () => {
      const result = await handler.execute({ 
        workspace_id: "ws-1", 
        fields: ["id", "title"] 
      });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items[0]).toEqual({ id: "chat-1", title: "Chat 1" });
      expect(data.items[0].workspaceId).toBeUndefined();
    });
  });
});
