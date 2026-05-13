import type { AssistantProviderId } from "../../../../sdks/assistant";
import type { AIProvider, AIProviderRequest } from "./types";

interface OpenAIChunk {
  choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> } }>;
}

export class OpenAICompatibleProvider implements AIProvider {
  constructor(
    readonly id: AssistantProviderId,
    private readonly config: { baseUrl: string; apiKey?: string },
  ) {}

  async stream(request: AIProviderRequest): Promise<{ content: string; toolCalls: Array<{ id: string; name: string; argumentsJson: string }> }> {
    let response = await this.openChatStream(request, request.tools);
    if (!response.ok && request.tools?.length) {
      response = await this.openChatStream(request, undefined);
    }
    if (!response.ok || !response.body) throw new Error(await this.errorMessage(response));
    return this.readStream(response, request);
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const headers: Record<string, string> = {};
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/models`, { headers, signal });
    if (!response.ok) throw new Error(await this.errorMessage(response));
    const body = await response.json() as { data?: Array<{ id?: unknown }> };
    return (body.data ?? []).map((model) => model.id).filter((model): model is string => typeof model === "string");
  }

  async testCompletion(model: string, signal?: AbortSignal): Promise<string> {
    const response = await this.openChatStream({
      messages: [{ role: "user", content: "Reply with OK." }],
      model,
      signal: signal ?? new AbortController().signal,
      onToken: async () => undefined,
    }, undefined);
    if (!response.ok) throw new Error(await this.errorMessage(response));
    return "Completion request accepted";
  }

  private openChatStream(request: AIProviderRequest, tools: AIProviderRequest["tools"]): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
    return fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: request.signal,
      headers,
      body: JSON.stringify({ model: request.model, messages: request.messages, stream: true, tools, tool_choice: tools?.length ? "auto" : undefined }),
    });
  }

  private async errorMessage(response: Response): Promise<string> {
    const body = await response.text().catch(() => "");
    if (!body) return `Provider ${this.id} failed: HTTP ${response.status}`;
    return `Provider ${this.id} failed: HTTP ${response.status}: ${body.slice(0, 500)}`;
  }

  private async readStream(response: Response, request: AIProviderRequest): Promise<{ content: string; toolCalls: Array<{ id: string; name: string; argumentsJson: string }> }> {
    if (!response.body) throw new Error(`Provider ${this.id} failed: empty stream`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const toolCalls = new Map<number, { id: string; name: string; argumentsJson: string }>();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        const parsed = JSON.parse(data) as OpenAIChunk;
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) {
          content += token;
          await request.onToken(token);
        }
        for (const call of parsed.choices?.[0]?.delta?.tool_calls ?? []) {
          const current = toolCalls.get(call.index) ?? { id: call.id ?? `call_${call.index}`, name: "", argumentsJson: "" };
          toolCalls.set(call.index, {
            id: call.id ?? current.id,
            name: call.function?.name ?? current.name,
            argumentsJson: `${current.argumentsJson}${call.function?.arguments ?? ""}`,
          });
        }
      }
    }
    return { content, toolCalls: [...toolCalls.values()].filter((call) => call.name.length > 0) };
  }
}
