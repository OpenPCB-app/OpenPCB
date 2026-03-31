import { describe, it, expect } from "vitest";
import {
  ChatInterfacePresets,
  createEmbeddedChat,
  createProjectChat,
  createModuleChat,
} from "./index";
import type { ProjectRecord } from "@shared/types";

function makeProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "proj-1",
    workspaceId: "ws-1",
    name: "Test Project",
    status: "active" as const,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ChatInterfacePresets", () => {
  describe("main preset", () => {
    it("has full mode", () => {
      expect(ChatInterfacePresets.main.ui.mode).toBe("full");
    });

    it("has tools enabled", () => {
      expect(ChatInterfacePresets.main.features.tools.enabled).toBe(true);
    });

    it("has attachments enabled", () => {
      expect(ChatInterfacePresets.main.features.attachments.enabled).toBe(true);
    });

    it("has autoFocus enabled", () => {
      expect(ChatInterfacePresets.main.behavior.autoFocus).toBe(true);
    });

    it("matches snapshot", () => {
      expect(ChatInterfacePresets.main).toMatchSnapshot();
    });
  });

  describe("embedded preset", () => {
    it("has embedded mode", () => {
      expect(ChatInterfacePresets.embedded.ui.mode).toBe("embedded");
    });

    it("has compact density", () => {
      expect(ChatInterfacePresets.embedded.ui.density).toBe("compact");
    });

    it("has tools disabled", () => {
      expect(ChatInterfacePresets.embedded.features.tools.enabled).toBe(false);
    });

    it("has attachments disabled", () => {
      expect(ChatInterfacePresets.embedded.features.attachments.enabled).toBe(false);
    });

    it("has autoFocus disabled", () => {
      expect(ChatInterfacePresets.embedded.behavior.autoFocus).toBe(false);
    });

    it("matches snapshot", () => {
      expect(ChatInterfacePresets.embedded).toMatchSnapshot();
    });
  });

  describe("project preset", () => {
    it("has full mode", () => {
      expect(ChatInterfacePresets.project.ui.mode).toBe("full");
    });

    it("has tools enabled", () => {
      expect(ChatInterfacePresets.project.features.tools.enabled).toBe(true);
    });

    it("matches snapshot", () => {
      expect(ChatInterfacePresets.project).toMatchSnapshot();
    });
  });

  describe("module preset", () => {
    it("has embedded mode", () => {
      expect(ChatInterfacePresets.module.ui.mode).toBe("embedded");
    });

    it("has compact density", () => {
      expect(ChatInterfacePresets.module.ui.density).toBe("compact");
    });

    it("has tools disabled", () => {
      expect(ChatInterfacePresets.module.features.tools.enabled).toBe(false);
    });

    it("matches snapshot", () => {
      expect(ChatInterfacePresets.module).toMatchSnapshot();
    });
  });
});

describe("createEmbeddedChat", () => {
  it("returns valid config with embedded defaults", () => {
    const config = createEmbeddedChat();
    expect(config.ui?.mode).toBe("embedded");
    expect(config.ui?.density).toBe("compact");
    expect(config.features?.tools?.enabled).toBe(false);
  });

  it("adds maxHeight class when specified", () => {
    const config = createEmbeddedChat({ maxHeight: "400px" });
    expect(config.className).toContain("max-h-[400px]");
  });

  it("merges overrides correctly", () => {
    const config = createEmbeddedChat({
      overrides: {
        ui: { placeholder: "Custom placeholder" },
      },
    });
    expect(config.ui?.placeholder).toBe("Custom placeholder");
    expect(config.ui?.mode).toBe("embedded");
  });
});

describe("createProjectChat", () => {
  it("merges projectContext into config", () => {
    const project = makeProject({ name: "My Project" });
    const config = createProjectChat({
      projectId: "proj-1",
      projectContext: project,
      onBack: () => {},
    });
    expect(config.projectContext).toBe(project);
    expect(config.context?.projectId).toBe("proj-1");
  });

  it("includes onBack in behavior", () => {
    const onBack = () => {};
    const config = createProjectChat({
      projectId: "proj-1",
      projectContext: makeProject(),
      onBack,
    });
    expect(config.behavior?.onBack).toBe(onBack);
  });

  it("uses project preset defaults", () => {
    const config = createProjectChat({
      projectId: "proj-1",
      projectContext: makeProject(),
      onBack: () => {},
    });
    expect(config.ui?.mode).toBe("full");
    expect(config.features?.tools?.enabled).toBe(true);
  });

  it("merges overrides correctly", () => {
    const config = createProjectChat({
      projectId: "proj-1",
      projectContext: makeProject(),
      onBack: () => {},
      overrides: {
        ui: { placeholder: "Ask about this project..." },
      },
    });
    expect(config.ui?.placeholder).toBe("Ask about this project...");
  });
});

describe("createModuleChat", () => {
  it("includes moduleId in context", () => {
    const config = createModuleChat({
      moduleId: "brainstorming",
      spaceId: "space-1",
    });
    expect(config.context?.moduleId).toBe("brainstorming");
    expect(config.context?.spaceId).toBe("space-1");
  });

  it("includes allowedTools in features", () => {
    const config = createModuleChat({
      moduleId: "brainstorming",
      spaceId: "space-1",
      allowedTools: ["search", "summarize"],
    });
    expect(config.features?.tools?.allowedTools).toEqual(["search", "summarize"]);
  });

  it("includes systemPrompt in context", () => {
    const config = createModuleChat({
      moduleId: "brainstorming",
      spaceId: "space-1",
      systemPrompt: "You are a brainstorming assistant",
    });
    expect(config.context?.systemPrompt).toBe("You are a brainstorming assistant");
  });

  it("uses module preset defaults", () => {
    const config = createModuleChat({
      moduleId: "brainstorming",
      spaceId: "space-1",
    });
    expect(config.ui?.mode).toBe("embedded");
    expect(config.ui?.density).toBe("compact");
    expect(config.features?.tools?.enabled).toBe(false);
  });

  it("merges overrides correctly", () => {
    const config = createModuleChat({
      moduleId: "brainstorming",
      spaceId: "space-1",
      overrides: {
        features: { tools: { enabled: true } },
      },
    });
    expect(config.features?.tools?.enabled).toBe(true);
  });
});
