import assert from "node:assert/strict";
import type { HttpDomain } from "./agentkit-http-domain";

export async function boundChat(current: HttpDomain) {
  const design = await current.designer.createDesign({ name: "Matrix" });
  const response = await current.request("/v1/chats", {
    method: "POST",
    body: JSON.stringify({ title: "Matrix" }),
  });
  assert.equal(response.status, 201);
  const chat = (await response.json()) as { id: string };
  assert.equal(
    (
      await current.request(`/v1/chats/${chat.id}/context-bindings`, {
        method: "POST",
        body: JSON.stringify({ designId: design.id }),
      })
    ).status,
    201,
  );
  return { chatId: chat.id, designId: design.id };
}

export function placement(actionId: string, quantity = 1) {
  return {
    id: actionId,
    name: "designer_place_components",
    arguments: {
      action_id: actionId,
      components: [] as Array<{ componentId: string; quantity: number }>,
    },
    quantity,
  };
}

export function deletion(actionId: string) {
  return {
    id: actionId,
    name: "designer_propose_schematic_deletions",
    arguments: {
      action_id: actionId,
      title: "Delete C1",
      summary: "Remove capacitor",
      entities: [{ entityId: "C1", entityKind: "part" }],
    },
  };
}

export async function proposalRequest(
  current: HttpDomain,
  id: string,
  action: string,
  input: Record<string, unknown>,
) {
  return current.request(`/v1/proposals/${id}/${action}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
