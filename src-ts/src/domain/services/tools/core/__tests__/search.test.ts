import { describe, it, expect, beforeEach } from "bun:test";
import { createSearchHandler, searchToolSpec } from "../search";
import type { ToolHandler } from "@shared/types/tool.types";
import type { DatabaseAccess } from "../../../../db";

interface ChatRow {
  id: string;
  workspaceId: string;
  projectId: string | null;
  title: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

interface MessageRow {
  id: string;
  chatId: string;
  content: { type: "text"; text?: string };
  createdAt: Date;
  deletedAt: Date | null;
}

interface FileRow {
  id: string;
  workspaceId: string;
  projectId: string | null;
  originalName: string;
  status: string;
  createdAt: Date;
  deletedAt: Date | null;
}

interface SeedData {
  chats: ChatRow[];
  messages: MessageRow[];
  files: FileRow[];
}

function createMockDatabase(seed: SeedData): DatabaseAccess {
  const drizzleDb = {
    select: (_shape?: unknown) => ({
      from: (tableRef: { [key: string]: unknown }) => {
        const rows =
          typeof tableRef["workspaceId"] !== "undefined" &&
          typeof tableRef["title"] !== "undefined"
            ? seed.chats
            : typeof tableRef["chatId"] !== "undefined"
              ? seed.messages
              : seed.files;

        let currentRows = [...rows];

        const query = {
          where: (_condition: unknown) => query,
          orderBy: (_field: unknown) => query,
          limit: (value: number) => {
            currentRows = currentRows.slice(0, value);
            return query;
          },
          then: <TResult1 = typeof currentRows, TResult2 = never>(
            onfulfilled?: ((value: typeof currentRows) => TResult1 | PromiseLike<TResult1>) | null,
            onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
          ) => Promise.resolve(currentRows).then(onfulfilled, onrejected),
        };

        return query;
      },
    }),
  };

  return {
    getDb: () => drizzleDb,
  } as unknown as DatabaseAccess;
}

describe("core.search", () => {
  let handler: ToolHandler;

  beforeEach(() => {
    const now = Date.now();
    const db = createMockDatabase({
      chats: [
        {
          id: "chat-alpha-exact",
          workspaceId: "ws-1",
          projectId: "proj-1",
          title: "alpha",
          createdAt: new Date(now - 1_000),
          deletedAt: null,
        },
        {
          id: "chat-alpha-partial",
          workspaceId: "ws-1",
          projectId: "proj-1",
          title: "Alpha plan",
          createdAt: new Date(now - 2_000),
          deletedAt: null,
        },
        {
          id: "chat-other-ws",
          workspaceId: "ws-2",
          projectId: "proj-9",
          title: "alpha hidden",
          createdAt: new Date(now - 3_000),
          deletedAt: null,
        },
      ],
      messages: [
        {
          id: "msg-1",
          chatId: "chat-alpha-partial",
          content: { type: "text", text: "Need ALPHA follow-up" },
          createdAt: new Date(now - 4_000),
          deletedAt: null,
        },
        {
          id: "msg-other-ws",
          chatId: "chat-other-ws",
          content: { type: "text", text: "alpha should not leak" },
          createdAt: new Date(now - 5_000),
          deletedAt: null,
        },
      ],
      files: [
        {
          id: "file-1",
          workspaceId: "ws-1",
          projectId: "proj-1",
          originalName: "Alpha-Notes.md",
          status: "active",
          createdAt: new Date(now - 6_000),
          deletedAt: null,
        },
        {
          id: "file-other-ws",
          workspaceId: "ws-2",
          projectId: "proj-9",
          originalName: "alpha-secret.md",
          status: "active",
          createdAt: new Date(now - 7_000),
          deletedAt: null,
        },
      ],
    });

    handler = createSearchHandler(db);
  });

  describe("ToolSpec", () => {
    it("should have correct metadata and workspace guard", () => {
      expect(searchToolSpec.name).toBe("core.search");
      expect(searchToolSpec.scope).toBe("core");
      expect(searchToolSpec.inputSchema.required).toEqual(["query"]);
      expect(searchToolSpec.guards?.some((g) => g.type === "workspace-context")).toBe(true);
    });
  });

  describe("handler", () => {
    it("should search chats/messages/files case-insensitively", async () => {
      const result = await handler.execute({
        workspace_id: "ws-1",
        query: "ALPHA",
      });

      expect((result as any).success).toBe(true);
      const data = (result as any).data;
      expect(data.items.map((x: any) => x.type)).toEqual(["chat", "chat", "file", "message"]);
      expect(data.items.map((x: any) => x.id)).toEqual([
        "chat-alpha-exact",
        "chat-alpha-partial",
        "file-1",
        "msg-1",
      ]);
    });

    it("should scope to workspace and optional project", async () => {
      const result = await handler.execute({
        workspace_id: "ws-1",
        project_id: "proj-1",
        query: "alpha",
      });

      expect((result as any).success).toBe(true);
      const items = (result as any).data.items as Array<{ id: string }>;
      expect(items.some((x) => x.id === "chat-other-ws")).toBe(false);
      expect(items.some((x) => x.id === "msg-other-ws")).toBe(false);
      expect(items.some((x) => x.id === "file-other-ws")).toBe(false);
    });

    it("should filter by entity_type", async () => {
      const result = await handler.execute({
        workspace_id: "ws-1",
        query: "alpha",
        entity_type: "files",
      });

      expect((result as any).success).toBe(true);
      const items = (result as any).data.items as Array<{
        type: string;
        id: string;
        titleOrPreview: string;
        matchField: string;
        workspaceId: string;
        projectId: string | null;
        createdAt: string;
      }>;
      expect(items).toEqual([{ type: "file", id: "file-1", titleOrPreview: "Alpha-Notes.md", matchField: "originalName", workspaceId: "ws-1", projectId: "proj-1", createdAt: expect.any(String) }]);
    });

    it("should apply relevance ordering (exact before partial), pagination, and fields[]", async () => {
      const first = await handler.execute({
        workspace_id: "ws-1",
        query: "alpha",
        limit: 2,
        fields: ["id", "type", "titleOrPreview"],
      });

      expect((first as any).success).toBe(true);
      const firstData = (first as any).data;
      expect(firstData.items).toEqual([
        { id: "chat-alpha-exact", type: "chat", titleOrPreview: "alpha" },
        { id: "chat-alpha-partial", type: "chat", titleOrPreview: "Alpha plan" },
      ]);
      expect(firstData.hasMore).toBe(true);
      expect(typeof firstData.nextCursor).toBe("string");

      const second = await handler.execute({
        workspace_id: "ws-1",
        query: "alpha",
        limit: 2,
        cursor: firstData.nextCursor,
        fields: ["id", "type"],
      });

      expect((second as any).success).toBe(true);
      const secondData = (second as any).data;
      expect(secondData.items).toEqual([
        { id: "file-1", type: "file" },
        { id: "msg-1", type: "message" },
      ]);
    });
  });
});
