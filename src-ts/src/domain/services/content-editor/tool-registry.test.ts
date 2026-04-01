import { describe, expect, test } from "bun:test";
import { EDIT_CONTENT_TOOL } from "../tools/edit-content-tool";
import { KNOWLEDGE_CREATE_PAGE_TOOL } from "../tools/knowledge-create-page-tool";

const editParameters = EDIT_CONTENT_TOOL.function.parameters as {
  type: string;
  properties: Record<string, { enum?: string[] } & Record<string, unknown>>;
  required?: string[];
};

const knowledgeParameters = KNOWLEDGE_CREATE_PAGE_TOOL.function.parameters as {
  type: string;
  properties: Record<string, unknown>;
  required?: string[];
};

describe("content editor tool definitions", () => {
  describe("EDIT_CONTENT_TOOL", () => {
    test("exports the edit_content function with required modes", () => {
      expect(EDIT_CONTENT_TOOL.type).toBe("function");
      expect(EDIT_CONTENT_TOOL.function.name).toBe("edit_content");
      expect(editParameters.type).toBe("object");

      expect(editParameters.required).toEqual(["mode"]);
      expect(editParameters).toHaveProperty("anyOf");
      expect(editParameters.properties.mode.enum).toEqual([
        "replace",
        "append",
        "generate",
        "selection",
      ]);
    });

    test("exposes expected target_type options and content metadata", () => {
      expect(editParameters.properties.target_type.enum).toEqual([
        "knowledge.page",
        "brainstorming.node",
        "writer.document",
      ]);
      expect(editParameters.properties.content).toBeDefined();
      expect(editParameters.properties.instruction).toBeDefined();
    });
  });

  describe("KNOWLEDGE_CREATE_PAGE_TOOL", () => {
    test("defines workspace scope and required title", () => {
      expect(KNOWLEDGE_CREATE_PAGE_TOOL.type).toBe("function");
      expect(KNOWLEDGE_CREATE_PAGE_TOOL.function.name).toBe("knowledge_create_page");
      expect(knowledgeParameters.type).toBe("object");
      expect(knowledgeParameters.required).toEqual(["title"]);
    });

    test("includes optional positioning and content properties", () => {
      const keys = Object.keys(knowledgeParameters.properties);
      expect(keys).toEqual(
        expect.arrayContaining([
          "content_markdown",
        ]),
      );
      expect(keys).not.toEqual(
        expect.arrayContaining([
          "workspace_id",
          "project_id",
          "parent_id",
          "after_sibling_id",
        ]),
      );
      expect(knowledgeParameters.properties.content_markdown).toBeDefined();
    });
  });
});
