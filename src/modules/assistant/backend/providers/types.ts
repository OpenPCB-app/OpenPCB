import type { AssistantProviderId } from "../../../../sdks/assistant";

export interface AIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface AIProviderRequest {
  messages: AIMessage[];
  model: string;
  signal: AbortSignal;
  tools?: Array<{ type: "function"; function: { name: string; description?: string; parameters?: Record<string, unknown> } }>;
  onToken(token: string): Promise<void>;
}

export interface AIProvider {
  id: AssistantProviderId;
  stream(request: AIProviderRequest): Promise<{ content: string; toolCalls: AIToolCall[] }>;
}

export interface AIToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}
