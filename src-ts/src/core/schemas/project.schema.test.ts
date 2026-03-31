import { describe, expect, test } from "bun:test";
import {
    CreateProjectInputSchema,
    ProjectSchema,
    UpdateProjectInputSchema,
} from "./project.schema";

const workspaceId = "01935c4a-1b2d-7e3f-8c9d-0e1f2a3b4c5d";
const projectId = "01935c4a-1b2d-7e3f-8c9d-0e1f2a3b4c5e";
const isoTimestamp = "2024-01-01T00:00:00.000Z";

describe("project schema", () => {
    test("ProjectSchema accepts extended fields", () => {
        const result = ProjectSchema.parse({
            id: projectId,
            workspaceId,
            name: "My Project",
            status: "active",
            description: "Project description",
            icon: "folder",
            color: "sky",
            sortOrder: 3,
            aiConfig: {
                defaultProvider: "openai",
                defaultModel: "gpt-4o",
                systemPrompt: "Be concise.",
                systemPromptMode: "replace",
                temperature: 0.2,
                maxTokens: 2048,
            },
            ragConfig: {
                contextFileIds: [projectId],
                contextNotes: "Important docs",
                embeddingModel: "text-embedding-3-large",
            },
            preferences: {
                showInSidebar: true,
                expandedByDefault: false,
                pinnedChats: [projectId],
            },
            createdAt: isoTimestamp,
            updatedAt: isoTimestamp,
            deletedAt: null,
        });

        expect(result.description).toBe("Project description");
        expect(result.icon).toBe("folder");
        expect(result.color).toBe("sky");
        expect(result.sortOrder).toBe(3);
        expect(result.aiConfig?.systemPromptMode).toBe("replace");
        expect(result.ragConfig?.contextNotes).toBe("Important docs");
        expect(result.preferences?.pinnedChats).toEqual([projectId]);
    });

    test("CreateProjectInputSchema accepts optional create fields", () => {
        const result = CreateProjectInputSchema.parse({
            workspaceId,
            name: "My Project",
            status: "archived",
            description: "Project description",
            icon: "folder",
            color: "sky",
            sortOrder: 7,
            aiConfig: {
                defaultProvider: "openai",
                systemPromptMode: "append",
            },
            ragConfig: {
                contextFileIds: [projectId],
            },
            preferences: {
                showInSidebar: true,
            },
            metadata: {
                source: "import",
            },
        });

        expect(result.status).toBe("archived");
        expect(result.description).toBe("Project description");
        expect(result.aiConfig?.systemPromptMode).toBe("append");
        expect(result.metadata).toEqual({ source: "import" });
    });

    test("UpdateProjectInputSchema accepts nullable configs and rejects invalid enums", () => {
        const valid = UpdateProjectInputSchema.parse({
            name: "Updated Project",
            status: "active",
            description: null,
            icon: null,
            color: null,
            sortOrder: null,
            aiConfig: null,
            ragConfig: null,
            preferences: null,
            metadata: null,
        });

        expect(valid.aiConfig).toBeNull();
        expect(valid.preferences).toBeNull();

        const invalidStatus = UpdateProjectInputSchema.safeParse({
            status: "paused",
        });
        expect(invalidStatus.success).toBe(false);

        const invalidSystemPromptMode = UpdateProjectInputSchema.safeParse({
            aiConfig: {
                systemPromptMode: "invalid",
            },
        });
        expect(invalidSystemPromptMode.success).toBe(false);
    });
});
