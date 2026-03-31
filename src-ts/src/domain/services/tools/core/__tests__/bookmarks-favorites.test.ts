import { describe, it, expect, beforeEach } from "bun:test";
import { createMockDatabaseAccess, type MockDatabaseAccess } from "../../../../../../test/helpers/mock-db";
import { 
  createListBookmarksHandler, 
  listBookmarksSpec,
  createListFavoritesHandler,
  listFavoritesSpec
} from "../bookmarks-favorites";
import type { ToolHandler } from "@shared/types/tool.types";
import type { DatabaseAccess } from "../../../../db";

describe("Bookmarks and Favorites Tools", () => {
  let db: MockDatabaseAccess;

  beforeEach(() => {
    db = createMockDatabaseAccess();
  });

  describe("core.list_bookmarks", () => {
    let handler: ToolHandler;

    beforeEach(() => {
      handler = createListBookmarksHandler(db as unknown as DatabaseAccess);
      
      db._data.bookmarks.set("b1", {
        id: "b1",
        workspaceId: "ws-1",
        chatId: "chat-1",
        messageId: "msg-1",
        note: "Note 1",
        createdAt: "2026-01-01T00:00:00Z",
        message: {
          id: "msg-1",
          role: "assistant",
          content: {
            type: "text",
            text: "This is a long message that should be truncated in the preview. ".repeat(10)
          },
          chatId: "chat-1"
        }
      });
      db._data.bookmarks.set("b2", {
        id: "b2",
        workspaceId: "ws-1",
        chatId: "chat-1",
        messageId: "msg-2",
        note: "Note 2",
        createdAt: "2026-01-02T00:00:00Z",
        message: {
          id: "msg-2",
          role: "user",
          content: {
            type: "text",
            text: "Short message"
          },
          chatId: "chat-1"
        }
      });
    });

    it("should have correct metadata", () => {
      expect(listBookmarksSpec.name).toBe("core.list_bookmarks");
      expect(listBookmarksSpec.scope).toBe("core");
      expect(listBookmarksSpec.guards?.some(g => g.type === "workspace-context")).toBe(true);
    });

    it("should list bookmarks with preview", async () => {
      const result = await handler.execute({ workspace_id: "ws-1" });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items).toHaveLength(2);
      
      expect(data.items[0].id).toBe("b2");
      expect(data.items[1].id).toBe("b1");
      
      expect(data.items[1].messagePreview).toHaveLength(200);
      expect(data.items[1].message).toBeUndefined();
      expect(data.items[0].messagePreview).toBe("Short message");
    });

    it("should apply pagination", async () => {
      const result = await handler.execute({ workspace_id: "ws-1", limit: 1 });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items).toHaveLength(1);
      expect(data.items[0].id).toBe("b2");
      expect(data.hasMore).toBe(true);
      expect(data.nextCursor).toBe("b2");
    });

    it("should apply field selection", async () => {
      const result = await handler.execute({ 
        workspace_id: "ws-1", 
        fields: ["id", "note"] 
      });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items[0]).toEqual({ id: "b2", note: "Note 2" });
    });
  });

  describe("core.list_favorites", () => {
    let handler: ToolHandler;

    beforeEach(() => {
      handler = createListFavoritesHandler(db as unknown as DatabaseAccess);
      
      db._data.favorites.set("f1", {
        id: "f1",
        workspaceId: "ws-1",
        chatId: "chat-1",
        sortOrder: 2,
        createdAt: "2026-01-01T00:00:00Z",
        chat: { id: "chat-1", title: "Chat 1" }
      });
      db._data.favorites.set("f2", {
        id: "f2",
        workspaceId: "ws-1",
        chatId: "chat-2",
        sortOrder: 1,
        createdAt: "2026-01-02T00:00:00Z",
        chat: { id: "chat-2", title: "Chat 2" }
      });
    });

    it("should have correct metadata", () => {
      expect(listFavoritesSpec.name).toBe("core.list_favorites");
      expect(listFavoritesSpec.scope).toBe("core");
      expect(listFavoritesSpec.guards?.some(g => g.type === "workspace-context")).toBe(true);
    });

    it("should list favorites sorted by sortOrder", async () => {
      const result = await handler.execute({ workspace_id: "ws-1" });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items).toHaveLength(2);
      
      expect(data.items[0].id).toBe("f2");
      expect(data.items[1].id).toBe("f1");
    });

    it("should apply field selection", async () => {
      const result = await handler.execute({ 
        workspace_id: "ws-1", 
        fields: ["id", "chatId"] 
      });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items[0]).toEqual({ id: "f2", chatId: "chat-2" });
    });
  });
});
