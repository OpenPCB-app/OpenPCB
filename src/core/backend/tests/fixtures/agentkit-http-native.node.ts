import "./agentkit-http-context.node";
import {
  boundChat,
  placement,
  deletion,
  proposalRequest,
} from "./agentkit-http-scenarios";
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  isolatedHttpDomain,
  submit,
  UI_SESSION,
  type HttpDomain,
} from "./agentkit-http-domain";

let domain: HttpDomain | undefined;
afterEach(async () => {
  await domain?.close();
  domain = undefined;
});

describe("AgentKit authenticated native HTTP workflow", () => {
  test("HTTP guard, real host, native place/inspect, receipts and Undo", async () => {
    const calls = [
      {
        id: "place-two",
        name: "designer_place_components",
        arguments: {
          action_id: "http-place-two",
          components: [] as Array<{ componentId: string; quantity: number }>,
        },
      },
      {
        id: "inspect-two",
        name: "designer_get_schematic_connectivity",
        arguments: {},
      },
    ];
    domain = await isolatedHttpDomain([
      { calls: [calls[0]!] },
      { content: "Placed." },
      { calls: [calls[1]!] },
      { content: "Inspected." },
    ]);
    calls[0]!.arguments.components!.push({
      componentId: domain.componentId,
      quantity: 2,
    });
    assert.equal((await domain.request("/v1/tools", {}, null)).status, 401);
    const catalogResponse = await domain.request("/v1/tools");
    assert.equal(catalogResponse.status, 200);
    const catalog = (await catalogResponse.json()) as Array<{ name: string }>;
    assert.ok(catalog.some((tool) => tool.name === "designer_create_design"));
    assert.ok(catalog.some((tool) => tool.name === "library_resolve_bom"));
    assert.equal(domain.provider.requests.length, 0);
    const design = await domain.designer.createDesign({ name: "HTTP native" });
    calls[0]!.arguments.action_id = `place_http_${design.id}`;
    assert.equal((await domain.request("/v1/chats", {}, null)).status, 401);
    const chatResponse = await domain.request("/v1/chats", {
      method: "POST",
      body: JSON.stringify({ title: "Native" }),
    });
    assert.equal(chatResponse.status, 201);
    const chat = (await chatResponse.json()) as { id: string };
    const bound = await domain.request(
      `/v1/chats/${chat.id}/context-bindings`,
      {
        method: "POST",
        body: JSON.stringify({ designId: design.id }),
      },
    );
    assert.equal(bound.status, 201);
    const placed = await submit(domain, chat.id, "place-key");
    const projection = await domain.designer.getSchematicProjection(design.id);
    assert.deepEqual(projection?.parts.map((part) => part.reference).sort(), [
      "C1",
      "C2",
    ]);
    assert.equal(projection?.revision, 2);
    const proposals = await domain.service.host.store.proposals.listByChat(
      chat.id,
    );
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0]?.status, "applied");
    assert.equal(
      (
        await domain.designer.listOperationReceipts(
          "desktop",
          proposals[0]!.operationId!,
        )
      ).length,
      2,
    );
    const outcome = await domain.service.host.store.proposals.getOutcome(
      proposals[0]!.operationId!,
    );
    assert.equal(outcome?.status, "applied");
    assert.deepEqual(outcome.failedOps, []);
    const verification = (
      await domain.service.host.store.tasks.listEvents(placed.taskId)
    )
      .filter((event) => event.type === "run.verification")
      .at(-1);
    assert.ok(JSON.stringify(verification).includes('"status":"pass"'));
    await submit(domain, chat.id, "inspect-key", "Inspect bound schematic.");
    assert.deepEqual(
      await domain.designer.getSchematicProjection(design.id),
      projection,
    );
    const toolResult = [...(domain.provider.requests.at(-1)?.messages ?? [])]
      .reverse()
      .find((message) => message.role === "tool");
    assert.ok(
      typeof toolResult?.content === "string" &&
        toolResult.content.includes("C1"),
    );
    assert.equal(
      (await domain.designer.getHistory(design.id, UI_SESSION)).undoDepth,
      2,
    );
    const ids = projection!.parts.map((part) => part.id);
    assert.equal((await domain.designer.undo(design.id, UI_SESSION)).ok, true);
    assert.equal(
      (await domain.designer.getSchematicProjection(design.id))?.revision,
      3,
    );
    assert.ok(
      ids.includes(
        (await domain.designer.getSchematicProjection(design.id))!.parts[0]!.id,
      ),
    );
    assert.equal(
      (await domain.designer.getSchematicProjection(design.id))?.parts.length,
      1,
    );
    assert.equal((await domain.designer.undo(design.id, UI_SESSION)).ok, true);
    assert.equal(
      (await domain.designer.getSchematicProjection(design.id))?.revision,
      4,
    );
    assert.equal(
      (await domain.designer.getSchematicProjection(design.id))?.parts.length,
      0,
    );
    assert.equal(
      (await domain.ctx.db.rawSql("SELECT * FROM assistant_chat")).length,
      0,
    );
  });
});

