import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { TestServer } from "./helpers/test-server";
import { cleanTestDatabase } from "./setup";

const PORT = 3001;
const testServer = new TestServer(PORT);
const WORKSPACES_URL = `http://localhost:${PORT}/api/workspaces`;
const PROJECTS_URL = `http://localhost:${PORT}/api/projects`;

describe("Project API", () => {
    let workspaceId: string;
    let projectId: string;

    beforeAll(async () => {
        await cleanTestDatabase();
        await testServer.start();

        // Create a workspace first
        const res = await fetch(WORKSPACES_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Project Test Workspace" })
        });
        const json = await res.json() as any;
        workspaceId = json.data.workspace.id;
    });

    afterAll(async () => {
        await testServer.stop();
        await cleanTestDatabase();
    });

    it("should create a new project", async () => {
        const res = await fetch(PROJECTS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                workspaceId,
                name: "Test Project"
            })
        });

        expect(res.status).toBe(201);
        const json = await res.json() as any;
        expect(json.ok).toBe(true);
        expect(json.data.project.name).toBe("Test Project");
        expect(json.data.project.workspaceId).toBe(workspaceId);
        expect(json.data.project.status).toBe("active");

        projectId = json.data.project.id;
    });

    it("should list projects by workspace", async () => {
        const res = await fetch(`${PROJECTS_URL}?workspaceId=${workspaceId}`);
        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.ok).toBe(true);
        expect(Array.isArray(json.data.projects)).toBe(true);
        expect(json.data.projects.some((p: any) => p.id === projectId)).toBe(true);
    });

    it("should return 400 if workspaceId missing in list", async () => {
        const res = await fetch(PROJECTS_URL);
        expect(res.status).toBe(400);
    });

    it("should get project by id", async () => {
        const res = await fetch(`${PROJECTS_URL}/${projectId}`);
        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.ok).toBe(true);
        expect(json.data.project.id).toBe(projectId);
    });

    it("should update project", async () => {
        const res = await fetch(`${PROJECTS_URL}/${projectId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "Updated Project",
                status: "archived"
            })
        });

        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.ok).toBe(true);
        expect(json.data.project.name).toBe("Updated Project");
        expect(json.data.project.status).toBe("archived");
    });

    it("should delete project", async () => {
        const res = await fetch(`${PROJECTS_URL}/${projectId}`, {
            method: "DELETE"
        });

        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.ok).toBe(true);
        expect(json.data.deleted).toBe(true);
    });

    it("should not list deleted projects", async () => {
        const res = await fetch(`${PROJECTS_URL}?workspaceId=${workspaceId}`);
        const json = await res.json() as any;
        expect(json.data.projects.some((p: any) => p.id === projectId)).toBe(false);
    });
});
