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

    it("saveSheetContent persists bundle content", async () => {
        const design = await service.create({
            workspaceId,
            projectId,
            name: "Persistence Check",
        });

        await service.saveSheetContent(design.id, 0, {
            formatVersion: "pcb.project-document-bundle/v1",
            docs: {
                schematic: {
                    id: design.id,
                    projectId,
                    updatedAt: new Date().toISOString(),
                    version: 1,
                    formatVersion: "pcb.schematic-project-document/v1",
                    title: "Sheet 1",
                    symbols: [
                        {
                            id: "symbol-1",
                            reference: "R1",
                            position: { x: 0, y: 0 },
                            pins: [
                                { id: "pin-1", name: "1", position: { x: 0, y: 0 } },
                                { id: "pin-2", name: "2", position: { x: 1000, y: 0 } },
                            ],
                            properties: { value: "10k" },
                        },
                    ],
                    wires: [
                        {
                            id: "wire-1",
                            points: [
                                { x: 0, y: 0 },
                                { x: 1000, y: 0 },
                            ],
                            sourcePinId: "pin-1",
                            targetPinId: "pin-2",
                            net: null,
                        },
                    ],
                    labels: [],
                },
                pcb: {
                    id: design.id,
                    projectId,
                    updatedAt: new Date().toISOString(),
                    version: 1,
                    formatVersion: "pcb.project-document/v1",
                    boardOutline: { width: 100, height: 80 },
                    manufacturerPreset: "jlcpcb_standard",
                    netClasses: [],
                    nets: [],
                    placements: [],
                    traces: [],
                    vias: [],
                    zones: [],
                },
            },
        });

        const saved = await service.getSheetContent(design.id, 0);
        expect(saved).not.toBeNull();
        expect(saved?.content.docs.schematic?.symbols).toHaveLength(1);
        expect(saved?.content.docs.schematic?.wires).toHaveLength(1);
        expect(saved?.content.docs.pcb?.boardOutline.width).toBe(100);
    });

    it("getSheetContent wraps legacy schematic-only content into a bundle", async () => {
        const design = await service.create({
            workspaceId,
            projectId,
            name: "Legacy Persistence Check",
        });

        const rawDb = db.getRawDb();
        const legacyJson = JSON.stringify({
            id: design.id,
            projectId,
            updatedAt: new Date().toISOString(),
            version: 1,
            formatVersion: "pcb.schematic-project-document/v1",
            title: "Sheet 1",
            symbols: [],
            wires: [],
            labels: [],
        }).replace(/'/g, "''");
        const createdAt = new Date().toISOString();
        const updatedAt = new Date().toISOString();

        rawDb.exec(`
            INSERT INTO design_sheet (id, design_id, sheet_index, title, content, content_hash, created_at, updated_at)
            VALUES (
                '${crypto.randomUUID()}',
                '${design.id}',
                0,
                'Sheet 1',
                json('${legacyJson}'),
                'legacy-hash',
                '${createdAt}',
                '${updatedAt}'
            )
        `);

        const saved = await service.getSheetContent(design.id, 0);
        expect(saved?.content.formatVersion).toBe("pcb.project-document-bundle/v1");
        expect(saved?.content.docs.schematic?.formatVersion).toBe(
            "pcb.schematic-project-document/v1",
        );
        expect(saved?.content.docs.pcb).toBeNull();
    });

    it("saveSheetContent bumps design updatedAt", async () => {
        const design = await service.create({
            workspaceId,
            projectId,
            name: "Timestamp Check",
        });

        const before = await service.get(design.id);
        const beforeMs = new Date(before.updatedAt).getTime();

        await new Promise((resolve) => setTimeout(resolve, 5));

        await service.saveSheetContent(design.id, 0, {
            formatVersion: "pcb.project-document-bundle/v1",
            docs: {
                schematic: {
                    id: design.id,
                    projectId,
                    updatedAt: new Date().toISOString(),
                    version: 1,
                    formatVersion: "pcb.schematic-project-document/v1",
                    title: "Sheet 1",
                    symbols: [],
                    wires: [],
                    labels: [],
                },
                pcb: null,
            },
        });

        const after = await service.get(design.id);
        const afterMs = new Date(after.updatedAt).getTime();
        expect(afterMs).toBeGreaterThan(beforeMs);
    });
});
