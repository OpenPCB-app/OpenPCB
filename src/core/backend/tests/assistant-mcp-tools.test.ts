/**
 * MCP server behaviour against the real runtime (designer + library +
 * assistant): result envelope, per-design chats, call recording, targeting,
 * proposals. See docs/assistant/mcp-claude-code.md §1 for the findings these
 * lock down.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { getAssistantService } from "../../../modules/assistant/backend/assistant-service";
import { MCP_SERVER_INSTRUCTIONS } from "../../../modules/assistant/backend/mcp/instructions";
import {
  MAX_DESCRIPTION_CHARS,
  MCP_TOOL_POLICIES,
} from "../../../modules/assistant/backend/mcp/tool-policy";
import {
  bootMcpHarness,
  MCP_TOKEN,
  type McpHarness,
} from "./helpers/mcp-harness";

let h: McpHarness;

beforeAll(async () => {
  h = await bootMcpHarness("assistant-mcp-tools");
});

const INSTANCE_B = { "x-openpcb-mcp-instance": "instance-b" };

function mcpChats() {
  return getAssistantService()
    .conversation.listChats()
    .filter((chat) => Boolean((chat.metadata as { mcp?: unknown } | null)?.mcp));
}

async function createDesign(name: string): Promise<string> {
  const result = await h.callTool("designer_create_design", { name });
  expect(result.structuredContent.ok).toBe(true);
  const data = result.structuredContent.data as { design?: { id?: string } };
  const id = data.design?.id;
  expect(typeof id).toBe("string");
  return id!;
}

async function summaryDesignId(headers?: Record<string, string>): Promise<string> {
  const result = await h.callTool("designer_get_design_summary", {}, headers);
  expect(result.structuredContent.ok).toBe(true);
  const data = result.structuredContent.data as {
    design?: { id?: string };
    designId?: string;
  };
  return (data.design?.id ?? data.designId)!;
}

describe("MCP tool surface", () => {
  test("every write tool declares an MCP policy entry", async () => {
    h.enable({ writes: true });
    const tools = await h.listTools();
    const writes = tools.filter(
      (t) => (t.annotations as { readOnlyHint?: boolean }).readOnlyHint === false,
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const tool of writes) {
      if (tool.name === "designer_use_design") continue;
      expect(Object.keys(MCP_TOOL_POLICIES)).toContain(tool.name as string);
    }
    const deletions = tools.find(
      (t) => t.name === "designer_propose_schematic_deletions",
    );
    expect(
      (deletions?.annotations as { destructiveHint?: boolean }).destructiveHint,
    ).toBe(true);
  });

  test("descriptions and instructions fit Claude Code's 2 KB cap", async () => {
    h.enable({ writes: true });
    const tools = await h.listTools();
    for (const tool of tools) {
      expect((tool.description as string).length).toBeLessThanOrEqual(
        MAX_DESCRIPTION_CHARS,
      );
    }
    expect(MCP_SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(2_000);
    const init = await h.rpc({
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "Claude Code", version: "2.1.0" },
      },
    });
    const result = init.result as {
      instructions?: string;
      capabilities: { tools?: { listChanged?: boolean } };
    };
    expect(result.instructions).toBe(MCP_SERVER_INSTRUCTIONS);
    expect(result.capabilities.tools?.listChanged).toBe(true);
  });

  test("instructions only name tools the server actually lists", async () => {
    h.enable({ writes: true });
    const names = new Set((await h.listTools()).map((t) => t.name as string));
    const mentioned = MCP_SERVER_INSTRUCTIONS.match(
      /\b(?:designer|library|pcb|assistant|knowledge)_[a-z_]+|\bcompile_circuit\b/g,
    );
    for (const name of new Set(mentioned ?? [])) {
      expect(names.has(name)).toBe(true);
    }
  });
});

describe("result envelope", () => {
  test("a failing read carries a readable error in both result halves", async () => {
    h.enable();
    const result = await h.callTool("designer_get_pcb_state", {
      designId: "no-such-design",
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.ok).toBe(false);
    expect(result.structuredContent.error?.message).toContain("not found");
    expect(result.structuredContent.summary).toContain("not found");
    expect(result.content[0]?.text).toContain("not found");
  });

  test("a successful read carries summary and data together", async () => {
    h.enable();
    const result = await h.callTool("designer_list_designs");
    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.summary.length).toBeGreaterThan(0);
    expect(result.structuredContent.data).toBeTruthy();
    expect(result.content[0]?.text).toContain(result.structuredContent.summary);
  });
});

describe("design targeting and chats", () => {
  test("create_design works repeatedly and pins each new design", async () => {
    h.enable({ writes: true });
    const first = await createDesign("MCP first");
    expect(await summaryDesignId()).toBe(first);
    const second = await createDesign("MCP second");
    expect(second).not.toBe(first);
    expect(await summaryDesignId()).toBe(second);
  });

  test("two instances keep separate pins", async () => {
    h.enable({ writes: true });
    const a = await createDesign("Pin A");
    const b = await createDesign("Pin B");
    await h.callTool("designer_use_design", { designId: a });
    await h.callTool("designer_use_design", { designId: b }, INSTANCE_B);
    expect(await summaryDesignId()).toBe(a);
    expect(await summaryDesignId(INSTANCE_B)).toBe(b);
  });

  test("each design gets one bound chat that the design dock lists", async () => {
    h.enable({ writes: true });
    const id = await createDesign("Dock listed");
    await h.callTool("designer_get_design_summary", { designId: id });
    await h.callTool("designer_get_design_summary", { designId: id }, INSTANCE_B);

    const chats = mcpChats().filter(
      (chat) => (chat.metadata as { designId?: string }).designId === id,
    );
    expect(chats).toHaveLength(1);
    const primary = getAssistantService().contextResolver.getPrimaryDesign(
      chats[0]!.id,
    );
    expect(primary?.refId).toBe(id);

    const response = await h.fetch(
      `/api/modules/assistant/design-chats?designId=${encodeURIComponent(id)}`,
    );
    const body = (await response.json()) as
      | Array<{ id: string }>
      | { chats?: Array<{ id: string }> };
    const listed = Array.isArray(body) ? body : (body.chats ?? []);
    expect(listed.map((c) => c.id)).toContain(chats[0]!.id);
  });

  test("the home chat stays unbound", async () => {
    h.enable({ writes: true });
    await createDesign("Home stays clean");
    await h.callTool("library_search_components", { query: "resistor" });
    const home = mcpChats().filter(
      (chat) =>
        (chat.metadata as { mcp?: { role?: string } }).mcp?.role === "home",
    );
    expect(home.length).toBeGreaterThan(0);
    for (const chat of home) {
      expect(
        getAssistantService().contextResolver.getPrimaryDesign(chat.id),
      ).toBeUndefined();
    }
  });
});

describe("call recording", () => {
  test("each call becomes a tool event on a visible activity message", async () => {
    h.enable({ writes: true });
    const id = await createDesign("Recorded");
    await h.callTool("designer_get_design_summary", { designId: id });
    const chat = mcpChats().find(
      (c) => (c.metadata as { designId?: string }).designId === id,
    )!;
    const conversation = getAssistantService().conversation;
    const messages = conversation.listMessages(chat.id, { limit: 50 }).items;
    const activity = messages.filter(
      (m) => (m.metadata as { mcp?: { activity?: boolean } } | null)?.mcp?.activity,
    );
    expect(activity.length).toBeGreaterThan(0);
    expect(activity.at(-1)!.content).toContain("designer_get_design_summary");
    const events = conversation.listToolEvents(chat.id, {
      messageIds: activity.map((m) => m.id),
    });
    expect(events.some((e) => e.toolName === "designer_get_design_summary")).toBe(
      true,
    );
    expect(events.every((e) => e.status === "succeeded")).toBe(true);
  });
});

describe("proposals", () => {
  test("a deletion stays pending, returns its id, and renders in the design chat", async () => {
    h.enable({ writes: true });
    const designId = await createDesign("Deletion target");

    const search = await h.callTool("library_search_components", {
      query: "resistor",
      limit: 5,
    });
    const hits = JSON.stringify(search.structuredContent.data);
    const componentId = /"componentId":"([^"]+)"/.exec(hits)?.[1] ??
      /"id":"([^"]+)"/.exec(hits)?.[1];
    expect(componentId).toBeTruthy();

    const placed = await h.callTool("designer_place_components", {
      designId,
      components: [{ componentId, quantity: 1 }],
    });
    expect(placed.structuredContent.ok).toBe(true);

    const projection = await h.designer.getSchematicProjection(designId);
    const partId = projection?.parts[0]?.id;
    expect(partId).toBeTruthy();

    const result = await h.callTool("designer_propose_schematic_deletions", {
      designId,
      title: "Remove the resistor",
      summary: "Delete the only placed part.",
      entities: [{ entityId: partId, entityKind: "part" }],
    });
    const proposal = result.structuredContent.proposal;
    expect(proposal?.status).toBe("pending");
    expect(proposal?.riskLevel).toBe("destructive");
    expect(proposal?.approvalHint).toContain("approve");

    const chat = mcpChats().find(
      (c) => (c.metadata as { designId?: string }).designId === designId,
    )!;
    const conversation = getAssistantService().conversation;
    expect(conversation.getWriteProposal(chat.id, proposal!.id)?.status).toBe(
      "pending",
    );
    // The card renders from a succeeded tool event whose result is {id, kind}.
    const events = conversation.listToolEvents(chat.id);
    const card = events.find(
      (e) => e.toolName === "designer_propose_schematic_deletions",
    );
    expect(card?.status).toBe("succeeded");
    const parsed = JSON.parse(card!.resultJson!) as { id: string; kind: string };
    expect(parsed.id).toBe(proposal!.id);
    // Nothing was deleted.
    expect((await h.designer.getSchematicProjection(designId))?.parts.length).toBe(1);
  });
});

describe("shim support routes", () => {
  test("mcp-state is bearer-gated and fingerprints the tool set", async () => {
    const unauthorized = await h.fetch("/api/modules/assistant/mcp-state");
    expect(unauthorized.status).toBe(401);

    h.enable({ writes: false });
    const read = (await (
      await h.fetch("/api/modules/assistant/mcp-state", {
        headers: { authorization: `Bearer ${MCP_TOKEN}` },
      })
    ).json()) as { enabled: boolean; allowWrites: boolean; toolset: string };
    expect(read.enabled).toBe(true);
    expect(read.allowWrites).toBe(false);

    h.enable({ writes: true });
    const write = (await (
      await h.fetch("/api/modules/assistant/mcp-state", {
        headers: { authorization: `Bearer ${MCP_TOKEN}` },
      })
    ).json()) as { toolset: string };
    expect(write.toolset).not.toBe(read.toolset);
  });

  test("connected clients are listed for the Settings panel", async () => {
    h.enable();
    await h.callTool("designer_list_designs", {}, INSTANCE_B);
    const body = (await (
      await h.fetch("/api/modules/assistant/mcp/clients")
    ).json()) as { clients: Array<{ instanceId: string; clientName: string }> };
    const b = body.clients.find((c) => c.instanceId === "instance-b");
    expect(b?.clientName).toBe("Claude Code");
  });
});

describe("resolve_design", () => {
  test("resolving a design that already has a chat keeps one chat per design", async () => {
    h.enable({ writes: true });
    const id = await createDesign("Resolve me uniquely");
    await h.callTool("designer_get_design_summary", { designId: id });
    const resolved = await h.callTool("designer_resolve_design", {
      query: "Resolve me uniquely",
    });
    expect(resolved.structuredContent.ok).toBe(true);
    const chats = mcpChats().filter(
      (chat) => (chat.metadata as { designId?: string }).designId === id,
    );
    expect(chats).toHaveLength(1);
    // resolve pins the design for this session.
    expect(await summaryDesignId()).toBe(id);
  });
});
