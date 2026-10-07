import type { AiChatRequest, AiProviderClient, AiProviderCapabilities, AiProviderModel, AiRunEvent, AiToolCall } from "@openpcb/ai-core";
import { RunService } from "../../../../../modules/assistant/backend/run-service";
import type { Task } from "../../../../../sdks/tasks";
import type { ParityDomain } from "./domain";

export interface ParityTurn {
  calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  content?: string;
  waitForStop?: boolean;
}

/** Scripted provider events only; tool execution stays in the real run loop. */
export class FixtureProvider implements AiProviderClient {
  readonly id = "parity-provider";
  readonly kind = "openai-compatible" as const;
  readonly requests: AiChatRequest[] = [];
  private cursor = 0;
  constructor(private readonly turns: ParityTurn[]) {}
  async capabilities(): Promise<AiProviderCapabilities> {
    return { streaming: true, toolCalling: true, modelList: true };
  }
  async listModels(): Promise<AiProviderModel[]> { return []; }
  async *streamChat(input: AiChatRequest): AsyncIterable<AiRunEvent> {
    this.requests.push(structuredClone({ ...input, signal: undefined }));
    const turn = this.turns[this.cursor++] ?? { content: "Fixture complete." };
    const timestamp = "2026-10-06T00:00:00.000Z";
    yield { type: "run.started", runId: input.runId, timestamp, data: { model: input.model, toolCount: input.tools?.length ?? 0 } };
    if (turn.waitForStop) {
      await new Promise<void>((resolve) => {
        if (input.signal?.aborted) resolve();
        else input.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      yield { type: "run.cancelled", runId: input.runId, timestamp, data: { reason: "aborted" } };
      return;
    }
    const toolCalls: AiToolCall[] = (turn.calls ?? []).map((call) => ({
      id: call.id, name: call.name, argumentsJson: JSON.stringify(call.arguments),
    }));
    yield { type: "run.message.completed", runId: input.runId, timestamp,
      data: { content: turn.content ?? "", toolCallCount: toolCalls.length, toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop" } };
  }
}

export function installProvider(domain: ParityDomain, turns: ParityTurn[]): FixtureProvider {
  const client = new FixtureProvider(turns);
  new RunService({
    ctx: domain.ctx, conversation: domain.service.conversation,
    providers: domain.service.providers, settings: domain.service.settings,
    prompts: domain.service.prompts, contextResolver: domain.service.contextResolver,
    buildRegistry: () => domain.registry, buildClient: () => client,
  });
  return client;
}

export async function waitUntil(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Parity fixture did not settle within 3000 ms");
}

export async function waitForTask(domain: ParityDomain, taskId: string): Promise<Task> {
  await waitUntil(async () => {
    const task = await domain.tasks.getTask(taskId);
    return !!task && ["completed", "failed", "cancelled"].includes(task.status);
  });
  const task = await domain.tasks.getTask(taskId);
  if (!task) throw new Error(`Task missing: ${taskId}`);
  return task;
}

export async function runTurns(domain: ParityDomain, chatId: string, turns: ParityTurn[]) {
  const client = installProvider(domain, turns);
  const submission = await domain.service.submitMessage(chatId, { content: "Execute the bounded fixture workflow." });
  const task = await waitForTask(domain, submission.taskId);
  if (task.status !== "completed") throw new Error(JSON.stringify(task.error ?? task));
  return { client, task, submission };
}
