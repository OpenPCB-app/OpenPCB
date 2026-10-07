import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import scenarios from "./fixtures/assistant-parity/scenarios.json";
import { isolatedDomain, UI_SESSION, type ParityDomain } from "./fixtures/assistant-parity/domain";
import { runTurns } from "./fixtures/assistant-parity/provider";

let domain: ParityDomain;
let currentDesignId: string;
beforeEach(async () => { domain = await isolatedDomain(); });
afterEach(async () => { await domain?.close(); });

function call(name: keyof typeof scenarios, patch: Record<string, unknown> = {}) {
  const item = scenarios[name];
  const args = JSON.parse(JSON.stringify(item.arguments).replaceAll("$componentId", domain.componentId).replaceAll("$designId", currentDesignId)) as Record<string, unknown>;
  return { ...item, arguments: { ...args, ...patch } };
}

async function designChat() {
  const design = await domain.designer.createDesign({ name: "Assistant parity" });
  currentDesignId = design.id;
  const chat = await domain.service.createDesignChat({ designId: design.id });
  return { design, chat };
}

async function seed() {
  const target = await designChat();
  await runTurns(domain, target.chat.id, [{ calls: [call("place")] }]);
  return target;
}

async function projection(designId: string) {
  const result = await domain.designer.getSchematicProjection(designId);
  if (!result) throw new Error(`Projection missing: ${designId}`);
  return result;
}

