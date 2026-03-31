import { describe, it, expect, beforeEach } from "bun:test";
import { createMockDatabaseAccess, type MockDatabaseAccess } from "../../../../../../test/helpers/mock-db";
import { createListFilesHandler, listFilesToolSpec } from "../list-files";
import type { ToolHandler } from "@shared/types/tool.types";
import type { DatabaseAccess } from "../../../../db";

describe("core.list_files", () => {
  let db: MockDatabaseAccess;
  let handler: ToolHandler;

  beforeEach(() => {
    db = createMockDatabaseAccess();
    handler = createListFilesHandler(db as unknown as DatabaseAccess);
    
    const now = new Date();
    for (let i = 1; i <= 5; i++) {
      db._data.fileRecords.set(`file-${i}`, {
        id: `file-${i}`,
        workspaceId: "ws-1",
        projectId: i <= 3 ? "proj-1" : "proj-2",
        originalName: `file-${i}.txt`,
        mimeType: "text/plain",
        sizeBytes: 100 * i,
        tags: i % 2 === 0 ? ["tag-a"] : ["tag-b"],
        status: "active",
        blobId: `blob-${i}`,
        createdAt: new Date(now.getTime() - i * 1000).toISOString(),
      });
    }
  });

  describe("ToolSpec", () => {
    it("should have correct metadata", () => {
      expect(listFilesToolSpec.name).toBe("core.list_files");
      expect(listFilesToolSpec.scope).toBe("core");
      expect(listFilesToolSpec.guards).toBeDefined();
      expect(listFilesToolSpec.guards?.some(g => g.type === "workspace-context")).toBe(true);
    });
  });

  describe("handler", () => {
    it("should list all files in workspace", async () => {
      const result = await handler.execute({ workspace_id: "ws-1" });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items).toHaveLength(5);
      expect(data.items[0].id).toBe("file-1");
      expect(data.items[0].blobId).toBeUndefined();
    });

    it("should filter by project_id", async () => {
      const result = await handler.execute({ workspace_id: "ws-1", project_id: "proj-1" });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items).toHaveLength(3);
      expect(data.items.every((f: any) => f.projectId === "proj-1")).toBe(true);
    });

    it("should filter by mime_type", async () => {
      db._data.fileRecords.set("file-img", {
        id: "file-img",
        workspaceId: "ws-1",
        originalName: "image.png",
        mimeType: "image/png",
        sizeBytes: 500,
        status: "active",
        createdAt: new Date().toISOString(),
      });

      const result = await handler.execute({ workspace_id: "ws-1", mime_type: "image/png" });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items).toHaveLength(1);
      expect(data.items[0].mimeType).toBe("image/png");
    });

    it("should filter by tags", async () => {
      const result = await handler.execute({ workspace_id: "ws-1", tags: ["tag-a"] });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items).toHaveLength(2);
      expect(data.items.every((f: any) => f.tags.includes("tag-a"))).toBe(true);
    });

    it("should apply pagination", async () => {
      const result = await handler.execute({ workspace_id: "ws-1", limit: 2 });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items).toHaveLength(2);
      expect(data.hasMore).toBe(true);
      expect(data.nextCursor).toBe("file-2");

      const secondPage = await handler.execute({ workspace_id: "ws-1", limit: 2, cursor: data.nextCursor });
      expect(secondPage.success).toBe(true);
      const secondData = secondPage.data as any;
      expect(secondData.items).toHaveLength(2);
      expect(secondData.items[0].id).toBe("file-3");
      expect(secondData.nextCursor).toBe("file-4");
    });

    it("should apply field selection", async () => {
      const result = await handler.execute({ 
        workspace_id: "ws-1", 
        fields: ["id", "originalName"] 
      });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items[0]).toEqual({
        id: "file-1",
        originalName: "file-1.txt"
      });
      expect(data.items[0].mimeType).toBeUndefined();
    });

    it("should allow including blobId if explicitly requested", async () => {
      const result = await handler.execute({ 
        workspace_id: "ws-1", 
        fields: ["id", "blobId"] 
      });
      
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.items[0].blobId).toBe("blob-1");
    });
  });
});
