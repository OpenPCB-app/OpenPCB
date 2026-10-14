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
  assert.equal(
    request.messages.some(
      (message) =>
        message.role === "system" &&
        JSON.stringify(message.content).includes("Fixture source facts"),
    ),
    false,
  );
  const user = request.messages.find((message) => message.role === "user");
  assert.ok(Array.isArray(user?.content));
  assert.ok(JSON.stringify(user.content).includes("<untrusted_reference_data>"));
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

test("omitted mention images are reported once to the model and the run log", async () => {
  domain = await isolatedHttpDomain([
    {
      calls: [
        { id: "inspect", name: "designer_get_schematic_connectivity", arguments: {} },
      ],
    },
    { content: "Read with notice" },
    { newRun: true, content: "Later turn" },
  ]);
  const image = (src: string) => ({ type: "image", attrs: { src, alt: "img" } });
  const small = "data:image/png;base64,aGVsbG8=";
  const pageId = crypto.randomUUID();
  await domain.knowledge.create({
    id: pageId,
    workspace_id: "default",
    title: "Images",
    order_key: "a",
    created_at: new Date(),
    updated_at: new Date(),
    content_json: {
      engine: "tiptap",
      version: 1,
      data: {
        type: "doc",
        content: [
          image(`data:image/png;base64,${"A".repeat(8 * 1024 * 1024)}`),
          image("data:image/svg+xml;base64,PHN2Zy8+"),
          image("https://example.invalid/remote.png"),
          ...Array.from({ length: 12 }, () => image(small)),
        ],
      },
    },
  });
  const { chatId } = await boundChat(domain);
  const result = await submit(
    domain,
    chatId,
    "images",
    `Read @[knowledge-page:${pageId}|Images]`,
  );
  const firstRun = domain.provider.requests.filter((request) => request.runId === result.runId);
  assert.ok(firstRun.length >= 2);
  for (const request of firstRun) {
    const user = [...request.messages].reverse().find((message) => message.role === "user")!;
    assert.ok(Array.isArray(user.content));
    const parts = user.content;
    assert.equal(parts.filter((part) => part.type === "image").length, 10);
    assert.ok(
      parts.every((part) => part.type !== "image" || part.source.kind === "data"),
    );
    assert.ok(
      JSON.stringify(parts).includes(
        "Image notice: 5 referenced image(s) were not sent",
      ),
    );
  }
  const warnings = (
    await domain.service.host.store.tasks.listEvents(result.runId)
  ).filter(
    (event) =>
      event.type === "run.warning" &&
      JSON.stringify(event).includes("mention_images_omitted"),
  );
  assert.equal(warnings.length, 1);
  const message = JSON.stringify(warnings[0]);
  assert.ok(message.includes("2 unsupported type or source"));
  assert.ok(message.includes("1 larger than the 5 MiB per-image limit"));
  assert.ok(message.includes("2 over the per-message image budget"));
  assert.equal(message.includes("Do not describe"), false);

  // The earlier mention still reaches the model, but the user is not re-warned for it.
  const later = await submit(domain, chatId, "later", "Thanks");
  const laterRequest = domain.provider.requests.find((request) => request.runId === later.runId)!;
  assert.ok(JSON.stringify(laterRequest.messages).includes("Image notice: 5 referenced image(s)"));
  assert.equal(
    (await domain.service.host.store.tasks.listEvents(later.runId)).some(
      (event) => event.type === "run.warning" && JSON.stringify(event).includes("mention_images_omitted"),
    ),
    false,
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

test("unbound chat stages only reads and creation; edits follow on the bound run", async () => {
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
    { content: "Design created" },
    { newRun: true, calls: [place] },
    { content: "Placed" },
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
  const created = await submit(domain, chat.id, "create");
  const unboundTools = domain.provider.requests[0]!.tools!.map((tool) => tool.name);
  assert.ok(unboundTools.includes("designer_create_design"));
  assert.ok(unboundTools.includes("library_resolve_bom"));
  for (const name of [
    "designer_place_components",
    "designer_propose_schematic_deletions",
    "compile_circuit",
  ])
    assert.equal(unboundTools.includes(name), false, name);
  assert.ok(
    JSON.stringify(domain.provider.requests[0]!.messages[0]).includes(
      "This chat has no design yet",
    ),
  );
  const binding = domain.service.contextResolver.getPrimaryDesign(chat.id)!;
  assert.ok(binding);
  assert.equal(binding.label, "Created from HTTP");
  const placed = await submit(domain, chat.id, "place");
  const boundTools = domain.provider.requests
    .find((request) => request.runId === placed.runId)!
    .tools!.map((tool) => tool.name);
  assert.ok(boundTools.includes("designer_place_components"));
  assert.notEqual(placed.runId, created.runId);
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
    await domain.service.host.store.tasks.listEvents(placed.runId)
  )
    .filter((event) => event.type === "run.verification")
    .at(-1);
  assert.ok(JSON.stringify(verification).includes('"status":"pass"'));
});

test("unbound build run defers its BOM to the next bound run instead of correcting placements", async () => {
  domain = await isolatedHttpDomain([
    {
      calls: [
        {
          id: "bom",
          name: "library_resolve_bom",
          arguments: { goal: "Decoupling", items: [{ role: "capacitor", query: "capacitor", quantity: 1 }] },
        },
        { id: "create", name: "designer_create_design", arguments: { name: "Deferred build" } },
      ],
    },
    { content: "Design ready" },
    {
      newRun: true,
      calls: [{ id: "inspect", name: "designer_get_schematic_connectivity", arguments: {} }],
    },
    { content: "Inspected" },
  ]);
  const chat = (await (
    await domain.request("/v1/chats", { method: "POST", body: JSON.stringify({ title: "Deferred" }) })
  ).json()) as { id: string };
  const created = await submit(domain, chat.id, "build", "Build a decoupling capacitor circuit");
  const runEvents = (runId: string) => domain!.service.host.store.tasks.listEvents(runId);
  const createdEvents = await runEvents(created.runId);
  assert.equal(
    createdEvents.some((event) => event.type === "run.warning" && JSON.stringify(event).includes("retry_pass")),
    false,
  );
  assert.equal(domain.provider.requests.filter((request) => request.runId === created.runId).length, 2);
  const createdVerification = createdEvents.filter((event) => event.type === "run.verification");
  assert.equal(createdVerification.length, 1);
  assert.ok(JSON.stringify(createdVerification[0]).includes('"status":"pass"'));
  assert.ok(domain.service.contextResolver.getPrimaryDesign(chat.id));

  const followUp = await submit(domain, chat.id, "follow-up", "Continue");
  const first = (await runEvents(followUp.runId)).find((event) => event.type === "run.verification");
  const text = JSON.stringify(first);
  assert.ok(text.includes('"status":"partial"'), text);
  assert.ok(text.includes("Missing placements"), text);
});

async function assertNoPlacementCorrection(target: HttpDomain, runId: string): Promise<void> {
  const events = await target.service.host.store.tasks.listEvents(runId);
  assert.equal(
    events.some((event) => event.type === "run.warning" && JSON.stringify(event).includes("retry_pass")),
    false,
  );
  assert.equal(target.provider.requests.filter((request) => request.runId === runId).length, 2);
  const verification = JSON.stringify(events.filter((event) => event.type === "run.verification"));
  assert.ok(verification.includes('"status":"pass"'), verification);
  assert.equal(verification.includes("Missing placements"), false, verification);
}

const bomCall = {
  id: "bom",
  name: "library_resolve_bom",
  arguments: { goal: "Decoupling", items: [{ role: "capacitor", query: "capacitor", quantity: 1 }] },
};
const inspectRun = [
  { newRun: true, calls: [{ id: "inspect", name: "designer_get_schematic_connectivity", arguments: {} }] },
  { content: "Inspected" },
];

test("an unbound BOM lookup without a created design defers nothing to a later bound run", async () => {
  domain = await isolatedHttpDomain([{ calls: [bomCall] }, { content: "Listed" }, ...inspectRun]);
  const chat = (await (
    await domain.request("/v1/chats", { method: "POST", body: JSON.stringify({ title: "Lookup" }) })
  ).json()) as { id: string };
  await submit(domain, chat.id, "lookup", "Which parts would a decoupling network need? Just list them.");
  const existing = await domain.designer.createDesign({ name: "Existing board" });
  const bound = await domain.request(`/v1/chats/${chat.id}/context-bindings`, {
    method: "POST",
    body: JSON.stringify({ designId: existing.id }),
  });
  assert.equal(bound.status, 201);
  const checked = await submit(domain, chat.id, "check", "Check connectivity of my existing board.");
  await assertNoPlacementCorrection(domain, checked.runId);
});

test("a deferred build is dropped when the chat is rebound to another design", async () => {
  domain = await isolatedHttpDomain([
    { calls: [bomCall, { id: "create", name: "designer_create_design", arguments: { name: "Deferred build" } }] },
    { content: "Design ready" },
    ...inspectRun,
  ]);
  const chat = (await (
    await domain.request("/v1/chats", { method: "POST", body: JSON.stringify({ title: "Rebound" }) })
  ).json()) as { id: string };
  await submit(domain, chat.id, "build", "Build a decoupling capacitor circuit");
  const created = domain.service.contextResolver.getPrimaryDesign(chat.id)!;
  assert.ok(created);
  const unbound = await domain.request(`/v1/chats/${chat.id}/context-bindings/${created.id}`, { method: "DELETE" });
  assert.equal(unbound.status, 204);
  const other = await domain.designer.createDesign({ name: "Other board" });
  const bound = await domain.request(`/v1/chats/${chat.id}/context-bindings`, {
    method: "POST",
    body: JSON.stringify({ designId: other.id }),
  });
  assert.equal(bound.status, 201);
  const checked = await submit(domain, chat.id, "check", "Check connectivity of the other board.");
  assert.equal(domain.service.contextResolver.getPrimaryDesign(chat.id)?.refId, other.id);
  await assertNoPlacementCorrection(domain, checked.runId);
});
