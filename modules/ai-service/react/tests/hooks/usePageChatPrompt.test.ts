import { describe, expect, it } from "vitest";
import type { Page } from "@modules/knowledge/shared/types";
import { tiptapAdapter } from "@modules/knowledge/react/adapters/TiptapAdapter";
import { buildSystemPrompt } from "@modules/knowledge/react/hooks/usePageChat";

function createPage(contentText: string): Page {
  return {
    id: "019c5a37-4b5b-718f-b0db-5d89cf8bc7d1",
    workspace_id: "019c5a37-4b5b-718f-b0db-5d89cf8bc7d2",
    project_id: null,
    parent_id: null,
    is_project_root: false,
    order_key: "a",
    title: "Physics Notes",
    icon: "📄",
    properties_json: {},
    content_engine: "tiptap",
    content_version: 1,
    content_json: {
      engine: "tiptap",
      version: 1,
      data: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: contentText }],
          },
        ],
      },
    },
    revision: 1,
    created_at: new Date("2026-02-14T10:00:00.000Z"),
    updated_at: new Date("2026-02-14T10:00:00.000Z"),
    deleted_at: null,
  };
}

describe("Knowledge page chat prompt", () => {
  it("renders markdown synchronously and never injects [object Promise]", () => {
    const page = createPage("Newton's first law states that inertia resists changes in motion.");
    const markdown = tiptapAdapter.renderToMarkdown(page.content_json.data, {
      excludeImages: true,
    });

    expect(typeof markdown).toBe("string");

    const prompt = buildSystemPrompt(page);
    expect(prompt).toContain("Newton's first law");
    expect(prompt).not.toContain("[object Promise]");
  });

  it("uses chunked context for large pages and includes query-relevant sections", () => {
    const largeText = Array.from({ length: 260 })
      .map((_, index) => {
        const topic = index % 7 === 0 ? "quantum entanglement" : "classical mechanics";
        return `Section ${index + 1}: ${topic} with supporting explanation and examples.`;
      })
      .join("\n\n");

    const page = createPage(largeText);
    const prompt = buildSystemPrompt(page, {
      userQuery: "explain quantum entanglement simply",
    });

    expect(prompt).toContain("SELECTED CONTEXT CHUNKS");
    expect(prompt).toContain("quantum entanglement");
    expect(prompt).toContain("Additional content omitted");
  });
});
