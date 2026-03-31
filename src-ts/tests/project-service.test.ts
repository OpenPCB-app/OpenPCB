import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { DatabaseAccess, initializeDatabase } from "../src/db";
import { runMigrations } from "../src/db/migrate";
import { ProjectService } from "../src/domain/services/project-service";
import { cleanTestDatabase } from "../test/setup";

describe("ProjectService", () => {
    let db: DatabaseAccess;
    let service: ProjectService;
    let workspaceId: string;

    beforeAll(async () => {
        await cleanTestDatabase();
        
        db = initializeDatabase();
        
        await runMigrations();

        // Test-only safety for out-of-sync migrations
        const rawDb = db.getRawDb();
        const tables = rawDb.prepare("PRAGMA table_info(project)").all() as any[];
        const columns = tables.map(t => t.name);
        
        if (!columns.includes("description")) {
            rawDb.exec("ALTER TABLE project ADD COLUMN description TEXT");
        }
        if (!columns.includes("icon")) {
            rawDb.exec("ALTER TABLE project ADD COLUMN icon TEXT");
        }
        if (!columns.includes("color")) {
            rawDb.exec("ALTER TABLE project ADD COLUMN color TEXT");
        }
        if (!columns.includes("sort_order")) {
            rawDb.exec("ALTER TABLE project ADD COLUMN sort_order INTEGER");
        }
        if (!columns.includes("ai_config")) {
            rawDb.exec("ALTER TABLE project ADD COLUMN ai_config TEXT");
        }
        if (!columns.includes("rag_config")) {
            rawDb.exec("ALTER TABLE project ADD COLUMN rag_config TEXT");
        }
        if (!columns.includes("preferences")) {
            rawDb.exec("ALTER TABLE project ADD COLUMN preferences TEXT");
        }
        
        service = new ProjectService(db);
    });

    afterAll(async () => {
        if (db) {
            db.close();
        }
        await cleanTestDatabase();
    });

    beforeEach(async () => {
        const rawDb = db.getRawDb();
        rawDb.exec("DELETE FROM project");
        rawDb.exec("DELETE FROM workspace");

        const workspace = await db.workspaces.create({
            name: "Test Workspace",
        });
        workspaceId = workspace.id;
    });

    describe("Project CRUD Operations", () => {
        it("should create a minimal project", async () => {
            const project = await service.create({
                workspaceId,
                name: "Minimal Project",
            });

            expect(project.id).toBeDefined();
            expect(project.name).toBe("Minimal Project");
            expect(project.workspaceId).toBe(workspaceId);
            expect(project.status).toBe("active");
        });

        it("should create a project with all optional fields", async () => {
            const input = {
                workspaceId,
                name: "Full Project",
                description: "A comprehensive description",
                status: "active" as const,
                aiConfig: { 
                    systemPrompt: "You are a specialized assistant", 
                    temperature: 0.2,
                    systemPromptMode: "append" as const
                },
                ragConfig: { 
                    contextFileIds: ["file-1", "file-2"], 
                    contextNotes: "Some context notes" 
                },
                preferences: { 
                    showInSidebar: true, 
                    expandedByDefault: false 
                },
                metadata: { source: "test-suite", version: "1.0" },
            };

            const project = await service.create(input);

            expect(project.name).toBe("Full Project");
            expect(project.description).toBe("A comprehensive description");
            expect(project.aiConfig).toEqual(input.aiConfig);
            expect(project.ragConfig).toEqual(input.ragConfig);
            expect(project.preferences).toEqual(input.preferences);
            expect(project.metadata).toEqual(input.metadata);
        });

        it("should get a project by id", async () => {
            const created = await service.create({ workspaceId, name: "Find Me" });
            const found = await service.get(created.id);
            
            expect(found.id).toBe(created.id);
            expect(found.name).toBe("Find Me");
        });

        it("should list projects by workspace", async () => {
            await service.create({ workspaceId, name: "Project A" });
            await service.create({ workspaceId, name: "Project B" });
            
            const otherWorkspace = await db.workspaces.create({ name: "Other Workspace" });
            await service.create({ workspaceId: otherWorkspace.id, name: "Other Project" });

            const projects = await service.list(workspaceId);
            expect(projects).toHaveLength(2);
            expect(projects.map(p => p.name)).toContain("Project A");
            expect(projects.map(p => p.name)).toContain("Project B");
            expect(projects.every(p => p.workspaceId === workspaceId)).toBe(true);
        });

        it("should update project name and trim whitespace", async () => {
            const project = await service.create({ workspaceId, name: "Old Name" });
            const updated = await service.update(project.id, { name: "  New Trimmed Name  " });

            expect(updated.name).toBe("New Trimmed Name");
        });

        it("should soft delete a project", async () => {
            const project = await service.create({ workspaceId, name: "To Be Deleted" });
            await service.delete(project.id);

            const projects = await service.list(workspaceId);
            expect(projects.some(p => p.id === project.id)).toBe(false);

            const raw = await db.projects.findById(project.id);
            expect(raw).not.toBeNull();
            expect(raw?.deletedAt).not.toBeNull();
        });
    });

    describe("JSON Field Persistence & Merge Semantics", () => {
        it("should merge aiConfig correctly during partial update", async () => {
            const project = await service.create({
                workspaceId,
                name: "AI Merge Test",
                aiConfig: { 
                    systemPrompt: "Initial prompt", 
                    temperature: 0.5,
                    systemPromptMode: "append"
                },
            });

            const updated = await service.update(project.id, {
                aiConfig: { temperature: 0.9 },
            });

            expect(updated.aiConfig).toEqual({
                systemPrompt: "Initial prompt",
                temperature: 0.9,
                systemPromptMode: "append",
            });
        });

        it("should preserve existing aiConfig when updating unrelated fields", async () => {
            const initialConfig = { systemPrompt: "Keep this", temperature: 0.5 };
            const project = await service.create({
                workspaceId,
                name: "Persistence Test",
                aiConfig: initialConfig,
            });

            const updated = await service.update(project.id, {
                description: "New description",
            });

            expect(updated.description).toBe("New description");
            expect(updated.aiConfig).toEqual(initialConfig);
        });

        it("should merge preferences JSON", async () => {
            const project = await service.create({
                workspaceId,
                name: "Prefs Merge",
                preferences: { showInSidebar: true, expandedByDefault: true },
            });

            const updated = await service.update(project.id, {
                preferences: { expandedByDefault: false },
            });

            expect(updated.preferences).toEqual({
                showInSidebar: true,
                expandedByDefault: false,
            });
        });

        it("should allow nulling out configs", async () => {
            const project = await service.create({
                workspaceId,
                name: "Null Test",
                aiConfig: { systemPrompt: "Hello" },
            });

            const updated = await service.update(project.id, {
                aiConfig: null,
            });

            expect(updated.aiConfig).toBeNull();
        });
    });

    describe("Error Cases", () => {
        it("should throw NotFoundError when getting non-existent project", async () => {
            expect(service.get("00000000-0000-0000-0000-000000000000")).rejects.toThrow();
        });

        it("should throw ValidationError when creating project with empty name", async () => {
            expect(service.create({ workspaceId, name: "" })).rejects.toThrow();
            expect(service.create({ workspaceId, name: "   " })).rejects.toThrow();
        });

        it("should throw ValidationError when updating project with empty name", async () => {
            const project = await service.create({ workspaceId, name: "Valid" });
            expect(service.update(project.id, { name: "" })).rejects.toThrow();
            expect(service.update(project.id, { name: "   " })).rejects.toThrow();
        });

        it("should throw NotFoundError when creating project for non-existent workspace", async () => {
            expect(service.create({ 
                workspaceId: "00000000-0000-0000-0000-000000000000", 
                name: "No Workspace" 
            })).rejects.toThrow();
        });
    });
});
