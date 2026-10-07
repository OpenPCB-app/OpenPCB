import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  isolatedHttpDomain,
  submit,
  type HttpDomain,
} from "./agentkit-http-domain";
import { boundChat, placement } from "./agentkit-http-scenarios";
let domain: HttpDomain | undefined;
afterEach(async () => {
  await domain?.close();
  domain = undefined;
});

test("queued prompt selection remains pinned after settings change", async () => {
  domain = await isolatedHttpDomain([
    { waitForStop: true },
    { newRun: true, content: "Queued response" },
  ]);
  const { chatId } = await boundChat(domain);
  const create = (key: string, targetChat = chatId) =>
    domain!.request(`/v1/chats/${targetChat}/messages`, {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({ content: key }),
    });
  const held = (await (await create("held")).json()) as { runId: string };
  await waitForRequests(domain, 1);
  domain.service.host.settings.updateSettings({
    defaultPromptPresetId: "minimal-concise",
  });
  const secondChat = await boundChat(domain);
  const queuedResponse = await create("queued", secondChat.chatId);
  assert.equal(queuedResponse.status, 201);
  const queued = (await queuedResponse.json()) as { runId: string };
  domain.service.host.settings.updateSettings({
    defaultPromptPresetId: "friendly-tutorial",
  });
  assert.equal(
    (await domain.request(`/v1/runs/${held.runId}/cancel`, { method: "POST" }))
      .status,
    202,
  );
  await waitForRequests(domain, 2);
  const second = domain.provider.requests.find(
    (request) => request.runId === queued.runId,
  )!;
  assert.ok(
    JSON.stringify(second.messages[0]).includes(
      "concise PCB engineering assistant",
    ),
  );
  assert.equal(
    JSON.stringify(second.messages[0]).includes("patient PCB design tutor"),
    false,
  );
});

async function waitForRequests(
  current: HttpDomain,
  count: number,
): Promise<void> {
  const deadline = Date.now() + 5000;
  while (current.provider.requests.length < count && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(current.provider.requests.length >= count);
}

test("real knowledge mention resolves text and image in AgentKit assembled history", async () => {
  domain = await isolatedHttpDomain([{ content: "Read document" }]);
  const pageId = crypto.randomUUID();
  await domain.knowledge.create({
    id: pageId,
    workspace_id: "default",
    title: "Actual knowledge",
    order_key: "a",
    created_at: new Date(),
    updated_at: new Date(),
    content_json: {
      engine: "tiptap",
      version: 1,
      data: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Fixture source facts" }],
          },
          {
            type: "image",
            attrs: {
              src: "data:image/png;base64,aGVsbG8=",
              alt: "Fixture image",
            },
          },
        ],
      },
    },
  });
  const { chatId } = await boundChat(domain);
  await submit(
    domain,
    chatId,
    "mention",
    `Read @[knowledge-page:${pageId}|Actual knowledge]`,
  );
  const request = domain.provider.requests[0]!;
  assert.ok(JSON.stringify(request.messages).includes("Fixture source facts"));
  const user = request.messages.find((message) => message.role === "user");
  assert.ok(Array.isArray(user?.content));
  assert.ok(
    user.content.some(
      (part) =>
        part.type === "image" &&
        part.source.kind === "data" &&
        part.source.base64 === "aGVsbG8=",
    ),
  );
  assert.equal(
    request.runId,
    (await domain.service.host.store.tasks.listByScope(chatId))[0]!.taskId,
  );
});

test("read-only HTTP run cannot place native components", async () => {
  const place = placement("read-only");
  domain = await isolatedHttpDomain(
    [{ calls: [place] }, { content: "Refused" }],
    true,
  );
  place.arguments.components.push({
    componentId: domain.componentId,
    quantity: 1,
  });
  const { chatId, designId } = await boundChat(domain);
  await submit(domain, chatId, "readonly");
  assert.equal(
    (await domain.designer.getSchematicProjection(designId))?.parts.length,
    0,
  );
  assert.ok(
    domain.provider.requests.some((request) =>
      JSON.stringify(request.messages).includes("READ_ONLY"),
    ),
  );
});