test("HTTP submission and native action replay preserve IDs; changed payload conflicts", async () => {
  const place = placement("same-action");
  const changed = {
    ...place,
    arguments: {
      ...place.arguments,
      components: [] as Array<{ componentId: string; quantity: number }>,
    },
  };
  domain = await isolatedHttpDomain([
    { calls: [place], newRun: true },
    { content: "Placed" },
    { calls: [place], newRun: true },
    { content: "Replayed" },
    { newRun: true, calls: [changed] },
    { content: "Conflict refused" },
  ]);
  place.arguments.components.push({
    componentId: domain.componentId,
    quantity: 1,
  });
  const { chatId, designId } = await boundChat(domain);
  place.arguments.action_id = `place_replay_${designId}`;
  changed.arguments.action_id = place.arguments.action_id;
  changed.arguments.components.push({
    componentId: domain.componentId,
    quantity: 3,
  });
  const first = await submit(domain, chatId, "same-submit");
  const before = await domain.designer.getSchematicProjection(designId);
  const request = (content: string) =>
    domain!.request(`/v1/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "Idempotency-Key": "same-submit" },
      body: JSON.stringify({ content }),
    });
  const inferenceCount = domain.provider.requests.length;
  const replay = await request("Execute native fixture.");
  assert.equal(replay.status, 200);
  assert.equal(((await replay.json()) as { runId: string }).runId, first.runId);
  assert.equal((await request("Changed original request")).status, 422);
  assert.equal(domain.provider.requests.length, inferenceCount);
  await submit(domain, chatId, "action-replay");
  await submit(domain, chatId, "action-conflict");
  assert.ok(
    domain.provider.requests.some((request) =>
      JSON.stringify(request.messages).includes("OPERATION_IDENTITY_CONFLICT"),
    ),
  );
  assert.deepEqual(
    await domain.designer.getSchematicProjection(designId),
    before,
  );
  assert.equal(
    (await domain.service.host.store.proposals.listByChat(chatId)).length,
    1,
  );
  const messages = await domain.request(`/v1/chats/${chatId}/messages`);
  assert.equal(
    (await messages.text()).includes("__openpcbSubmissionFingerprint"),
    false,
  );
});

test("HTTP deny and approve destructive proposals once; operation IDs cannot steal outcomes", async () => {
  const place = placement("place-for-delete");
  const denied = deletion("denied-delete");
  const approved = deletion("approved-delete");
  domain = await isolatedHttpDomain([
    { calls: [place], newRun: true },
    { content: "Placed" },
    { calls: [denied], newRun: true },
    { content: "Pending" },
    { calls: [denied], newRun: true },
    { content: "Denied remains denied" },
    { calls: [approved], newRun: true },
    { content: "Pending" },
  ]);
  place.arguments.components.push({
    componentId: domain.componentId,
    quantity: 1,
  });
  const { chatId, designId } = await boundChat(domain);
  place.arguments.action_id = `place_http_${designId}`;
  denied.arguments.action_id = `delete_denied_${designId}`;
  approved.arguments.action_id = `delete_approved_${designId}`;
  await submit(domain, chatId, "place");
  await submit(domain, chatId, "deny");
  const pending = (
    await domain.service.host.store.proposals.listByChat(chatId)
  ).find((item) => item.actionId === denied.arguments.action_id)!;
  assert.equal(pending.status, "pending");
  assert.equal(
    (await proposalRequest(domain, pending.id, "reject", {})).status,
    200,
  );
  await submit(domain, chatId, "repeat-denied");
  assert.equal(
    (await domain.service.host.store.proposals.listByChat(chatId)).filter(
      (item) => item.actionId === denied.arguments.action_id,
    ).length,
    1,
  );
  assert.equal(
    (await domain.designer.getSchematicProjection(designId))?.parts.length,
    1,
  );
  await submit(domain, chatId, "approve");
  const target = (
    await domain.service.host.store.proposals.listByChat(chatId)
  ).find((item) => item.actionId === approved.arguments.action_id)!;
  assert.equal(
    (await proposalRequest(domain, target.id, "approve", { actor: "attacker" }))
      .status,
    400,
  );
  assert.equal(
    (await proposalRequest(domain, target.id, "approve", {})).status,
    200,
  );
  assert.equal(
    (
      await proposalRequest(domain, target.id, "apply", {
        operationId: `native:${pending.id}`,
      })
    ).status,
    400,
  );
  const applied = await proposalRequest(domain, target.id, "apply", {
    operationId: `native:${target.id}`,
  });
  assert.equal(applied.status, 200);
  const outcome = await applied.json();
  const replay = await proposalRequest(domain, target.id, "apply", {
    operationId: `native:${target.id}`,
  });
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), outcome);
  assert.equal(
    (await domain.designer.getSchematicProjection(designId))?.parts.length,
    0,
  );
  assert.equal(
    (
      await domain.designer.listOperationReceipts(
        "desktop",
        `native:${target.id}`,
      )
    ).length,
    1,
  );
  assert.equal(
    (await domain.designer.getHistory(designId, UI_SESSION)).undoDepth,
    2,
  );
});

test("HTTP approved stale proposal refuses domain mutation", async () => {
  const first = placement("stale-first");
  const later = placement("stale-later");
  const remove = deletion("stale-delete");
  domain = await isolatedHttpDomain([
    { calls: [first], newRun: true },
    { content: "Placed" },
    { calls: [remove], newRun: true },
    { content: "Pending" },
    { calls: [later], newRun: true },
    { content: "Revision changed" },
  ]);
  for (const place of [first, later])
    place.arguments.components.push({
      componentId: domain.componentId,
      quantity: 1,
    });
  const { chatId, designId } = await boundChat(domain);
  first.arguments.action_id = `place_first_${designId}`;
  later.arguments.action_id = `place_later_${designId}`;
  remove.arguments.action_id = `delete_stale_${designId}`;
  await submit(domain, chatId, "first");
  await submit(domain, chatId, "pending");
  const pending = (
    await domain.service.host.store.proposals.listByChat(chatId)
  ).find((item) => item.actionId === remove.arguments.action_id)!;
  assert.equal(
    (await proposalRequest(domain, pending.id, "approve", {})).status,
    200,
  );
  await submit(domain, chatId, "later");
  const before = await domain.designer.getSchematicProjection(designId);
  const failed = await proposalRequest(domain, pending.id, "apply", {
    operationId: `native:${pending.id}`,
  });
  assert.ok(failed.status >= 400, await failed.text());
  assert.deepEqual(
    await domain.designer.getSchematicProjection(designId),
    before,
  );
});

test("real batch command failure remains partial with failed verification", async () => {
  const place = placement("partial-place", 2);
  domain = await isolatedHttpDomain([
    { calls: [place], newRun: true },
    { content: "Everything complete" },
  ]);
  place.arguments.components.push({
    componentId: domain.componentId,
    quantity: 2,
  });
  const { chatId, designId } = await boundChat(domain);
  place.arguments.action_id = `place_partial_${designId}`;
  domain.ctx.db
    .rawSql(`CREATE TRIGGER fail_second_placement BEFORE INSERT ON designer_schematic_parts
    WHEN (SELECT COUNT(*) FROM designer_schematic_parts WHERE design_id = NEW.design_id) > 0
    BEGIN SELECT RAISE(ABORT, 'Fixture second placement failure'); END`);
  const result = await submit(domain, chatId, "partial");
  assert.equal(
    (await domain.designer.getSchematicProjection(designId))?.parts.length,
    1,
  );
  const proposal = (
    await domain.service.host.store.proposals.listByChat(chatId)
  )[0]!;
  const outcome = await domain.service.host.store.proposals.getOutcome(
    proposal.operationId!,
  );
  assert.equal(outcome?.status, "partial");
  assert.equal(outcome?.appliedOps, 1);
  assert.ok(outcome?.failedOps.length);
  assert.ok(outcome?.failedOps.some((failure) => failure.opIndex === 1));
  const events = await domain.service.host.store.tasks.listEvents(result.runId);
  const verification = events.find(
    (event) => event.type === "run.verification",
  );
  assert.ok(JSON.stringify(verification).includes('"status":"partial"'));
  assert.equal(
    (
      await domain.designer.listOperationReceipts(
        "desktop",
        proposal.operationId!,
      )
    ).filter((receipt) => receipt.result.ok).length,
    1,
  );
});

test("HTTP Stop after committed unit prevents later native commands and inference", async () => {
  const place = placement("stop-place", 2);
  domain = await isolatedHttpDomain([
    { calls: [place], newRun: true },
    { content: "Must never run" },
  ]);
  place.arguments.components.push({
    componentId: domain.componentId,
    quantity: 2,
  });
  const { chatId, designId } = await boundChat(domain);
  place.arguments.action_id = `place_stop_${designId}`;
  const original = domain.designer.dispatchOperation.bind(domain.designer);
  let calls = 0;
  domain.designer.dispatchOperation = async (...args) => {
    const result = await original(...args);
    calls++;
    const proposal = (
      await domain!.service.host.store.proposals.listByChat(chatId)
    )[0]!;
    const response = await domain!.request(
      `/v1/runs/${proposal.runId}/cancel`,
      { method: "POST" },
    );
    assert.equal(response.status, 200);
    return result;
  };
  await submit(domain, chatId, "stop");
  assert.equal(calls, 1);
  assert.equal(domain.provider.requests.length, 1);
  assert.equal(
    (await domain.designer.getSchematicProjection(designId))?.parts.length,
    1,
  );
});

test("HTTP authority metadata, provider secrets and generic outbound capabilities refused", async () => {
  domain = await isolatedHttpDomain();
  assert.equal(
    (
      await domain.request("/v1/chats", {
        method: "POST",
        body: JSON.stringify({ actor: "other" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await domain.request("/v1/chats", {
        method: "POST",
        body: JSON.stringify({
          metadata: { nativeIdentity: { actorScope: "other" } },
        }),
      })
    ).status,
    400,
  );
  for (const field of ["apiKey", "clearApiKey", "metadata"]) {
    assert.equal(
      (
        await domain.request("/v1/providers/lmstudio", {
          method: "PATCH",
          body: JSON.stringify({ [field]: "secret" }),
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (await domain.request("/v1/mcp-servers", { method: "POST", body: "{}" }))
      .status,
    404,
  );
  assert.equal(
    (
      await domain.request("/v1/write-allowances", {
        method: "POST",
        body: "{}",
      })
    ).status,
    404,
  );
});
