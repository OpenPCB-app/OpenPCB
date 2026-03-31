import { describe, it, expect, beforeEach } from "bun:test";
import { createMockDatabaseAccess, type MockDatabaseAccess } from "../../../../../../test/helpers/mock-db";
import { createListProjectsHandler, createGetProjectHandler } from "../projects";

describe("Project Tools", () => {
  let db: MockDatabaseAccess;
  const workspaceId = "ws-1";
  const otherWorkspaceId = "ws-2";

  beforeEach(() => {
    db = createMockDatabaseAccess();
    
    db._data.projects.set("p-1", {
      id: "p-1",
      workspaceId,
      name: "Project 1",
      description: "Description 1",
      status: "active",
      aiConfig: { model: "gpt-4" },
      ragConfig: { enabled: true },
      createdAt: new Date().toISOString(),
    });

    db._data.projects.set("p-2", {
      id: "p-2",
      workspaceId,
      name: "Project 2",
      description: "Description 2",
      status: "archived",
      aiConfig: { model: "gpt-3.5" },
      ragConfig: { enabled: false },
      createdAt: new Date().toISOString(),
    });

    db._data.projects.set("p-other", {
      id: "p-other",
      workspaceId: otherWorkspaceId,
      name: "Other Project",
      status: "active",
      createdAt: new Date().toISOString(),
    });
  });

  describe("core.list_projects", () => {
    it("should list all projects in workspace", async () => {
      const handler = createListProjectsHandler(db as any);
      const result = await handler.execute({ workspace_id: workspaceId });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe("p-1");
      expect(result.data[1].id).toBe("p-2");
    });

    it("should filter by active status", async () => {
      const handler = createListProjectsHandler(db as any);
      const result = await handler.execute({ 
        workspace_id: workspaceId,
        status: "active" 
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe("p-1");
    });

    it("should sanitize output by default", async () => {
      const handler = createListProjectsHandler(db as any);
      const result = await handler.execute({ workspace_id: workspaceId });

      expect(result.success).toBe(true);
      expect(result.data[0].aiConfig).toBeUndefined();
      expect(result.data[0].ragConfig).toBeUndefined();
    });

    it("should allow explicit field selection", async () => {
      const handler = createListProjectsHandler(db as any);
      const result = await handler.execute({ 
        workspace_id: workspaceId,
        fields: ["id", "name", "aiConfig"]
      });

      expect(result.success).toBe(true);
      expect(result.data[0]).toEqual({
        id: "p-1",
        name: "Project 1",
        aiConfig: { model: "gpt-4" }
      });
    });
  });

  describe("core.get_project", () => {
    it("should get project by id", async () => {
      const handler = createGetProjectHandler(db as any);
      const result = await handler.execute({ 
        workspace_id: workspaceId,
        project_id: "p-1" 
      });

      expect(result.success).toBe(true);
      expect(result.data.id).toBe("p-1");
      expect(result.data.name).toBe("Project 1");
    });

    it("should return NOT_FOUND if project missing", async () => {
      const handler = createGetProjectHandler(db as any);
      const result = await handler.execute({ 
        workspace_id: workspaceId,
        project_id: "non-existent" 
      });

      expect(result.success).toBe(false);
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("should return FORBIDDEN if project in different workspace", async () => {
      const handler = createGetProjectHandler(db as any);
      const result = await handler.execute({ 
        workspace_id: workspaceId,
        project_id: "p-other" 
      });

      expect(result.success).toBe(false);
      expect(result.error.code).toBe("FORBIDDEN");
    });

    it("should sanitize output by default", async () => {
      const handler = createGetProjectHandler(db as any);
      const result = await handler.execute({ 
        workspace_id: workspaceId,
        project_id: "p-1" 
      });

      expect(result.success).toBe(true);
      expect(result.data.aiConfig).toBeUndefined();
      expect(result.data.ragConfig).toBeUndefined();
    });

    it("should allow explicit field selection", async () => {
      const handler = createGetProjectHandler(db as any);
      const result = await handler.execute({ 
        workspace_id: workspaceId,
        project_id: "p-1",
        fields: ["id", "aiConfig"]
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        id: "p-1",
        aiConfig: { model: "gpt-4" }
      });
    });
  });
});
