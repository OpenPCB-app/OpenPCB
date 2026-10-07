import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isolatedDomain, openDomain, UI_SESSION, type ParityDomain } from "./fixtures/assistant-parity/domain";
import { installProvider, runTurns, waitForTask, waitUntil } from "./fixtures/assistant-parity/provider";

let domain: ParityDomain;
beforeEach(async () => { domain = await isolatedDomain(); });
afterEach(async () => { await domain?.close(); });

describe("OPENPCB-112 Stop and replay parity", () => {
  test("Stop prevents next work, retains committed parts and durable replay after reopen", async () => {
    const design = await domain.designer.createDesign({ name: "Stop and reconnect" });
    const chat = await domain.service.createDesignChat({ designId: design.id });
    const client = installProvider(domain, [
      { calls: [{ id: "before-stop", name: "designer_place_components", arguments: {
        action_id: `place_stop_${design.id}`, components: [{ componentId: domain.componentId }],
      } }] },
      { waitForStop: true },
      { calls: [{ id: "after-stop", name: "designer_place_components", arguments: {
        action_id: `place_afterstop_${design.id}`, components: [{ componentId: domain.componentId }],
      } }] },
    ]);
    const submission = await domain.service.submitMessage(chat.id, { content: "Place one capacitor, then wait." });
    await waitUntil(() => client.requests.length === 2);
    expect((await domain.designer.getSchematicProjection(design.id))!.parts).toHaveLength(1);
    await domain.tasks.cancelTask(submission.taskId);
    expect((await waitForTask(domain, submission.taskId)).status).toBe("cancelled");
    await waitUntil(() => domain.service.conversation.getMessage(submission.assistantMessage.id)?.metadata !== null);
    const committed = (await domain.designer.getSchematicProjection(design.id))!;
    expect(committed.revision).toBe(1);
    expect(client.requests).toHaveLength(2);
    const chunks = await domain.tasks.getChunks(submission.taskId);
    expect(chunks.length).toBeGreaterThan(0);
    const boundary = chunks[Math.floor(chunks.length / 2)]!.seq;
    expect(await domain.tasks.getChunks(submission.taskId, boundary)).toEqual(chunks.filter((chunk) => chunk.seq >= boundary));
    const messages = domain.service.conversation.listMessages(chat.id, { limit: 200 }).items;
    expect(messages.some((message) => message.role === "tool" && message.toolCallId === "before-stop")).toBe(true);
    await domain.service.mcp.close();
    const reopened = await openDomain(domain.dbPath);
    expect((await reopened.designer.getSchematicProjection(design.id))!.parts).toEqual(committed.parts);
    expect(await reopened.tasks.getChunks(submission.taskId)).toEqual(chunks);
    expect(reopened.service.conversation.listMessages(chat.id, { limit: 200 }).items).toEqual(messages);
    expect((await reopened.tasks.getTask(submission.taskId))!.status).toBe("cancelled");
    expect((await reopened.designer.undo(design.id, UI_SESSION)).ok).toBe(true);
    expect((await reopened.designer.getSchematicProjection(design.id))!.parts).toHaveLength(0);
    await reopened.service.mcp.close();
  });

  test("repeated provider tool-call ID within run is still deduplicated by action identity", async () => {
    const design = await domain.designer.createDesign({ name: "Duplicate provider call" });
    const chat = await domain.service.createDesignChat({ designId: design.id });
    const call = { id: "duplicate-call", name: "designer_place_components", arguments: {
      action_id: `place_duplicate_${design.id}`, components: [{ componentId: domain.componentId }],
    } };
    const { client } = await runTurns(domain, chat.id, [{ calls: [call] }, { calls: [call] }]);
    const projection = (await domain.designer.getSchematicProjection(design.id))!;
    expect(projection.parts).toHaveLength(1);
    expect(projection.revision).toBe(1);
    expect(domain.service.listWriteProposals(chat.id)).toHaveLength(1);
    expect(new Set(client.requests.map((request) => request.runId)).size).toBe(1);
  });
});
