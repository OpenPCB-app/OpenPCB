import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { DatabaseAccess, initializeDatabase } from "../src/db";
import { runMigrations } from "../src/db/migrate";
import { ProjectService } from "../src/domain/services/project-service";
import { DesignService } from "../src/domain/services/design-service";
import { ProjectController } from "../src/transport/controllers/project-controller";
import { DesignController } from "../src/transport/controllers/design-controller";
import { RouteParams, type RouteContext } from "../src/transport/router/route-parser";
import { cleanTestDatabase } from "./setup";

function createContext(input: {
    method?: string;
    path: string;
    params?: Record<string, string>;
    body?: unknown;
    query?: Record<string, string>;
}): RouteContext {
    const queryString = input.query
        ? `?${new URLSearchParams(input.query).toString()}`
        : "";

    return {
        req: new Request(`http://localhost${input.path}${queryString}`, {
            method: input.method ?? "GET",
            headers: { "Content-Type": "application/json" },
            body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
        }),
        params: new RouteParams(input.params ?? {}),
        query: new URLSearchParams(input.query),
        url: new URL(`http://localhost${input.path}${queryString}`),
    };
}

describe("Project API", () => {
    let db: DatabaseAccess;
    let workspaceId: string;
    let projectController: ProjectController;
    let designController: DesignController;

    beforeAll(async () => {
        await cleanTestDatabase();
        DatabaseAccess.reset();

        db = initializeDatabase();
        await runMigrations();

        const projectService = new ProjectService(db);
        const designService = new DesignService(db);

        projectController = new ProjectController(projectService);
        designController = new DesignController(designService);
    });

    afterAll(async () => {
        if (db) {
            db.close();
        }
        DatabaseAccess.reset();
        await cleanTestDatabase();
    });

    beforeEach(async () => {
        const rawDb = db.getRawDb();
        rawDb.exec("DELETE FROM design");
        rawDb.exec("DELETE FROM project");
        rawDb.exec("DELETE FROM workspace");

        const workspace = await db.workspaces.create({
            name: "Project API Workspace",
        });
        workspaceId = workspace.id;
    });

    it("creates a project with normalized icon and sidebar defaults", async () => {
        const response = await projectController.create(
            createContext({
                method: "POST",
                path: "/api/projects",
                body: {
                    workspaceId,
                    name: "Test Project",
                    icon: "Briefcase",
                },
            }),
        );
        const json = await response.json() as {
            ok: boolean;
            data: {
                project: {
                    name: string;
                    status: string;
                    icon: string | null;
                    preferences: { showInSidebar?: boolean } | null;
                };
            };
        };

        expect(response.status).toBe(201);
        expect(json.ok).toBe(true);
        expect(json.data.project.name).toBe("Test Project");
        expect(json.data.project.status).toBe("active");
        expect(json.data.project.icon).toBe("briefcase");
        expect(json.data.project.preferences?.showInSidebar).toBe(true);
    });

    it("filters archived projects out of the default list", async () => {
        const active = await db.projects.create({
            workspaceId,
            name: "Active Project",
            status: "active",
        });
        const archived = await db.projects.create({
            workspaceId,
            name: "Archived Project",
            status: "archived",
        });

        const activeResponse = await projectController.list(
            createContext({
                path: "/api/projects",
                query: { workspaceId },
            }),
        );
        const activeJson = await activeResponse.json() as {
            data: { projects: Array<{ id: string }> };
        };

        expect(activeResponse.status).toBe(200);
        expect(activeJson.data.projects.some((project) => project.id === active.id)).toBe(true);
        expect(activeJson.data.projects.some((project) => project.id === archived.id)).toBe(false);

        const archivedResponse = await projectController.list(
            createContext({
                path: "/api/projects",
                query: {
                    workspaceId,
                    status: "archived",
                },
            }),
        );
        const archivedJson = await archivedResponse.json() as {
            data: { projects: Array<{ id: string }> };
        };

        expect(archivedJson.data.projects.some((project) => project.id === archived.id)).toBe(true);
        expect(archivedJson.data.projects.some((project) => project.id === active.id)).toBe(false);

        const allResponse = await projectController.list(
            createContext({
                path: "/api/projects",
                query: {
                    workspaceId,
                    status: "all",
                },
            }),
        );
        const allJson = await allResponse.json() as {
            data: { projects: Array<{ id: string }> };
        };

        expect(allJson.data.projects.some((project) => project.id === active.id)).toBe(true);
        expect(allJson.data.projects.some((project) => project.id === archived.id)).toBe(true);
    });

    it("supports nested design CRUD", async () => {
        const project = await db.projects.create({
            workspaceId,
            name: "Design Host Project",
            status: "active",
        });

        const createResponse = await designController.create(
            createContext({
                method: "POST",
                path: `/api/projects/${project.id}/designs`,
                params: { projectId: project.id },
                body: {
                    workspaceId,
                    name: "Main Board",
                    description: "Rev A",
                },
            }),
        );
        const createJson = await createResponse.json() as {
            data: { design: { id: string; name: string; description: string | null } };
        };

        expect(createResponse.status).toBe(201);
        expect(createJson.data.design.name).toBe("Main Board");

        const designId = createJson.data.design.id;

        const listResponse = await designController.listByProject(
            createContext({
                path: `/api/projects/${project.id}/designs`,
                params: { projectId: project.id },
            }),
        );
        const listJson = await listResponse.json() as {
            data: { designs: Array<{ id: string }> };
        };
        expect(listJson.data.designs.some((design) => design.id === designId)).toBe(true);

        const getResponse = await designController.get(
            createContext({
                path: `/api/designs/${designId}`,
                params: { id: designId },
            }),
        );
        expect(getResponse.status).toBe(200);

        const updateResponse = await designController.update(
            createContext({
                method: "PATCH",
                path: `/api/designs/${designId}`,
                params: { id: designId },
                body: {
                    name: "Main Board Rev B",
                    description: "Rev B",
                },
            }),
        );
        const updateJson = await updateResponse.json() as {
            data: { design: { name: string; description: string | null } };
        };
        expect(updateResponse.status).toBe(200);
        expect(updateJson.data.design.name).toBe("Main Board Rev B");
        expect(updateJson.data.design.description).toBe("Rev B");

        const deleteResponse = await designController.delete(
            createContext({
                method: "DELETE",
                path: `/api/designs/${designId}`,
                params: { id: designId },
            }),
        );
        expect(deleteResponse.status).toBe(200);

        const afterDeleteResponse = await designController.listByProject(
            createContext({
                path: `/api/projects/${project.id}/designs`,
                params: { projectId: project.id },
            }),
        );
        const afterDeleteJson = await afterDeleteResponse.json() as {
            data: { designs: Array<{ id: string }> };
        };
        expect(afterDeleteJson.data.designs.some((design) => design.id === designId)).toBe(false);
    });

    it("supports workspace-level design CRUD", async () => {
        const createResponse = await designController.create(
            createContext({
                method: "POST",
                path: "/api/designs",
                body: {
                    workspaceId,
                    name: "Loose Part",
                    description: "Stored in workspace",
                },
            }),
        );
        const createJson = await createResponse.json() as {
            data: { design: { id: string; projectId: string | null; name: string } };
        };

        expect(createResponse.status).toBe(201);
        expect(createJson.data.design.projectId).toBeNull();
        expect(createJson.data.design.name).toBe("Loose Part");

        const listResponse = await designController.list(
            createContext({
                path: "/api/designs",
                query: { workspaceId },
            }),
        );
        const listJson = await listResponse.json() as {
            data: { designs: Array<{ id: string }> };
        };
        expect(listResponse.status).toBe(200);
        expect(listJson.data.designs.some((design) => design.id === createJson.data.design.id)).toBe(true);
    });

    it("soft deletes projects from the active list", async () => {
        const project = await db.projects.create({
            workspaceId,
            name: "Delete Me",
            status: "active",
        });

        const deleteResponse = await projectController.delete(
            createContext({
                method: "DELETE",
                path: `/api/projects/${project.id}`,
                params: { id: project.id },
            }),
        );
        const listResponse = await projectController.list(
            createContext({
                path: "/api/projects",
                query: { workspaceId },
            }),
        );
        const listJson = await listResponse.json() as {
            data: { projects: Array<{ id: string }> };
        };

        expect(deleteResponse.status).toBe(200);
        expect(listJson.data.projects.some((item) => item.id === project.id)).toBe(false);
    });
});
