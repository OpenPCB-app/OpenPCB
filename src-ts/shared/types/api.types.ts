/**
 * API Types
 */

import type { ProviderId } from "./provider.types";

export const ErrorCodes = {
  INTERNAL_ERROR: "INTERNAL_ERROR",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  PROVIDER_NOT_FOUND: "PROVIDER_NOT_FOUND",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  API_KEY_REQUIRED: "API_KEY_REQUIRED",
  API_KEY_INVALID: "API_KEY_INVALID",
  CHAT_NOT_FOUND: "CHAT_NOT_FOUND",
  MESSAGE_NOT_FOUND: "MESSAGE_NOT_FOUND",
  STREAM_ERROR: "STREAM_ERROR",
  STREAM_ABORTED: "STREAM_ABORTED",
  TASK_NOT_FOUND: "TASK_NOT_FOUND",
  TASK_CANCELLED: "TASK_CANCELLED",
  INVALID_REQUEST: "INVALID_REQUEST",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface ChatStreamRequest {
  chatId?: string;
  provider: ProviderId;
  model: string;
  text: string;
  files?: Array<{
    data?: string;
    url?: string;
    mediaType?: string;
    filename?: string;
  }>;
  systemPrompt?: string;
}

export type ChatStreamEvent =
  | { event: "start"; taskId: string; chatId: string; messageId: string }
  | { event: "token"; delta: string }
  | { event: "reasoning"; delta: string }
  | { event: "done"; text: string; reasoningText?: string; usage?: TokenUsageResponse }
  | { event: "error"; code: string; message: string };

export interface TokenUsageResponse {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}
