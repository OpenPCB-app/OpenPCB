/**
 * Isolation between concurrent MCP sessions of the SAME client (same client
 * key, different instance id — two Claude Code sessions on one machine).
 * Ownership is the proposing session, never the chat: undo, proposal
 * visibility, session allowances and chat binding must not leak across.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { getAssistantService } from "../../../modules/assistant/backend/assistant-service";
import { bootMcpHarness, type McpHarness } from "./helpers/mcp-harness";

let h: McpHarness;

const A = { "x-openpcb-mcp-instance": "session-a" };
const B = { "x-openpcb-mcp-instance": "session-b" };
const RESISTOR = "openpcb.core.passive.resistor";

beforeAll(async () => {
  h = await bootMcpHarness("assistant-mcp-sessions");
});

async function createDesign(name: string, headers = A): Promise<string> {
  const result = await h.callTool("designer_create_design", { name }, headers);
  expect(result.structuredContent.ok).toBe(true);
  return (result.structuredContent.data as { design: { id: string } }).design.id;
}

async function placeResistor(designId: string, headers: Record<string, string>): Promise<void> {
  const result = await h.callTool(
    "designer_place_components",
    { designId, components: [{ componentId: RESISTOR, quantity: 1 }] },
    headers,
  );
  expect(result.structuredContent.ok).toBe(true);
}

function sessionChat(designId: string, instanceId: string) {
  return getAssistantService()
    .conversation.listChats()
    .find((chat) => {
      const meta = chat.metadata as { designId?: string; mcp?: { instanceId?: string } } | null;
      return meta?.designId === designId && meta.mcp?.instanceId === instanceId;
    });
}

async function proposeDeletion(designId: string, headers: Record<string, string>) {
  const projection = await h.designer.getSchematicProjection(designId);
  const partId = projection!.parts[projection!.parts.length - 1]!.id;
  return h.callTool(
    "designer_propose_schematic_deletions",
    {
      designId,
      title: "Remove a resistor",
      summary: "Delete the last placed part.",
      entities: [{ entityId: partId, entityKind: "part" }],
    },
    headers,
  );
}

describe("undo ownership is per session", () => {
  test("A cannot undo B's newer change; B can; then A can undo its own", async () => {
    h.enable({ writes: true });
    const designId = await createDesign("Undo isolation");
    await placeResistor(designId, A);
    await placeResistor(designId, B);

    const refused = await h.callTool("designer_undo", { designId }, A);
    expect(refused.structuredContent.ok).toBe(false);
    expect(refused.structuredContent.summary).toContain("not made by this session");

    const own = await h.callTool("designer_undo", { designId }, B);
    expect(own.structuredContent.ok).toBe(true);

    // B's placement is undone; the top of the stack is A's placement now.
    const later = await h.callTool("designer_undo", { designId }, A);
    expect(later.structuredContent.ok).toBe(true);
  });
});

describe("proposals are visible only to the session that made them", () => {
  test("B cannot get, list or await A's pending proposal", async () => {
    h.enable({ writes: true });
    const designId = await createDesign("Proposal isolation");
    await placeResistor(designId, A);
    const pending = await proposeDeletion(designId, A);
    const proposalId = pending.structuredContent.proposal!.id;
    expect(pending.structuredContent.proposal!.status).toBe("pending");

    const got = await h.callTool("assistant_get_proposal", { proposalId }, B);
    expect(got.isError).toBe(true);
    const awaited = await h.callTool(
      "assistant_await_proposal",
      { proposalId, timeoutSeconds: 1 },
      B,
    );
    expect(awaited.isError).toBe(true);
    const listedB = await h.callTool("assistant_list_pending_proposals", { designId }, B);
    expect((listedB.structuredContent.data as { proposals: unknown[] }).proposals).toHaveLength(0);

    const listedA = await h.callTool("assistant_list_pending_proposals", { designId }, A);
    const mine = (listedA.structuredContent.data as { proposals: Array<{ id: string }> }).proposals;
    expect(mine.map((p) => p.id)).toContain(proposalId);
    const ownGet = await h.callTool("assistant_get_proposal", { proposalId }, A);
    expect(ownGet.structuredContent.ok).toBe(true);
  });
});

describe("session allowances do not leak", () => {
  test("A's 'allow this tool this session' does not auto-apply B's deletion", async () => {
    h.enable({ writes: true });
    const designId = await createDesign("Allowance isolation");
    await placeResistor(designId, A);
    await placeResistor(designId, A);
    await h.callTool("designer_get_design_summary", { designId }, B);

    const chatA = sessionChat(designId, "session-a")!;
    const allow = await h.fetch(
      `/api/modules/assistant/chats/${chatA.id}/write-policy/session-allow`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolName: "designer_propose_schematic_deletions",
          proposalKind: "designer_schematic_deletions",
          riskLevel: "destructive",
        }),
      },
    );
    expect(allow.status).toBe(201);

    const fromB = await proposeDeletion(designId, B);
    expect(fromB.structuredContent.proposal!.status).toBe("pending");

    const fromA = await proposeDeletion(designId, A);
    expect(fromA.structuredContent.proposal!.status).toBe("applied");
  });
});

describe("chat binding under concurrency", () => {
  function primaryCounts(): number[] {
    const service = getAssistantService();
    return service.conversation
      .listChats()
      .filter((chat) => Boolean((chat.metadata as { mcp?: unknown } | null)?.mcp))
      .map(
        (chat) =>
          service.conversation
            .listBindings(chat.id)
            .filter((b) => b.role === "primary" && b.status === "active" && b.kind === "design")
            .length,
      );
  }

  test("two sessions creating designs at once each get their own chat and pin", async () => {
    h.enable({ writes: true });
    const [a, b] = await Promise.all([
      createDesign("Concurrent A", A),
      createDesign("Concurrent B", B),
    ]);
    expect(a).not.toBe(b);
    for (const count of primaryCounts()) expect(count).toBeLessThanOrEqual(1);
    expect(sessionChat(a, "session-a")).toBeTruthy();
    expect(sessionChat(b, "session-b")).toBeTruthy();
    expect(sessionChat(a, "session-b")).toBeUndefined();

    // Each session's pin follows its own create.
    const summaryA = await h.callTool("designer_get_design_summary", {}, A);
    const summaryB = await h.callTool("designer_get_design_summary", {}, B);
    expect(JSON.stringify(summaryA.structuredContent.data)).toContain(a);
    expect(JSON.stringify(summaryB.structuredContent.data)).toContain(b);
  });

  test("one session resolving two designs in parallel never double-binds a chat", async () => {
    h.enable({ writes: true });
    await createDesign("Parallel Resolve One", B);
    await createDesign("Parallel Resolve Two", B);
    const C = { "x-openpcb-mcp-instance": "session-c" };
    await Promise.all([
      h.callTool("designer_resolve_design", { query: "Parallel Resolve One" }, C),
      h.callTool("designer_resolve_design", { query: "Parallel Resolve Two" }, C),
    ]);
    for (const count of primaryCounts()) expect(count).toBeLessThanOrEqual(1);
  });
});
