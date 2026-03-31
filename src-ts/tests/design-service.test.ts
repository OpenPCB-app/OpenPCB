import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { DatabaseAccess, initializeDatabase } from "../src/db";
import { runMigrations } from "../src/db/migrate";
import { DesignService } from "../src/domain/services/design-service";
import { cleanTestDatabase } from "../test/setup";

describe("DesignService", () => {
    let db: DatabaseAccess;
    let service: DesignService;
    let workspaceId: string;
    let projectId: string;

    beforeAll(async () => {
        await cleanTestDatabase();
        DatabaseAccess.reset();

        db = initializeDatabase();
        await runMigrations();
        service = new DesignService(db);
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
            name: "Design Workspace",
        });
        workspaceId = workspace.id;

        const project = await db.projects.create({
            workspaceId,
            name: "Design Project",
            status: "active",
        });
        projectId = project.id;
    });

    it("creates and lists designs by project", async () => {
        const design = await service.create({
            workspaceId,
            projectId,
            name: " Main Board ",
            description: "Primary PCB",
        });

        const list = await service.listByProject(projectId);

        expect(design.name).toBe("Main Board");
        expect(list).toHaveLength(1);
        expect(list[0]?.id).toBe(design.id);
    });

    it("creates and lists workspace-level designs without a project", async () => {
        const design = await service.create({
            workspaceId,
            name: "Standalone Part",
            description: "No project container",
        });

        const list = await service.listByScope(workspaceId, null);

        expect(design.projectId).toBeNull();
        expect(list).toHaveLength(1);
        expect(list[0]?.id).toBe(design.id);
    });

    it("gets and updates a design", async () => {
        const design = await service.create({
            workspaceId,
            projectId,
            name: "Controller",
        });

        const found = await service.get(design.id);
        const updated = await service.update(design.id, {
            name: " Controller Rev B ",
            description: "Second revision",
        });

        expect(found.id).toBe(design.id);
        expect(updated.name).toBe("Controller Rev B");
        expect(updated.description).toBe("Second revision");
    });

    it("soft deletes designs", async () => {
        const design = await service.create({
            workspaceId,
            projectId,
            name: "Delete Me",
        });

        await service.delete(design.id);

        const list = await service.listByProject(projectId);
        const deleted = await db.designs.findById(design.id);

        expect(list).toHaveLength(0);
        expect(deleted?.deletedAt).not.toBeNull();
        expect(service.get(design.id)).rejects.toThrow();
    });

    it("rejects workspace mismatches", async () => {
        const otherWorkspace = await db.workspaces.create({ name: "Other Workspace" });

        expect(
            service.create({
                workspaceId: otherWorkspace.id,
                projectId,
                name: "Invalid Design",
            }),
        ).rejects.toThrow("Design workspace must match project workspace");
    });
});