describe("OPENPCB-112 native assistant parity", () => {
  test("inspect/explain is read-only and uses actual connectivity", async () => {
    const { design, chat } = await seed();
    const before = await projection(design.id);
    const history = await domain.designer.getHistory(design.id, UI_SESSION);
    const { client } = await runTurns(domain, chat.id, [{ calls: [call("inspect")] }, { content: "Two capacitors inspected." }]);
    expect(await projection(design.id)).toEqual(before);
    expect(await domain.designer.getHistory(design.id, UI_SESSION)).toEqual(history);
    const messages = client.requests[1]!.messages.filter((message) => message.role === "tool");
    const result = JSON.parse(messages.at(-1)!.content) as { ok: boolean; data: { parts: Array<{ id: string; reference: string }> } };
    expect(result.ok).toBe(true);
    expect(result.data.parts.map((part) => part.id).sort()).toEqual(before.parts.map((part) => part.id).sort());
    expect(result.data.parts.map((part) => part.reference).sort()).toEqual(["C1", "C2"]);
  });

  test("place/move/wire/update preserve IDs, revisions and executable undo", async () => {
    const { design, chat } = await seed();
    const placed = await projection(design.id);
    expect(placed.revision).toBe(2);
    expect(placed.parts.map((part) => part.reference).sort()).toEqual(["C1", "C2"]);
    const ids = placed.parts.map((part) => part.id).sort();
    expect(ids.every((id) => /^[\da-f-]{36}$/i.test(id))).toBe(true);
    await runTurns(domain, chat.id, [{ calls: [call("move")] }]);
    const moved = await projection(design.id);
    expect(moved.revision).toBe(3);
    expect(moved.parts.find((part) => part.reference === "C1")!.positionNm).toEqual({ x: 30_000_000, y: 10_000_000 });
    await runTurns(domain, chat.id, [{ calls: [call("wire")] }]);
    const wired = await projection(design.id);
    expect(wired.wires).toHaveLength(1);
    expect(wired.revision).toBe(5);
    const pins = wired.parts.map((part) => part.pins.find((pin) => pin.number === "1")!.id);
    expect(wired.nets.some((net) => pins.every((pinId) => net.pinIds.includes(pinId)))).toBe(true);
    await runTurns(domain, chat.id, [{ calls: [call("update")] }]);
    const updated = await projection(design.id);
    expect(updated.revision).toBe(6);
    expect(updated.parts.map((part) => part.id).sort()).toEqual(ids);
    expect(updated.parts.find((part) => part.reference === "C1")!.value).toBe("22nF");
    const undo = await domain.designer.undo(design.id, UI_SESSION);
    expect(undo.ok).toBe(true);
    const undone = await projection(design.id);
    expect(undone.revision).toBe(7);
    expect(undone.parts.find((part) => part.reference === "C1")!.value).toBe(wired.parts.find((part) => part.reference === "C1")!.value);
    expect(undone.wires).toEqual(wired.wires);
    expect((await domain.designer.redo(design.id, UI_SESSION)).ok).toBe(true);
    expect([...(await projection(design.id)).parts].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...updated.parts].sort((a, b) => a.id.localeCompare(b.id)));
  });

  test("destructive rejection leaves domain unchanged; approval deletes once and undoes", async () => {
    const { design, chat } = await seed();
    const before = await projection(design.id);
    await runTurns(domain, chat.id, [{ calls: [call("delete", { riskLevel: "medium" })] }]);
    const rejected = domain.service.listWriteProposals(chat.id).find((item) => item.kind === "designer_schematic_deletions")!;
    expect(rejected.status).toBe("pending");
    expect(await projection(design.id)).toEqual(before);
    domain.service.rejectWriteProposal(chat.id, rejected.id);
    expect(await projection(design.id)).toEqual(before);
    await expect(domain.service.applyWriteProposal(chat.id, rejected.id)).rejects.toThrow("already rejected");
    await runTurns(domain, chat.id, [{ calls: [call("delete", { action_id: `delete_approved_${design.id}` })] }]);
    const approved = domain.service.listWriteProposals(chat.id).find((item) => item.status === "pending")!;
    const applied = await domain.service.applyWriteProposal(chat.id, approved.id);
    expect(applied.status).toBe("applied");
    const after = await projection(design.id);
    expect(after.parts.map((part) => part.reference)).toEqual(["C2"]);
    expect(after.revision).toBe(before.revision + 1);
    await expect(domain.service.applyWriteProposal(chat.id, approved.id)).rejects.toThrow("already applied");
    expect((await domain.designer.undo(design.id, UI_SESSION)).ok).toBe(true);
    expect([...(await projection(design.id)).parts].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...before.parts].sort((a, b) => a.id.localeCompare(b.id)));
  });

  test("duplicate action across submissions does not duplicate committed parts", async () => {
    const { design, chat } = await seed();
    const before = await projection(design.id);
    const proposalCount = domain.service.listWriteProposals(chat.id).length;
    const { client } = await runTurns(domain, chat.id, [{ calls: [call("place")] }]);
    expect(await projection(design.id)).toEqual(before);
    expect(domain.service.listWriteProposals(chat.id)).toHaveLength(proposalCount);
    expect(client.requests[1]!.messages.at(-1)!.content).toContain("already_applied");
  });

  test("stale destructive approval fails before mutation", async () => {
    const { design, chat } = await seed();
    await runTurns(domain, chat.id, [{ calls: [call("delete")] }]);
    const pending = domain.service.listWriteProposals(chat.id).find((item) => item.status === "pending")!;
    await runTurns(domain, chat.id, [{ calls: [call("move")] }]);
    const before = await projection(design.id);
    await expect(domain.service.applyWriteProposal(chat.id, pending.id)).rejects.toThrow("Design changed since proposal was created");
    expect(await projection(design.id)).toEqual(before);
    expect(domain.service.listWriteProposals(chat.id).find((item) => item.id === pending.id)!.status).toBe("failed");
  });

  test("invalid tool schema refuses write before proposal or command dispatch", async () => {
    const { design, chat } = await designChat();
    const { client } = await runTurns(domain, chat.id, [{ calls: [call("place", {
      components: [{ componentId: domain.componentId, quantity: 0 }],
    })] }]);
    expect((await projection(design.id)).revision).toBe(0);
    expect(domain.service.listWriteProposals(chat.id)).toHaveLength(0);
    expect(client.requests[1]!.messages.at(-1)!.content).toContain("schema_invalid");
    expect((await domain.designer.getHistory(design.id, UI_SESSION)).undoDepth).toBe(0);
  });

  test("unresolved placement remains pending until explicit partial approval", async () => {
    const { design, chat } = await designChat();
    const { client } = await runTurns(domain, chat.id, [{ calls: [call("partial")] }]);
    const proposal = domain.service.listWriteProposals(chat.id)[0]!;
    expect(proposal.status).toBe("pending");
    expect((await projection(design.id)).revision).toBe(0);
    await expect(domain.service.applyWriteProposal(chat.id, proposal.id)).rejects.toThrow("Confirm partial apply");
    await domain.service.applyWriteProposal(chat.id, proposal.id, { allowPartial: true });
    const current = await projection(design.id);
    expect(current.parts).toHaveLength(1);
    expect(current.revision).toBe(1);
    expect(domain.service.listWriteProposals(chat.id)[0]!.status).toBe("applied");
    expect(JSON.stringify(proposal)).toContain("parity.missing-component");
    expect(client.requests[1]!.messages.at(-1)!.content).toContain("partial");
    expect((await domain.designer.undo(design.id, UI_SESSION)).ok).toBe(true);
    expect((await projection(design.id)).parts).toHaveLength(0);
  });

  test("real command failure keeps per-operation receipts and committed first update", async () => {
    const { design, chat } = await seed();
    const before = await projection(design.id);
    const partId = before.parts.find((part) => part.reference === "C1")!.id;
    const id = "parity-partial-domain-command";
    const operations = [partId, "parity-missing-part"].map((target, index) => ({
      id: `update-${index}`, kind: "designer.update_part_properties",
      title: "Update fixture", summary: "Update value", riskLevel: "medium" as const,
      payload: { type: "update_part_properties" as const, partId: target, value: "47nF" },
      sources: [], warnings: [],
    }));
    domain.service.conversation.createWriteProposal({
      id, chatId: chat.id, designId: design.id, baseRevision: before.revision,
      kind: "designer_schematic_updates", proposal: {},
      envelope: { id, kind: "designer_schematic_updates", toolName: "designer_propose_schematic_updates",
        title: "Partial domain failure", summary: "Second target does not exist", riskLevel: "medium",
        designId: design.id, baseRevision: before.revision, operations, payload: {}, sources: [], warnings: [] },
    });
    const result = await domain.service.applyWriteProposal(chat.id, id);
    expect(result.status).toBe("partial");
    expect(domain.service.listWriteProposals(chat.id).find((item) => item.id === id)!.status).toBe("partial");
    if (!("operations" in result)) throw new Error("Expected schematic operation receipts");
    expect(result.operations.map((operation) => operation.status)).toEqual(["applied", "failed"]);
    expect(result.operations[1]!.error).toBe("ENTITY_NOT_FOUND");
    const after = await projection(design.id);
    expect(after.revision).toBe(3);
    expect(after.parts.find((part) => part.id === partId)!.value).toBe("47nF");
    expect((await domain.designer.undo(design.id, UI_SESSION)).ok).toBe(true);
    expect((await projection(design.id)).parts.find((part) => part.id === partId)!.value).toBe("");
  });
});
