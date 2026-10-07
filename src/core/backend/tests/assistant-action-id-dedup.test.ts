import { afterEach, describe, expect, test } from "bun:test";
import { SqliteAssistantStore } from "agentkit/adapters-sqlite";
import { ProposalService, SessionWritePolicy, defaultClock, defaultIds } from "agentkit/host";

let store: SqliteAssistantStore | undefined;
afterEach(() => { store?.close(); store = undefined; });

async function fixture() {
  store = new SqliteAssistantStore(":memory:");
  await store.conversations.createChat({ id: "chat" });
  const proposals = new ProposalService({ store, policy: new SessionWritePolicy(), clock: defaultClock, ids: defaultIds,
    applier: { apply: async () => { throw new Error("No apply expected"); }, getOutcome: async () => null } });
  const input = { chatId: "chat", scopeKey: "desktop:design:design", toolName: "designer_propose_schematic_wires",
    kind: "designer_schematic_wires", risk: "medium" as const, operations: [] };
  return { store, proposals, input };
}

describe("canonical action identity database backstop", () => {
  test("duplicate scoped action is refused and retains the original proposal", async () => {
    const { store, proposals, input } = await fixture();
    const first = await proposals.stage({ ...input, actionId: "wire_U1.OUT__R1.1" });
    await expect(proposals.stage({ ...input, actionId: "wire_U1.OUT__R1.1" })).rejects.toThrow("already exists");
    expect((await store.proposals.getByActionId(input.scopeKey, "wire_U1.OUT__R1.1"))?.id).toBe(first.id);
    expect(await store.proposals.listByChat("chat")).toHaveLength(1);
  });

  test("actor scope separates action keys and absent action keys remain independent", async () => {
    const { store, proposals, input } = await fixture();
    const first = await proposals.stage({ ...input, actionId: "same" });
    const other = await proposals.stage({ ...input, scopeKey: "mcp:client:design:design", actionId: "same" });
    expect(other.id).not.toBe(first.id);
    const a = await proposals.stage(input);
    const b = await proposals.stage(input);
    expect(a.id).not.toBe(b.id);
    expect(await store.proposals.listByChat("chat")).toHaveLength(4);
  });
});
