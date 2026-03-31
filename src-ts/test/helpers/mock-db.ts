import { type DatabaseAccess } from "../../src/db";

export type MockDatabaseAccess = DatabaseAccess & {
  _data: {
    workspaces: Map<string, any>;
    projects: Map<string, any>;
    chats: Map<string, any>;
    fileRecords: Map<string, any>;
    bookmarks: Map<string, any>;
    favorites: Map<string, any>;
  };
};

export function createMockDatabaseAccess(): MockDatabaseAccess {
  const data = {
    workspaces: new Map<string, any>(),
    projects: new Map<string, any>(),
    chats: new Map<string, any>(),
    fileRecords: new Map<string, any>(),
    bookmarks: new Map<string, any>(),
    favorites: new Map<string, any>(),
  };

  const createBaseRepo = (map: Map<string, any>) => ({
    findById: async (id: string) => map.get(id) || null,
    findByIdOrThrow: async (id: string) => {
      const entity = map.get(id);
      if (!entity) throw new Error("Not found");
      return entity;
    },
    findMany: async (limit?: number) => {
      const items = Array.from(map.values());
      return limit ? items.slice(0, limit) : items;
    },
    findActive: async (limit?: number) => {
      const items = Array.from(map.values()).filter((i) => !i.deletedAt);
      return limit ? items.slice(0, limit) : items;
    },
    count: async () => map.size,
    exists: async (id: string) => map.has(id),
  });

  const mockDb = {
    _data: data,
    get workspaces() {
      return createBaseRepo(data.workspaces);
    },
    get projects() {
      const base = createBaseRepo(data.projects);
      return {
        ...base,
        findByWorkspace: async (workspaceId: string) => {
          return Array.from(data.projects.values())
            .filter((p) => p.workspaceId === workspaceId && !p.deletedAt)
            .sort((a, b) => a.name.localeCompare(b.name));
        },
        findActiveByWorkspace: async (workspaceId: string) => {
          return Array.from(data.projects.values())
            .filter(
              (p) =>
                p.workspaceId === workspaceId &&
                p.status === "active" &&
                !p.deletedAt,
            )
            .sort((a, b) => a.name.localeCompare(b.name));
        },
      };
    },
    get chats() {
      const base = createBaseRepo(data.chats);
      return {
        ...base,
        findByWorkspace: async (
          workspaceId: string,
          limit?: number,
          options?: {
            folderId?: string | null;
            excludeCategories?: string[];
            projectId?: string | null;
          },
        ) => {
          let items = Array.from(data.chats.values()).filter(
            (c) => c.workspaceId === workspaceId && !c.deletedAt,
          );

          if (options?.folderId !== undefined) {
            items = items.filter((c) => c.folderId === options.folderId);
          }

          if (options?.projectId !== undefined) {
            items = items.filter((c) => c.projectId === options.projectId);
          }

          if (options?.excludeCategories?.length) {
            items = items.filter(
              (c) => !options.excludeCategories?.includes(c.category),
            );
          }

          items.sort(
            (a, b) =>
              new Date(b.lastMessageAt || 0).getTime() -
              new Date(a.lastMessageAt || 0).getTime(),
          );

          return limit ? items.slice(0, limit) : items;
        },
        findPinned: async (workspaceId: string) => {
          return Array.from(data.chats.values())
            .filter(
              (c) =>
                c.workspaceId === workspaceId && c.isPinned && !c.deletedAt,
            )
            .sort((a, b) => {
              if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
              return (
                new Date(b.lastMessageAt || 0).getTime() -
                new Date(a.lastMessageAt || 0).getTime()
              );
            });
        },
      };
    },
    get fileRecords() {
      const base = createBaseRepo(data.fileRecords);
      return {
        ...base,
        query: async (params: {
          workspaceId?: string;
          projectId?: string;
          mimeType?: string;
          status?: string;
          tags?: string[];
          limit?: number;
        }) => {
          let items = Array.from(data.fileRecords.values());

          if (params.workspaceId) {
            items = items.filter((i) => i.workspaceId === params.workspaceId);
          }
          if (params.projectId) {
            items = items.filter((i) => i.projectId === params.projectId);
          }
          if (params.mimeType) {
            items = items.filter((i) => i.mimeType === params.mimeType);
          }
          if (params.status) {
            items = items.filter((i) => i.status === params.status);
          }
          if (params.tags?.length) {
            items = items.filter((i) =>
              params.tags?.some((t) => i.tags?.includes(t)),
            );
          }

          items.sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );

          return params.limit ? items.slice(0, params.limit) : items;
        },
      };
    },
    get bookmarks() {
      const base = createBaseRepo(data.bookmarks);
      return {
        ...base,
        findByWorkspace: async (workspaceId: string) => {
          return Array.from(data.bookmarks.values())
            .filter((b) => b.workspaceId === workspaceId)
            .sort(
              (a, b) =>
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime(),
            );
        },
      };
    },
    get favorites() {
      const base = createBaseRepo(data.favorites);
      return {
        ...base,
        findByWorkspace: async (workspaceId: string) => {
          return Array.from(data.favorites.values())
            .filter((f) => f.workspaceId === workspaceId)
            .sort((a, b) => {
              if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
              return (
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime()
              );
            });
        },
      };
    },
  };

  return mockDb as unknown as MockDatabaseAccess;
}
