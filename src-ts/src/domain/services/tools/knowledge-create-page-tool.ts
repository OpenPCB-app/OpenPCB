import type { ToolDefinition } from "../../../infrastructure/ai-providers/engine";

export const KNOWLEDGE_CREATE_PAGE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "knowledge_create_page",
    description: `USE THIS TOOL when the user asks you to create a new knowledge page, document, or note. DO NOT just describe creating a page - actually invoke this tool to create it. Creates a Knowledge workspace page with the specified title and optional content.`,

    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title of the new page.",
        },
        content_markdown: {
          type: "string",
          description: "Optional Markdown content to populate the new page's body.",
        },
      },
      required: ["title"],
    },
  },
};
