import { describe, expect, test } from "bun:test";
import {
  AiToolRegistry,
  type AiChatRequest,
  type AiProviderCapabilities,
  type AiProviderClient,
  type AiProviderModel,
  type AiRunEvent,
  type AiTool,
  type AiToolExecutionContext,
} from "@openpcb/ai-core";
import {
  RunService,
  type RunServiceOptions,
} from "../../../modules/assistant/backend/run-service";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import type { CoreBackendModuleContext } from "../../contracts/modules/backend-module";
import type { TaskExecutor } from "../../../sdks/tasks";

const ALL_TOOL_NAMES = [
  "library_search_components",
  "library_resolve_bom",
  "library_get_component_detail",
  "designer_resolve_design",
  "designer_get_design_summary",
  "designer_get_part_detail",
  "designer_get_schematic_connectivity",
  "designer_create_design",
  "designer_place_components",
  "designer_propose_schematic_edits",
  "designer_propose_schematic_wires",
  "designer_propose_schematic_updates",
  "designer_propose_schematic_deletions",
];

interface FakeTurn {
  content?: string;
  reasoning?: string;
  finishReason?: string;
}

class FakeClient implements AiProviderClient {
  readonly id = "fake";
  readonly kind = "openai-compatible" as const;
  readonly toolCounts: number[] = [];
  private turns: FakeTurn[];
  private i = 0;

  constructor(turns: FakeTurn[]) {
    this.turns = turns;
  }

  async capabilities(): Promise<AiProviderCapabilities> {
    return { streaming: true, toolCalling: true, modelList: true };
  }
  async listModels(): Promise<AiProviderModel[]> {
    return [];
  }
  async *streamChat(input: AiChatRequest): AsyncIterable<AiRunEvent> {
    this.toolCounts.push(input.tools?.length ?? 0);
    const turn = this.turns[this.i] ?? {};
    this.i++;
    const runId = input.runId;
    yield {
      type: "run.started",
      runId,
      timestamp: "t",
      data: { model: input.model, toolCount: input.tools?.length ?? 0 },
    };
    const content = turn.content ?? "";
    if (content)
      yield {
        type: "run.message.delta",
        runId,
        timestamp: "t",
        data: { delta: content },
      };
    yield {
      type: "run.message.completed",
      runId,
      timestamp: "t",
      data: {
        content,
        toolCallCount: 0,
        reasoningContent: turn.reasoning,
        finishReason: turn.finishReason,
      },
    };
  }
}

function makeTool(name: string): AiTool {
  return {
    definition: {
      name,
      version: "1",
      effect: "read",
      capability: "test",
      description: "test tool",
      inputSchema: { type: "object", properties: {} },
    },
    async execute(ctx: AiToolExecutionContext) {
      return {
        ok: true,
        data: {},
        sources: [],
        warnings: [],
        truncated: false,
        limits: ctx.limits,
      };
    },
  } as unknown as AiTool;
}

function fullRegistry(
  opts: { withoutCreateTool?: boolean } = {},
): AiToolRegistry {
  const reg = new AiToolRegistry();
  for (const name of ALL_TOOL_NAMES) {
    if (opts.withoutCreateTool && name === "designer_create_design") continue;
    reg.register(makeTool(name));
  }
  return reg;
}

interface Harness {
  client: FakeClient;
  emitted: { kind: string; content: string }[];
  metadataOf: () => Record<string, unknown> | null;
  contentOf: () => string;
  run: () => Promise<void>;
}

function makeHarness(opts: {
  turns: FakeTurn[];
  bound?: boolean;
  toolCalling?: boolean;
  withoutCreateTool?: boolean;
}): Harness {
  const chatId = "chat1";
  const assistantMessageId = "asst1";
  const client = new FakeClient(opts.turns);
  const emitted: { kind: string; content: string }[] = [];
  const messages = new Map<string, Record<string, unknown>>();
  messages.set(assistantMessageId, {
    id: assistantMessageId,
    role: "assistant",
    content: "",
    metadata: null,
    toolCallsJson: null,
    toolCallId: null,
    toolName: null,
    taskId: null,
  });

  const conversation = {
    getChat: () => ({ id: chatId, promptPresetId: "strict-grounded" }),
    listMessages: () => ({
      items: [
        {
          id: "u1",
          role: "user",
          content: "build me a thing",
          metadata: null,
          toolCallsJson: null,
          toolCallId: null,
          toolName: null,
          taskId: null,
        },
      ],
    }),
    getMessage: (id: string) => messages.get(id) ?? null,
    appendMessageContent: (id: string, c: string) => {
      const m = messages.get(id);
      if (m) m.content = `${m.content as string}${c}`;
    },
    setMessageContent: (id: string, c: string) => {
      const m = messages.get(id);
      if (m) m.content = c;
    },
    setMessageMetadata: (id: string, md: Record<string, unknown>) => {
      const m = messages.get(id);
      if (m) m.metadata = md;
    },
    createMessage: (input: Record<string, unknown>) => {
      const id = `m_${messages.size + 1}`;
      messages.set(id, { ...input, id });
      return { id };
    },
    upsertToolEvent: (input: Record<string, unknown>) => ({
      ...input,
      id: (input.id as string) ?? `te_${messages.size}`,
    }),
  };

  const bindings = opts.bound
    ? [
        {
          id: "b1",
          kind: "design",
          role: "primary",
          status: "active",
          label: "My Design",
          refId: "d1",
        },
      ]
    : [];

  let captured: TaskExecutor | undefined;
  const tasksSdk = {
    registerExecutor: (_type: string, exec: TaskExecutor) => {
      captured = exec;
    },
  };

  const options = {
    ctx: {
      sdk: {
        get: (token: string) =>
          token === MODULE_SDK_TOKENS.TASKS ? tasksSdk : null,
      },
    },
    conversation,
    providers: {
      getProviderInternal: () => ({
        enabled: true,
        label: "oMLX",
        capabilities: { toolCalling: opts.toolCalling ?? true },
      }),
    },
    settings: {
      getSettings: () => ({
        allowRawToolData: false,
        contextSizePreference: "medium",
      }),
    },
    prompts: { composeSystem: () => "system prompt" },
    contextResolver: {
      refreshBindingHealth: async () => {},
      listBindings: () => bindings,
    },
    buildRegistry: () =>
      fullRegistry({ withoutCreateTool: opts.withoutCreateTool }),
    buildClient: () => client,
  } as unknown as RunServiceOptions;

  new RunService(options);

  const taskCtx = {
    task: {
      id: "task1",
      payload: {
        chatId,
        assistantMessageId,
        providerConfigId: "omlx",
        model: "qwen",
      },
    },
    signal: new AbortController().signal,
    emitChunk: async (chunk: { kind: string; content: string }) => {
      emitted.push(chunk);
    },
    emitProgress: async () => {},
    emitEvent: async () => {},
    logger: { info: () => {}, error: () => {} },
  };

  return {
    client,
    emitted,
    metadataOf: () =>
      (messages.get(assistantMessageId)?.metadata as Record<
        string,
        unknown
      > | null) ?? null,
    contentOf: () => messages.get(assistantMessageId)?.content as string,
    run: async () => {
      if (!captured) throw new Error("executor not registered");
      await captured.execute(
        taskCtx as unknown as Parameters<TaskExecutor["execute"]>[0],
      );
    },
  };
}

