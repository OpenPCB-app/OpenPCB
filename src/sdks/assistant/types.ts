export type AssistantProviderId = string;
export type AssistantProviderKind = "openai" | "openai-compatible";
export type AssistantRole = "system" | "user" | "assistant" | "tool";

export interface AssistantChat {
  id: string;
  title: string;
  providerConfigId: string;
  provider: AssistantProviderId;
  model: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
}

export interface AssistantMessage {
  id: string;
  chatId: string;
  role: AssistantRole;
  content: string;
  taskId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssistantChatInput {
  title?: string;
  providerConfigId?: string;
  provider?: AssistantProviderId;
  model?: string;
}

export interface SubmitAssistantMessageInput {
  content: string;
  providerConfigId?: string;
  provider?: AssistantProviderId;
  model?: string;
}

export interface SubmitAssistantMessageResult {
  chat: AssistantChat;
  userMessage: AssistantMessage;
  assistantMessage: AssistantMessage;
  taskId: string;
}

export interface AssistantSettings {
  defaultProviderId: string;
  toolExecutionPolicy: "auto_readonly_confirm_writes" | "confirm_all_writes" | "auto_all";
}

export interface AssistantProviderConfig {
  id: string;
  label: string;
  kind: AssistantProviderKind;
  baseUrl: string;
  defaultModel: string;
  enabled: boolean;
  isBuiltin: boolean;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantProviderConfigInput {
  label?: string;
  kind?: AssistantProviderKind;
  baseUrl?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  defaultModel?: string;
  enabled?: boolean;
}

export interface AssistantProviderModel {
  providerId: string;
  modelId: string;
  displayName: string | null;
  fetchedAt: string;
}

export interface ProviderTestResult {
  ok: boolean;
  checkedAt: string;
  modelsAvailable: number;
  completionTested: boolean;
  message: string;
}

export interface AssistantSDK {
  createChat(input?: CreateAssistantChatInput): Promise<AssistantChat>;
  listChats(): Promise<AssistantChat[]>;
  getChat(chatId: string): Promise<AssistantChat | null>;
  listMessages(chatId: string): Promise<AssistantMessage[]>;
  submitMessage(chatId: string, input: SubmitAssistantMessageInput): Promise<SubmitAssistantMessageResult>;
  getSettings(): Promise<AssistantSettings>;
  updateSettings(input: Partial<AssistantSettings>): Promise<AssistantSettings>;
  listProviders(): Promise<AssistantProviderConfig[]>;
  createProvider(input: AssistantProviderConfigInput): Promise<AssistantProviderConfig>;
  updateProvider(id: string, input: AssistantProviderConfigInput): Promise<AssistantProviderConfig>;
  deleteProvider(id: string): Promise<void>;
  listProviderModels(id: string): Promise<AssistantProviderModel[]>;
  refreshProviderModels(id: string): Promise<AssistantProviderModel[]>;
  testProvider(id: string, input?: { includeCompletion?: boolean }): Promise<ProviderTestResult>;
}
