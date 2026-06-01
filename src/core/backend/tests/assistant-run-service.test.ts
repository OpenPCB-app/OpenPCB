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

interface FakeToolCall {
  id: string;
  name: string;
  argumentsJson: string;
  /** Slim model-facing envelope; falls back to resultJson when omitted. */
  modelResultJson?: string;
  resultJson?: string;
}

interface FakeTurn {
  content?: string;
  reasoning?: string;
  finishReason?: string;
  /** Tool calls reported ONLY on run.message.completed (non-streaming provider). */
  completedToolCalls?: FakeToolCall[];
  /** Emit run.tool.succeeded events for the completedToolCalls after completion. */
  emitToolSucceeded?: boolean;
  /** Terminate this turn with run.failed instead of completing cleanly. */
  fail?: boolean;
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
    const toolCalls = turn.completedToolCalls ?? [];
    yield {
      type: "run.message.completed",
      runId,
      timestamp: "t",
      data: {
        content,
        toolCallCount: toolCalls.length,
        toolCalls: toolCalls.map((c) => ({
          id: c.id,
          name: c.name,
          argumentsJson: c.argumentsJson,
        })),
        reasoningContent: turn.reasoning,
        finishReason: turn.finishReason,
      },
    };
    if (turn.emitToolSucceeded) {
      for (const c of toolCalls) {
        yield {
          type: "run.tool.succeeded",
          runId,
          timestamp: "t",
          data: {
            toolCallId: c.id,
            toolName: c.name,
            resultJson: c.resultJson ?? "{}",
            modelResultJson: c.modelResultJson,
            sources: [],
            truncated: false,
            warnings: [],
          },
        };
      }
    }
    if (turn.fail) {
      yield {
        type: "run.failed",
        runId,
        timestamp: "t",
        data: { errorMessage: "provider exploded" },
      };
    }
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
  /** All persisted role:"tool" messages (model-facing content + name). */
  toolMessages: () => Array<{ content: string; toolName: string | null }>;
  run: () => Promise<void>;
}

/** Minimal designer SDK stub: a clean same-revision projection+ERC snapshot. */
function makeDesignerStub() {
  return {
    getProjectionAndErc: async () => ({
      projection: { parts: [], nets: [] },
      erc: { violations: [], summary: { errors: 0, warnings: 0 } },
    }),
  };
}

function makeHarness(opts: {
  turns: FakeTurn[];
  bound?: boolean;
  toolCalling?: boolean;
  withoutCreateTool?: boolean;
  /** Provide a designer SDK + primary-design binding so DoD can run. */
  withDesigner?: boolean;
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
    listWriteProposals: () => [],
  };

  const designerSdk = opts.withDesigner ? makeDesignerStub() : null;

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
      db: { rawSql: () => [] },
      sdk: {
        get: (token: string) => {
          if (token === MODULE_SDK_TOKENS.TASKS) return tasksSdk;
          if (token === MODULE_SDK_TOKENS.DESIGNER) return designerSdk;
          return null;
        },
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
      getPrimaryDesign: () =>
        opts.withDesigner ? { refId: "d1", status: "active" as const } : null,
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
    toolMessages: () =>
      [...messages.values()]
        .filter((m) => m.role === "tool")
        .map((m) => ({
          content: m.content as string,
          toolName: (m.toolName as string | null) ?? null,
        })),
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

describe("RunService DoD gating + tool-turn persistence", () => {
  test("DoD runs after a provider failure that followed successful writes (F4)", async () => {
    // Turn 1 applies a write (designer_place_components → run.tool.succeeded),
    // turn 2 fails. The chat-only retry clears callSummaries, but hadWriteWork
    // survives, so the Definition-of-Done verifier must still run.
    const h = makeHarness({
      bound: true,
      withDesigner: true,
      turns: [
        {
          completedToolCalls: [
            {
              id: "c1",
              name: "designer_place_components",
              argumentsJson: '{"x":1}',
            },
          ],
        },
        { fail: true },
      ],
    });
    await h.run();

    const ai = (h.metadataOf()?.ai ?? {}) as {
      definitionOfDone?: { status: string };
    };
    expect(ai.definitionOfDone).toBeDefined();
    expect(ai.definitionOfDone?.status).toBe("pass");
  });

  test("DoD does NOT run for a pure chat-only answer (no write work)", async () => {
    const h = makeHarness({
      bound: true,
      withDesigner: true,
      turns: [{ content: "Just a chat answer, no tools." }],
    });
    await h.run();

    const ai = (h.metadataOf()?.ai ?? {}) as {
      definitionOfDone?: unknown;
    };
    expect(ai.definitionOfDone).toBeUndefined();
  });

  test("completed-only provider seeds tool-call summaries with real args (F8)", async () => {
    // The tool calls are reported ONLY on run.message.completed. The orchestrator
    // must seed a tool-event from them so the persisted args are real, not "{}".
    const h = makeHarness({
      bound: true,
      withDesigner: true,
      turns: [
        {
          completedToolCalls: [
            {
              id: "c1",
              name: "designer_place_components",
              argumentsJson: '{"ref":"R1"}',
            },
          ],
        },
        { content: "done" },
      ],
    });
    await h.run();

    // hadWriteWork seeded from the completed turn → DoD ran.
    const ai = (h.metadataOf()?.ai ?? {}) as {
      definitionOfDone?: unknown;
      toolCallSummaries?: Array<{ toolName: string }>;
    };
    expect(ai.definitionOfDone).toBeDefined();
    expect(
      ai.toolCallSummaries?.some(
        (s) => s.toolName === "designer_place_components",
      ),
    ).toBe(true);
  });

  test("persisted tool message uses the slim model-facing envelope (F9)", async () => {
    const h = makeHarness({
      bound: true,
      withDesigner: true,
      turns: [
        {
          completedToolCalls: [
            {
              id: "c1",
              name: "designer_place_components",
              argumentsJson: "{}",
            },
          ],
        },
        { content: "done" },
      ],
    });
    await h.run();

    const toolMsg = h
      .toolMessages()
      .find((m) => m.toolName === "designer_place_components");
    expect(toolMsg).toBeDefined();
    // The slim envelope is the wrapper { ok, status, warnings, truncated, data },
    // NOT the bare tool data ("{}"). History replays this to the model.
    const parsed = JSON.parse(toolMsg!.content) as Record<string, unknown>;
    expect(parsed).toHaveProperty("ok");
    expect(parsed).toHaveProperty("status");
    expect(parsed).toHaveProperty("data");
  });
});
