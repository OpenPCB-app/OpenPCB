/**
 * Stream Types - V2 Kernel
 *
 * Defines SSE/WebSocket streaming format for real-time chat responses.
 * Based on Server-Sent Events (SSE) protocol.
 */

import type { TaskId, TokenUsage } from "./task.types";

/** SSE event types */
export type StreamEventType =
  | "chunk" // Text delta
  | "reasoning" // Reasoning delta
  | "done" // Stream complete
  | "error" // Stream error
  | "ping"; // Keep-alive

/** Base stream event */
export interface StreamEventBase {
  taskId: TaskId;
  event: StreamEventType;
}

/** Text chunk event */
export interface StreamChunkEvent extends StreamEventBase {
  event: "chunk";
  data: {
    delta: string;
    index?: number;
  };
}

/** Reasoning chunk event */
export interface StreamReasoningEvent extends StreamEventBase {
  event: "reasoning";
  data: {
    delta: string;
  };
}

/** Stream done event */
export interface StreamDoneEvent extends StreamEventBase {
  event: "done";
  data: {
    text: string;
    reasoningText?: string;
    usage?: TokenUsage;
    finishReason?: string;
  };
}

/** Stream error event */
export interface StreamErrorEvent extends StreamEventBase {
  event: "error";
  data: {
    message: string;
    code?: string;
  };
}

/** Ping event (keep-alive) */
export interface StreamPingEvent extends StreamEventBase {
  event: "ping";
  data: {
    timestamp: string;
  };
}

/** Union of all stream events */
export type StreamEvent =
  | StreamChunkEvent
  | StreamReasoningEvent
  | StreamDoneEvent
  | StreamErrorEvent
  | StreamPingEvent;

/** Encode stream event to SSE format */
export function encodeSSE(event: StreamEvent): string {
  const data = JSON.stringify({
    taskId: event.taskId,
    event: event.event,
    data: event.data,
  });
  return `data: ${data}\n\n`;
}

/** Decode SSE line to stream event */
export function decodeSSE(line: string): StreamEvent | null {
  if (!line.startsWith("data: ")) {
    return null;
  }

  const jsonStr = line.slice(6).trim();
  if (jsonStr === "[DONE]") {
    return null;
  }

  try {
    return JSON.parse(jsonStr) as StreamEvent;
  } catch {
    return null;
  }
}

/** Stream accumulator state */
export interface StreamAccumulator {
  text: string;
  reasoningText: string;
  chunkCount: number;
  startedAt: number;
}

/** Create empty accumulator */
export function createAccumulator(): StreamAccumulator {
  return {
    text: "",
    reasoningText: "",
    chunkCount: 0,
    startedAt: Date.now(),
  };
}

/** Accumulate stream event */
export function accumulateEvent(
  acc: StreamAccumulator,
  event: StreamEvent,
): StreamAccumulator {
  switch (event.event) {
    case "chunk":
      return {
        ...acc,
        text: acc.text + event.data.delta,
        chunkCount: acc.chunkCount + 1,
      };
    case "reasoning":
      return {
        ...acc,
        reasoningText: acc.reasoningText + event.data.delta,
      };
    default:
      return acc;
  }
}

/** SSE content type header */
export const SSE_CONTENT_TYPE = "text/event-stream";

/** SSE headers for response */
export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": SSE_CONTENT_TYPE,
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  "X-Accel-Buffering": "no", // Disable nginx buffering
};

/** Create chunk event */
export function createChunkEvent(taskId: TaskId, delta: string, index?: number): StreamChunkEvent {
  return {
    taskId,
    event: "chunk",
    data: { delta, index },
  };
}

/** Create reasoning event */
export function createReasoningEvent(taskId: TaskId, delta: string): StreamReasoningEvent {
  return {
    taskId,
    event: "reasoning",
    data: { delta },
  };
}

/** Create done event */
export function createDoneEvent(
  taskId: TaskId,
  text: string,
  options?: {
    reasoningText?: string;
    usage?: TokenUsage;
    finishReason?: string;
  },
): StreamDoneEvent {
  return {
    taskId,
    event: "done",
    data: {
      text,
      reasoningText: options?.reasoningText,
      usage: options?.usage,
      finishReason: options?.finishReason,
    },
  };
}

/** Create error event */
export function createErrorEvent(
  taskId: TaskId,
  message: string,
  code?: string,
): StreamErrorEvent {
  return {
    taskId,
    event: "error",
    data: { message, code },
  };
}

/** Create ping event */
export function createPingEvent(taskId: TaskId): StreamPingEvent {
  return {
    taskId,
    event: "ping",
    data: { timestamp: new Date().toISOString() },
  };
}