test("canonical monitor pages tasks without provider generations or secrets", async () => {
  domain = await isolatedHttpDomain([
    { content: "First" },
    { newRun: true, content: "Second" },
  ]);
  const { chatId } = await boundChat(domain);
  await submit(domain, chatId, "monitor-one");
  await submit(domain, chatId, "monitor-two");
  const response = await domain.request(`/v1/runs?chatId=${chatId}&limit=1`);
  assert.equal(response.status, 200);
  const first = (await response.json()) as {
    items: Array<{ taskId: string }>;
    nextCursor: string;
  };
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);
  const second = await domain.request(
    `/v1/runs?chatId=${chatId}&limit=1&cursor=${first.nextCursor}`,
  );
  assert.equal(second.status, 200);
  const next = (await second.json()) as {
    items: Array<{ taskId: string }>;
    nextCursor: null;
  };
  assert.equal(next.items.length, 1);
  assert.equal(next.nextCursor, null);
  assert.notEqual(next.items[0]!.taskId, first.items[0]!.taskId);
  assert.equal(
    JSON.stringify(first).includes("openpcb-provider-generation"),
    false,
  );
  assert.equal(JSON.stringify(first).includes("apiKeySecretRef"), false);
  assert.equal((await domain.request("/v1/runs?limit=51")).status, 400);
  assert.equal(
    (await domain.request("/v1/runs?providerId=internal")).status,
    400,
  );
});

test("HTTP regenerate requires key and preserves original answer and immutable replay", async () => {
  domain = await isolatedHttpDomain([
    { content: "Original answer" },
    { newRun: true, content: "New answer" },
  ]);
  const { chatId } = await boundChat(domain);
  const initial = await submit(domain, chatId, "original");
  const path = `/v1/chats/${chatId}/messages/${initial.assistantMessageId}/regenerate`;
  assert.equal(
    (await domain.request(path, { method: "POST", body: "{}" })).status,
    400,
  );
  const regenerate = (metadata = {}) =>
    domain!.request(path, {
      method: "POST",
      headers: { "Idempotency-Key": "regenerate" },
      body: JSON.stringify({ metadata }),
    });
  const response = await regenerate();
  assert.equal(response.status, 201);
  const result = (await response.json()) as {
    runId: string;
    assistantMessageId: string;
  };
  const deadline = Date.now() + 5000;
  while (
    (await domain.service.host.store.tasks.getTask(result.runId))?.status !==
      "completed" &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(
    (
      await domain.service.host.store.conversations.getMessage(
        initial.assistantMessageId,
      )
    )?.content,
    "Original answer",
  );
  assert.equal(
    (
      await domain.service.host.store.conversations.getMessage(
        result.assistantMessageId,
      )
    )?.content,
    "New answer",
  );
  const count = domain.provider.requests.length;
  const repeated = await regenerate();
  assert.equal(repeated.status, 200);
  assert.equal(
    ((await repeated.json()) as { runId: string }).runId,
    result.runId,
  );
  assert.equal(
    (await regenerate({ promptPresetId: "minimal-concise" })).status,
    422,
  );
  assert.equal(domain.provider.requests.length, count);
});

test("unbound creation and autoedit use real domain receipts in one run", async () => {
  const place = {
    id: "create-place",
    name: "designer_place_components",
    arguments: {
      components: [] as Array<{ componentId: string; quantity: number }>,
    },
  };
  domain = await isolatedHttpDomain([
    {
      calls: [
        {
          id: "create",
          name: "designer_create_design",
          arguments: { name: "Created from HTTP" },
        },
      ],
    },
    { calls: [place] },
    { content: "Created and placed" },
  ]);
  place.arguments.components.push({
    componentId: domain.componentId,
    quantity: 1,
  });
  const response = await domain.request("/v1/chats", {
    method: "POST",
    body: JSON.stringify({ title: "Unbound" }),
  });
  const chat = (await response.json()) as { id: string };
  const result = await submit(domain, chat.id, "create-place");
  const binding = domain.service.contextResolver.getPrimaryDesign(chat.id)!;
  assert.ok(binding);
  assert.equal(binding.label, "Created from HTTP");
  assert.equal(
    (await domain.designer.getSchematicProjection(binding.refId))?.parts.length,
    1,
  );
  const proposals = await domain.service.host.store.proposals.listByChat(
    chat.id,
  );
  assert.equal(proposals.length, 2);
  for (const proposal of proposals)
    assert.equal(
      (
        await domain.service.host.store.proposals.getOutcome(
          proposal.operationId!,
        )
      )?.status,
      "applied",
    );
  const verification = (
    await domain.service.host.store.tasks.listEvents(result.runId)
  )
    .filter((event) => event.type === "run.verification")
    .at(-1);
  assert.ok(JSON.stringify(verification).includes('"status":"pass"'));
});