function aiEvents(emitted: { kind: string; content: string }[]): AiRunEvent[] {
  return emitted
    .filter((c) => c.kind === "json")
    .map((c) => {
      try {
        return (JSON.parse(c.content) as { _aiEvent?: AiRunEvent })._aiEvent;
      } catch {
        return undefined;
      }
    })
    .filter((e): e is AiRunEvent => Boolean(e));
}

describe("RunService empty-completed handling", () => {
  test("empty turn retries once and signals empty_response when still empty", async () => {
    const h = makeHarness({ turns: [{}, {}] });
    await h.run();

    expect(h.client.toolCounts.length).toBe(2); // primary + one retry
    const warnings = aiEvents(h.emitted).filter(
      (e) => e.type === "run.warning",
    );
    expect(
      warnings.some(
        (w) => (w as { data: { code: string } }).data.code === "empty_response",
      ),
    ).toBe(true);
    const ai = (h.metadataOf()?.ai ?? {}) as { emptyResponse?: boolean };
    expect(ai.emptyResponse).toBe(true);
  });

  test("empty turn that recovers on retry produces an answer and no empty_response", async () => {
    const h = makeHarness({ turns: [{}, { content: "Recovered answer" }] });
    await h.run();

    expect(h.contentOf()).toContain("Recovered answer");
    const warnings = aiEvents(h.emitted).filter(
      (e) =>
        e.type === "run.warning" &&
        (e as { data: { code: string } }).data.code === "empty_response",
    );
    expect(warnings.length).toBe(0);
    const ai = (h.metadataOf()?.ai ?? {}) as { emptyResponse?: boolean };
    expect(ai.emptyResponse).toBeFalsy();
  });

  test("reasoning_content is persisted to message metadata", async () => {
    const h = makeHarness({ turns: [{ reasoning: "my chain of thought" }] });
    await h.run();

    const ai = (h.metadataOf()?.ai ?? {}) as { reasoning?: string };
    expect(ai.reasoning).toBe("my chain of thought");
  });

  test("does not retry when the first turn already answered", async () => {
    const h = makeHarness({ turns: [{ content: "Here is the answer." }] });
    await h.run();

    expect(h.client.toolCounts.length).toBe(1);
    expect(h.contentOf()).toContain("Here is the answer.");
  });
});

describe("RunService bind-gated tool staging", () => {
  test("unbound chat that can create a design receives the full tool set", async () => {
    // The full registry includes designer_create_design, so an unbound chat is
    // create-capable: the write tools must be advertised up front because
    // runChat snapshots the tool list once and a mid-run bind can't add them.
    const h = makeHarness({ turns: [{ content: "ok" }], bound: false });
    await h.run();
    expect(h.client.toolCounts[0]).toBe(13);
  });

  test("unbound read-only chat (no create tool) receives only the lean set", async () => {
    const h = makeHarness({
      turns: [{ content: "ok" }],
      bound: false,
      withoutCreateTool: true,
    });
    await h.run();
    // library reads (3) + designer_resolve_design (1); create tool absent.
    expect(h.client.toolCounts[0]).toBe(4);
  });

  test("bound chat receives the full designer tool set", async () => {
    const h = makeHarness({ turns: [{ content: "ok" }], bound: true });
    await h.run();
    expect(h.client.toolCounts[0]).toBe(13);
  });

  test("a provider with toolCalling=false receives no tools", async () => {
    const h = makeHarness({
      turns: [{ content: "ok" }],
      toolCalling: false,
    });
    await h.run();
    expect(h.client.toolCounts[0]).toBe(0);
  });
});
