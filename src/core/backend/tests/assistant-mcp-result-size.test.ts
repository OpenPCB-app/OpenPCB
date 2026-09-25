/**
 * Result and audit size: the text half of a result is bounded (the complete
 * data stays in structuredContent), big reads page, and the chat database
 * stores full results only where the panel renders them.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { getAssistantService } from "../../../modules/assistant/backend/assistant-service";
import {
  MAX_STORED_RESULT_CHARS,
  storedArgumentsJson,
  storedResultJson,
} from "../../../modules/assistant/backend/mcp/call-recorder";
import {
  MAX_TEXT_CHARS,
  sliceCodePoints,
  toCallToolResult,
} from "../../../modules/assistant/backend/mcp/result-envelope";
import { bootMcpHarness, type McpHarness } from "./helpers/mcp-harness";

let h: McpHarness;

beforeAll(async () => {
  h = await bootMcpHarness("assistant-mcp-result-size");
});

describe("what the chat database keeps", () => {
  const big = JSON.stringify({ rows: Array.from({ length: 2_000 }, (_, i) => ({ i, name: `row ${i}` })) });

  test("large reads become a digest; small ones and panel-rendered ones stay whole", () => {
    const stored = JSON.parse(storedResultJson("designer_get_pcb_layout", big)!) as {
      digest: boolean;
      bytes: number;
      sha256: string;
      preview: string;
    };
    expect(stored.digest).toBe(true);
    expect(stored.bytes).toBe(big.length);
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.preview.length).toBeLessThanOrEqual(2_000);
    expect(storedResultJson("designer_run_erc", "{\"ok\":1}")).toBe("{\"ok\":1}");
    expect(storedResultJson("library_search_components", big)).toBe(big);
  });

  test("proposal results keep only what the card joins on", () => {
    const envelope = JSON.stringify({
      id: "p1",
      kind: "designer_pcb_route_batch",
      designId: "d1",
      baseRevision: 4,
      operations: Array.from({ length: 500 }, (_, i) => ({ id: `op${i}`, payload: { big: "x".repeat(50) } })),
    });
    expect(JSON.parse(storedResultJson("pcb_route", envelope)!)).toEqual({
      id: "p1",
      kind: "designer_pcb_route_batch",
      designId: "d1",
      baseRevision: 4,
    });
  });

  test("arguments are bounded too", () => {
    expect(storedArgumentsJson("{}")).toBe("{}");
    expect(JSON.parse(storedArgumentsJson(big)).digest).toBe(true);
  });

  test("over MCP: a layout read is stored as a digest, a library search stays renderable", async () => {
    h.enable({ writes: true });
    const created = await h.callTool("designer_create_design", { name: "Audit size" });
    const designId = (created.structuredContent.data as { design: { id: string } }).design.id;
    await h.callTool("designer_place_components", {
      designId,
      components: [{ componentId: "openpcb.core.passive.resistor", quantity: 30 }],
    });
    await h.callTool("designer_get_pcb_layout", { designId });
    await h.callTool("library_search_components", { query: "resistor" });
    const conversation = getAssistantService().conversation;
    const events = conversation
      .listChats()
      .filter((c) => Boolean((c.metadata as { mcp?: unknown } | null)?.mcp))
      .flatMap((c) => conversation.listToolEvents(c.id));
    const layout = events.find((e) => e.toolName === "designer_get_pcb_layout")!;
    expect(layout.resultJson!.length).toBeLessThan(MAX_STORED_RESULT_CHARS);
    const search = events.find((e) => e.toolName === "library_search_components")!;
    expect(Array.isArray((JSON.parse(search.resultJson!) as { results?: unknown[] }).results)).toBe(true);
  });
});

describe("what the model is sent", () => {
  test("the text half is bounded and never splits a character; structuredContent is complete", () => {
    const data = { text: "😀".repeat(MAX_TEXT_CHARS) };
    const result = toCallToolResult({
      ok: true,
      status: "ok",
      summary: "Big.",
      warnings: [],
      truncated: false,
      data,
    });
    const text = result.content[0]!.text;
    expect(text.length).toBeLessThan(MAX_TEXT_CHARS + 300);
    expect(text).toContain("complete result is in structuredContent");
    expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(result.structuredContent.data).toEqual(data);
    expect(sliceCodePoints("a😀", 2)).toBe("a");
  });

  test("the PCB layout pages its footprints", async () => {
    h.enable({ writes: true });
    const created = await h.callTool("designer_create_design", { name: "Paged layout" });
    const designId = (created.structuredContent.data as { design: { id: string } }).design.id;
    await h.callTool("designer_place_components", {
      designId,
      components: [{ componentId: "openpcb.core.passive.resistor", quantity: 3 }],
    });
    const first = await h.callTool("designer_get_pcb_layout", { designId, limit: 2 });
    const page = (first.structuredContent.data as { page: { total: number; nextOffset: number | null } }).page;
    expect(page).toEqual({ offset: 0, limit: 2, total: 3, nextOffset: 2 } as never);
    expect(first.structuredContent.summary).toContain("offset 2");
    const second = await h.callTool("designer_get_pcb_layout", { designId, limit: 2, offset: 2 });
    const rest = second.structuredContent.data as { placements: unknown[]; page: { nextOffset: number | null } };
    expect(rest.placements).toHaveLength(1);
    expect(rest.page.nextOffset).toBeNull();
  });
});
