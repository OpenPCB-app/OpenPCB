/**
 * Parity with the in-app assistant for MCP clients: Definition-of-Done build
 * verification and knowledge (Docs) pages.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { bootMcpHarness, type McpHarness } from "./helpers/mcp-harness";

let h: McpHarness;

beforeAll(async () => {
  h = await bootMcpHarness("assistant-mcp-parity");
});

interface DodData {
  status: string;
  failing: string[];
  checks: Array<{ id: string; passed: boolean; message: string }>;
}

describe("designer_verify_build", () => {
  test("checks the build against the BOM this session resolved", async () => {
    h.enable({ writes: true });
    const bom = await h.callTool("library_resolve_bom", {
      goal: "One pull-up resistor",
      items: [{ role: "pull-up resistor", query: "resistor", quantity: 1 }],
    });
    expect(bom.structuredContent.ok).toBe(true);

    const created = await h.callTool("designer_create_design", { name: "Verify me" });
    const designId = (created.structuredContent.data as { design: { id: string } }).design.id;

    const before = await h.callTool("designer_verify_build", { designId });
    const beforeData = before.structuredContent.data as DodData;
    expect(beforeData.failing).toContain("bom_placed");
    expect(before.structuredContent.summary).toContain("bom_placed");

    const componentId = (
      bom.structuredContent.data as {
        items: Array<{ selected?: { componentId: string } }>;
      }
    ).items[0]?.selected?.componentId;
    expect(componentId).toBeTruthy();
    await h.callTool("designer_place_components", {
      designId,
      components: [{ componentId, quantity: 1 }],
    });

    const after = await h.callTool("designer_verify_build", { designId });
    const afterData = after.structuredContent.data as DodData;
    expect(afterData.failing).not.toContain("bom_placed");
  });

  test("without a resolved BOM it still runs ERC", async () => {
    h.enable({ writes: true });
    const created = await h.callTool("designer_create_design", { name: "No intent" });
    const designId = (created.structuredContent.data as { design: { id: string } }).design.id;
    const result = await h.callTool("designer_verify_build", { designId }, {
      "x-openpcb-mcp-instance": "fresh-instance",
    });
    expect(result.structuredContent.ok).toBe(true);
    expect((result.structuredContent.data as DodData).checks.length).toBe(4);
  });
});

describe("knowledge pages", () => {
  test("search and read a Docs page as markdown", async () => {
    h.enable();
    const response = await h.fetch("/api/modules/knowledge/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Power budget notes",
        content: {
          engine: "tiptap",
          version: 1,
          data: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "The 3V3 rail must stay under 500 mA." }],
              },
            ],
          },
        },
      }),
    });
    expect(response.status).toBe(201);

    const search = await h.callTool("knowledge_search_pages", { query: "Power budget" });
    const pages = (search.structuredContent.data as { pages: Array<{ id: string; title: string }> }).pages;
    expect(pages.map((p) => p.title)).toContain("Power budget notes");

    const page = await h.callTool("knowledge_get_page", { pageId: pages[0]!.id });
    expect(page.structuredContent.ok).toBe(true);
    expect((page.structuredContent.data as { markdown: string }).markdown).toContain("500 mA");

    const missing = await h.callTool("knowledge_get_page", { pageId: "nope" });
    expect(missing.structuredContent.ok).toBe(false);
  });
});
